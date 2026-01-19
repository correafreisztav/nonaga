// --- FIREBASE IMPORTS ---
// Using Web versions to run directly in browser without npm
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, set, onValue, update, get } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

// --- YOUR REAL FIREBASE CONFIGURATION ---
const firebaseConfig = {
  apiKey: "AIzaSyBflpPeyXxHe7gUndGOmXuTfk7fym8foBY",
  authDomain: "nonaga-e4967.firebaseapp.com",
  databaseURL: "https://nonaga-e4967-default-rtdb.firebaseio.com",
  projectId: "nonaga-e4967",
  storageBucket: "nonaga-e4967.firebasestorage.app",
  messagingSenderId: "471199605102",
  appId: "1:471199605102:web:a0b6fc9317916fe8b9617f",
  measurementId: "G-CX716RMY4L"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// --- MAIN GAME CODE ---
document.addEventListener('DOMContentLoaded', () => {
    // DOM References
    const svg = document.getElementById('game-board');
    const statusText = document.getElementById('status-text');
    const btnCreate = document.getElementById('btn-create-game');
    const btnJoin = document.getElementById('btn-join'); 
    const inputRoom = document.getElementById('room-input'); 
    const connectionPanel = document.getElementById('connection-panel');
    const linkDisplay = document.getElementById('room-link');
    const RING_SIZE = 50;

    // --- RANDOM ROOM NAME LISTS ---
    // You can add more words here to make it fun
    const adjetivos = ['veloz', 'furioso', 'rojo', 'azul', 'mistico', 'sabio', 'loco', 'dorado', 'feliz', 'antiguo', 'cosmico', 'ninja'];
    const animales = ['puma', 'zorro', 'condor', 'carpincho', 'dragon', 'tigre', 'lobo', 'oso', 'halcon', 'gato', 'aguila', 'tiburon'];

    // Helper to generate names like "puma-mistico-42"
    function generateRoomName() {
        const adj = adjetivos[Math.floor(Math.random() * adjetivos.length)];
        const ani = animales[Math.floor(Math.random() * animales.length)];
        const num = Math.floor(Math.random() * 99); 
        return `${ani}-${adj}-${num}`;
    }

    // --- ONLINE VARIABLES ---
    let roomId = null;
    let myPlayerId = null; // 1 or 2
    let isOnline = false;

    // --- CONNECTION & BUTTON LOGIC ---

    // 1. Check if we arrived via URL (e.g., ?room=xyz)
    const urlParams = new URLSearchParams(window.location.search);
    const urlRoom = urlParams.get('room');

    if (urlRoom) {
        // GAME MODE: Hide connection panel to focus on game
        if (connectionPanel) connectionPanel.style.display = 'none';
        
        roomId = urlRoom;
        isOnline = true;
        statusText.innerHTML = `Conectando a sala: <b>${roomId}</b>...`; 
        joinGame(roomId);
    }

    // 2. Create Button (Generates random name and reloads)
    if (btnCreate) {
        btnCreate.addEventListener('click', () => {
            const newName = generateRoomName();
            window.location.search = `?room=${newName}`;
        });
    }

    // 3. Join Button (Reads input and reloads)
    if (btnJoin) {
        btnJoin.addEventListener('click', () => {
            const typedRoom = inputRoom.value.trim(); 
            if (typedRoom) {
                window.location.search = `?room=${typedRoom}`;
            } else {
                alert("Por favor escribe un nombre de sala primero.");
            }
        });
    }

    // --- FIREBASE LOGIC ---

    function joinGame(id) {
        const gameRef = ref(db, 'games/' + id);
        
        get(gameRef).then((snapshot) => {
            if (snapshot.exists()) {
                // Game exists. Try to recover session or assume Player 2.
                if (!localStorage.getItem(`nonaga_player_${id}`)) {
                     myPlayerId = 2;
                     localStorage.setItem(`nonaga_player_${id}`, 2);
                } else {
                     myPlayerId = parseInt(localStorage.getItem(`nonaga_player_${id}`));
                }
            } else {
                // New game. I am the Creator (Player 1).
                myPlayerId = 1;
                localStorage.setItem(`nonaga_player_${id}`, 1);
                initGame(); // Initialize local state
                saveGameState(); // Save to cloud
            }

            // Show room info (Optional)
            if (linkDisplay) {
                linkDisplay.style.display = 'block';
                linkDisplay.textContent = `Sala: ${id} (Eres Jugador ${myPlayerId})`;
            }
            
            // LISTEN FOR LIVE CHANGES
            onValue(gameRef, (snap) => {
                const serverData = snap.val();
                if (serverData) {
                    gameState = serverData;
                    renderBoard();
                    updateStatus();
                }
            });
        }).catch(console.error);
    }

    function saveGameState() {
        if (!isOnline) return;
        set(ref(db, 'games/' + roomId), gameState);
    }

    // --- GAME STATE ---
    let gameState = {
        rings: [],
        currentPlayer: 1,
        turnPhase: 'MOVE_PAWN', // 'MOVE_PAWN' or 'RELOCATE_RING'
        selectedPawn: null,
        lastRelocatedRingCoords: null,
        winner: null
    };

    // State for drag-and-drop visuals
    let carryState = {
        isCarrying: false,
        carriedElement: null,
        originalRing: null,
    };

    // --- COORDINATE LOGIC (Axial <-> Pixel) ---
    const axialToPixel = (q, r) => {
        const x = RING_SIZE * (3 / 2 * q);
        const y = RING_SIZE * (Math.sqrt(3) / 2 * q + Math.sqrt(3) * r);
        return { x, y };
    };

    const pixelToAxial = (x, y) => {
        const rect = svg.getBoundingClientRect();
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        const relativeX = x - centerX;
        const relativeY = y - centerY;

        const q_frac = (2 / 3 * relativeX) / RING_SIZE;
        const r_frac = (-1 / 3 * relativeX + Math.sqrt(3) / 3 * relativeY) / RING_SIZE;
        const s_frac = -q_frac - r_frac;

        let q = Math.round(q_frac);
        let r = Math.round(r_frac);
        let s = Math.round(s_frac);

        // Fix rounding errors for hex grid
        const q_diff = Math.abs(q - q_frac);
        const r_diff = Math.abs(r - r_frac);
        const s_diff = Math.abs(s - s_frac);

        if (q_diff > r_diff && q_diff > s_diff) {
            q = -r - s;
        } else if (r_diff > s_diff) {
            r = -q - s;
        }
        return { q, r };
    };

    const getHexCorner = (center, size, i) => {
        const angle_deg = 60 * i - 30;
        const angle_rad = Math.PI / 180 * angle_deg;
        return {
            x: center.x + size * Math.cos(angle_rad),
            y: center.y + size * Math.sin(angle_rad)
        };
    };

    // --- INITIALIZATION ---
    function initGame() {
        const initialCoords = [];
        const radius = 2;
        // Generate hex grid of radius 2
        for (let q = -radius; q <= radius; q++) {
            for (let r = -radius; r <= radius; r++) {
                if (Math.abs(q + r) <= radius) {
                    initialCoords.push({q, r});
                }
            }
        }

        gameState.rings = initialCoords.map(coords => ({ ...coords, pawn: null }));

        // Initial pawn positions
        const pawnPositions = [
            { q: 0, r: -2, player: 1 },
            { q: 2, r: 0, player: 1 },
            { q: -2, r: 2, player: 1 },
            { q: 2, r: -2, player: 2 },
            { q: 0, r: 2, player: 2 },
            { q: -2, r: 0, player: 2 }
        ];

        pawnPositions.forEach(p => {
            const ring = findRing(p.q, p.r);
            if (ring) ring.pawn = p.player;
        });

        gameState.currentPlayer = 1;
        gameState.turnPhase = 'MOVE_PAWN';
        gameState.selectedPawn = null;
        gameState.lastRelocatedRingCoords = null;
        gameState.winner = null;

        renderBoard();
        updateStatus();
    }

    // --- RENDER FUNCTION ---
    function renderBoard() {
        svg.innerHTML = ''; // Clear board
        const rect = svg.getBoundingClientRect();
        const center = { x: rect.width / 2, y: rect.height / 2 };

        // Draw Rings
        gameState.rings.forEach(ring => {
            const pixel = axialToPixel(ring.q, ring.r);
            const points = Array.from({ length: 6 }, (_, i) => {
                const corner = getHexCorner({ x: 0, y: 0 }, RING_SIZE, i);
                return `${corner.x},${corner.y}`;
            }).join(' ');

            const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            polygon.setAttribute('points', points);
            polygon.setAttribute('class', 'ring');
            polygon.setAttribute('transform', `translate(${center.x + pixel.x}, ${center.y + pixel.y})`);

            polygon.dataset.q = ring.q;
            polygon.dataset.r = ring.r;

            polygon.addEventListener('click', onRingClick);
            svg.appendChild(polygon);
        });

        // Draw Pawns
        gameState.rings.forEach(ring => {
            if (ring.pawn) {
                const pixel = axialToPixel(ring.q, ring.r);
                const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                circle.setAttribute('cx', center.x + pixel.x);
                circle.setAttribute('cy', center.y + pixel.y);
                circle.setAttribute('r', RING_SIZE * 0.5);
                circle.setAttribute('class', `pawn player${ring.pawn}`);
                circle.style.pointerEvents = 'none'; // Click goes through to the ring
                svg.appendChild(circle);
            }
        });

        highlightElements();
    }

    // --- EVENT HANDLING ---

    function onRingClick(event) {
        event.stopPropagation();

        // 1. Online Block: If it's not my turn, ignore click.
        if (isOnline && gameState.currentPlayer !== myPlayerId) {
            console.log("Not your turn");
            return;
        }
        
        if (gameState.winner) return;

        const q = parseInt(event.target.dataset.q);
        const r = parseInt(event.target.dataset.r);
        const clickedRing = findRing(q, r);

        // Phase 1: Select/Move Pawn
        if (gameState.turnPhase === 'MOVE_PAWN') {
            handlePawnMovePhase(clickedRing);
            return;
        }

        // Phase 2: Relocate Ring
        if (gameState.turnPhase === 'RELOCATE_RING') {
            if (carryState.isCarrying) return;
            // Can only start carrying if ring is valid
            if (isValidRingToRemove(clickedRing)) {
                startCarryingRing(clickedRing, event.target);
            }
        }
    }

    function startCarryingRing(ring, visualElement) {
        carryState.isCarrying = true;
        carryState.originalRing = ring;

        // Create a visual "ghost" element to drag
        carryState.carriedElement = visualElement.cloneNode(true);
        carryState.carriedElement.style.pointerEvents = 'none';
        carryState.carriedElement.style.opacity = '0.7';
        carryState.carriedElement.classList.add('dragging');
        svg.appendChild(carryState.carriedElement);

        visualElement.style.opacity = '0.2';

        document.addEventListener('mousemove', onDocumentMouseMove);
        // Delay click listener to avoid immediate trigger
        setTimeout(() => { document.addEventListener('click', tryPlaceRing); }, 50);
    }

    function onDocumentMouseMove(event) {
        if (!carryState.isCarrying) return;

        // Convert mouse coordinates to SVG coordinates
        const CTM = svg.getScreenCTM();
        const mouseX = (event.clientX - CTM.e) / CTM.a;
        const mouseY = (event.clientY - CTM.f) / CTM.d;

        carryState.carriedElement.setAttribute('transform', `translate(${mouseX}, ${mouseY})`);
    }

    function tryPlaceRing(event) {
        if (!carryState.isCarrying) return;

        // Clean up listeners
        document.removeEventListener('mousemove', onDocumentMouseMove);
        document.removeEventListener('click', tryPlaceRing);

        // Remove ghost element
        if (carryState.carriedElement) {
            carryState.carriedElement.remove();
            carryState.carriedElement = null;
        }
        carryState.isCarrying = false;

        // Calculate drop position
        const CTM = svg.getScreenCTM();
        const mouseX = (event.clientX - CTM.e) / CTM.a;
        const mouseY = (event.clientY - CTM.f) / CTM.d;
        const targetAxial = pixelToAxial(mouseX, mouseY);
        const originRing = carryState.originalRing;

        // Validation 1: Dropped on same spot
        if (originRing.q === targetAxial.q && originRing.r === targetAxial.r) {
            console.log("Move cancelled: Same spot.");
            renderBoard();
            return;
        }

        // Validation 2: Target occupied?
        const otherRings = gameState.rings.filter(r => r !== originRing);
        const isOccupied = otherRings.some(r => r.q === targetAxial.q && r.r === targetAxial.r);

        // Validation 3: Neighbors >= 2
        const neighborsDirections = [{q: 1, r: 0}, {q: 1, r: -1}, {q: 0, r: -1}, {q: -1, r: 0}, {q: -1, r: 1}, {q: 0, r: 1}];
        let touchingCount = 0;
        neighborsDirections.forEach(dir => {
            if (otherRings.some(r => r.q === targetAxial.q + dir.q && r.r === targetAxial.r + dir.r)) {
                touchingCount++;
            }
        });

        if (!isOccupied && touchingCount >= 2) {
            // APPLY MOVE
            originRing.q = targetAxial.q;
            originRing.r = targetAxial.r;
            gameState.lastRelocatedRingCoords = { q: targetAxial.q, r: targetAxial.r };
            
            // Switch Turn
            gameState.currentPlayer = gameState.currentPlayer === 1 ? 2 : 1;
            gameState.turnPhase = 'MOVE_PAWN';
            
            renderBoard();
            updateStatus();
            saveGameState(); // SYNC WITH FIREBASE
        } else {
            console.log("Invalid drop");
            renderBoard();
        }
    }

    function handlePawnMovePhase(clickedRing) {
        if (!gameState.selectedPawn) {
            // Can only select own pawns
            if (clickedRing.pawn === gameState.currentPlayer) {
                gameState.selectedPawn = clickedRing;
            }
        } else {
            const from = gameState.selectedPawn;
            const to = clickedRing;

            if (from === to) {
                // Deselect
                gameState.selectedPawn = null;
            } else if (isValidPawnMove(from, to)) {
                // Execute Move
                to.pawn = from.pawn;
                from.pawn = null;
                gameState.selectedPawn = null;

                if (checkWinCondition(to.pawn)) {
                    gameState.winner = to.pawn;
                } else {
                   gameState.turnPhase = 'RELOCATE_RING'; 
                }
                
                // SYNC WITH FIREBASE
                saveGameState(); 
            } else {
                // Change selection
                if (to.pawn === gameState.currentPlayer) {
                    gameState.selectedPawn = to;
                }
            }
        }
        renderBoard();
        updateStatus();
    }

    // --- HELPERS ---
    
    function findRing(q, r) { 
        return gameState.rings.find(ring => ring.q === q && ring.r === r); 
    }

    function getNeighbors(q, r, ringsList = gameState.rings) {
        const directions = [{q: 1, r: 0}, {q: 1, r: -1}, {q: 0, r: -1}, {q: -1, r: 0}, {q: -1, r: 1}, {q: 0, r: 1}];
        return directions.map(dir => {
            const nQ = q + dir.q;
            const nR = r + dir.r;
            return ringsList.find(ring => ring.q === nQ && ring.r === nR);
        }).filter(Boolean);
    }

    function isValidPawnMove(from, to) {
        if (!from || !to || to.pawn) return false;
        
        // Calculate deltas
        const dq = to.q - from.q;
        const dr = to.r - from.r;
        const ds = (-to.q - to.r) - (-from.q - from.r);

        // Must be a straight line (one coordinate delta is 0)
        if (dq === 0 || dr === 0 || ds === 0) {
            const dist = (Math.abs(dq) + Math.abs(dr) + Math.abs(ds)) / 2;
            const stepQ = dq / dist;
            const stepR = dr / dist;

            // Check path is clear
            for (let i = 1; i < dist; i++) {
                const intermediateRing = findRing(from.q + stepQ * i, from.r + stepR * i);
                if (!intermediateRing || intermediateRing.pawn) return false;
            }

            // Check if it's sliding to the limit (next hex must be invalid or occupied)
            const nextQ = to.q + stepQ;
            const nextR = to.r + stepR;
            const nextRing = findRing(nextQ, nextR);

            // If next ring exists and is empty, we didn't slide to the end
            if (nextRing && !nextRing.pawn) return false;

            return true;
        }
        return false;
    }

    function isPeripheral(ring) { 
        // A peripheral ring has fewer than 6 neighbors
        return getNeighbors(ring.q, ring.r).length < 6; 
    }

    function isValidRingToRemove(ring) {
        // Rules: Exists, no pawn on it, is peripheral
        if (!ring || ring.pawn || !isPeripheral(ring)) return false;
        
        // Cannot move the ring that was just moved
        if (gameState.lastRelocatedRingCoords && 
            ring.q === gameState.lastRelocatedRingCoords.q && 
            ring.r === gameState.lastRelocatedRingCoords.r) return false;
        
        // Simulation: Does board remain connected?
        const tempRings = gameState.rings.filter(r => r !== ring);
        return isBoardConnected(tempRings);
    }

    function isBoardConnected(rings) {
        if (rings.length <= 1) return true;
        const visited = new Set();
        const queue = [rings[0]];
        visited.add(`${rings[0].q},${rings[0].r}`);
        
        let count = 0;
        while (queue.length > 0) {
            const current = queue.shift();
            count++;
            const neighbors = getNeighbors(current.q, current.r, rings);
            for (let neighbor of neighbors) {
                const key = `${neighbor.q},${neighbor.r}`;
                if (!visited.has(key)) { 
                    visited.add(key); 
                    queue.push(neighbor); 
                }
            }
        }
        return count === rings.length;
    }

    function checkWinCondition(player) {
        const playerPawns = gameState.rings.filter(r => r.pawn === player);
        if (playerPawns.length < 3) return false; // Should not happen
        
        const [p1, p2, p3] = playerPawns;
        // Helper to check adjacency
        const areNeighbors = (a, b) => getNeighbors(a.q, a.r).some(n => n.q === b.q && n.r === b.r);
        
        // Win if all 3 form a connected group (triangle or line)
        return (areNeighbors(p1, p2) && areNeighbors(p1, p3)) || 
               (areNeighbors(p1, p2) && areNeighbors(p2, p3)) || 
               (areNeighbors(p1, p3) && areNeighbors(p2, p3));
    }
    
    function updateStatus() {
        if (gameState.winner) {
             statusText.textContent = `¡El Jugador ${gameState.winner === 1 ? 'Rojo' : 'Azul'} ha ganado!`;
             statusText.style.color = gameState.winner === 1 ? '#e74c3c' : '#3498db';
             return;
        }
        
        let text = "";
        if (isOnline) {
             text += `(Tú eres ${myPlayerId === 1 ? 'Rojo' : 'Azul'}) - `;
        }
        
        text += `Turno del ${gameState.currentPlayer === 1 ? 'Rojo' : 'Azul'}. `;
        if (gameState.turnPhase === 'MOVE_PAWN') text += 'Mueve peón.';
        else text += 'Mueve aro.';
        
        statusText.textContent = text;
        statusText.style.color = '#333';
    }

    function highlightElements() {
        // Clear previous highlights
        document.querySelectorAll('.ring').forEach(r => r.classList.remove('selected', 'valid-move', 'peripheral'));
        
        // If online and not my turn, don't show hints
        if (isOnline && gameState.currentPlayer !== myPlayerId) return;

        // Highlight selected pawn
        if (gameState.selectedPawn) {
            const ringEl = document.querySelector(`[data-q="${gameState.selectedPawn.q}"][data-r="${gameState.selectedPawn.r}"]`);
            if(ringEl) ringEl.classList.add('selected');
        }

        // Highlight valid pawn moves
        if (gameState.turnPhase === 'MOVE_PAWN' && gameState.selectedPawn) {
            gameState.rings.forEach(ring => {
                if (isValidPawnMove(gameState.selectedPawn, ring)) {
                    const ringEl = document.querySelector(`[data-q="${ring.q}"][data-r="${ring.r}"]`);
                    if(ringEl) ringEl.classList.add('valid-move');
                }
            });
        }

        // Highlight movable rings
        if (gameState.turnPhase === 'RELOCATE_RING') {
             gameState.rings.forEach(ring => {
                if (isValidRingToRemove(ring)) {
                    const ringEl = document.querySelector(`[data-q="${ring.q}"][data-r="${ring.r}"]`);
                    if(ringEl) ringEl.classList.add('peripheral');
                }
            });
        }
    }

    // Default to local game if no room in URL
    if (!isOnline) {
        initGame(); 
    }
    window.addEventListener('resize', renderBoard);
});