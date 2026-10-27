// --- IMPORTACIONES DE FIREBASE ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, set, onValue, update, get } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

// --- TU CONFIGURACIÓN REAL DE FIREBASE ---
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

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

document.addEventListener('DOMContentLoaded', () => {
    const svg = document.getElementById('game-board');
    const statusText = document.getElementById('status-text');
    const btnCreate = document.getElementById('btn-create-game');
    const btnJoin = document.getElementById('btn-join'); 
    const inputRoom = document.getElementById('room-input'); 
    const connectionPanel = document.getElementById('connection-panel');
    const btnModeToggle = document.getElementById('btn-mode-toggle');
    
    // Elementos para copiar link de sala
    const roomDisplay = document.getElementById('room-display');
    const roomCodeText = document.getElementById('room-code-text');
    const btnCopy = document.getElementById('btn-copy');

    const RING_SIZE = 50;
    const HEX_DIRECTIONS = [
        { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
        { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 }
    ];

    // --- LISTAS PARA NOMBRES DE SALA ---
    const adjetivos = ['peludo', 'rabioso', 'colorado', 'andino', 'mistico', 'matero', 'loco', 'turuleco', 'feliz', 'rimbombante', 'cosmico', 'ninja', 'preniado'];
    const animales = ['puma', 'zorro', 'condor', 'carpincho', 'dragon', 'tigre', 'lobo', 'oso', 'choike', 'gato', 'orangutan', 'lycalopex', 'mandril'];

    function generarNombreSala() {
        const adj = adjetivos[Math.floor(Math.random() * adjetivos.length)];
        const ani = animales[Math.floor(Math.random() * animales.length)];
        const num = Math.floor(Math.random() * 99); 
        return `${ani}-${adj}-${num}`;
    }

    // --- Variables Online y Bot ---
    let roomId = null;
    let myPlayerId = null; 
    let isOnline = false;
    let isSpectator = false;

    // Modos locales: 'bot-medium', 'bot-hard', 'bot-easy', 'local-2p'
    const modes = [
        { id: 'bot-medium', label: 'Modo: vs Bot (Medio)', isBot: true, diff: 'medium' },
        { id: 'bot-hard',   label: 'Modo: vs Bot (Difícil)', isBot: true, diff: 'hard' },
        { id: 'bot-easy',   label: 'Modo: vs Bot (Fácil)', isBot: true, diff: 'easy' },
        { id: 'local-2p',   label: 'Modo: 2 Jugadores acá', isBot: false, diff: null }
    ];
    let currentModeIndex = 0;
    const BOT_PLAYER = 2; // El Bot juega con Azul
    let botThinking = false;
    let botTimeouts = [];

    function clearBotTimeouts() {
        botTimeouts.forEach(t => clearTimeout(t));
        botTimeouts = [];
        botThinking = false;
    }

    if (btnModeToggle) {
        btnModeToggle.addEventListener('click', () => {
            currentModeIndex = (currentModeIndex + 1) % modes.length;
            btnModeToggle.textContent = modes[currentModeIndex].label;
            initGame();
        });
    }

    // --- ESTADO DEL JUEGO ---
    let gameState = {
        rings: [],
        currentPlayer: 1,
        turnPhase: 'MOVE_PAWN',
        selectedPawn: null,
        lastRelocatedRingCoords: null,
        winner: null,
        playerCount: 1
    };

    let carryState = {
        isCarrying: false,
        carriedElement: null,
        originalRing: null,
    };

    // --- Cámara dinámica + Deslizar (Pan) ---
    let currentViewBoxSize = 600;
    let currentCenter = { x: 300, y: 300 };
    let panOffset = { x: 0, y: 0 };
    let panState = { isPanning: false, startX: 0, startY: 0, initialPanX: 0, initialPanY: 0 };

    // --- Coordenadas Hexagonales ---
    const axialToPixel = (q, r) => {
        const x = RING_SIZE * (3 / 2 * q);
        const y = RING_SIZE * (Math.sqrt(3) / 2 * q + Math.sqrt(3) * r);
        return { x, y };
    };

    const pixelToAxial = (clientX, clientY) => {
        let pt = svg.createSVGPoint();
        pt.x = clientX;
        pt.y = clientY;
        let svgP = pt.matrixTransform(svg.getScreenCTM().inverse());

        const relativeX = svgP.x - currentCenter.x; 
        const relativeY = svgP.y - currentCenter.y;

        const q_frac = (2 / 3 * relativeX) / RING_SIZE;
        const r_frac = (-1 / 3 * relativeX + Math.sqrt(3) / 3 * relativeY) / RING_SIZE;
        const s_frac = -q_frac - r_frac;
        let q = Math.round(q_frac);
        let r = Math.round(r_frac);
        let s = Math.round(s_frac);
        const q_diff = Math.abs(q - q_frac);
        const r_diff = Math.abs(r - r_frac);
        const s_diff = Math.abs(s - s_frac);
        if (q_diff > r_diff && q_diff > s_diff) q = -r - s;
        else if (r_diff > s_diff) r = -q - s;
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

    function hexDist(a, b) {
        return (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs((-a.q - a.r) - (-b.q - b.r))) / 2;
    }

    // --- LOGICA DE BOTONES Y URL ---
    const urlParams = new URLSearchParams(window.location.search);
    const urlRoom = urlParams.get('room');

    if (urlRoom) {
        if (connectionPanel) connectionPanel.style.display = 'none';
        roomId = urlRoom;
        isOnline = true;
        
        if (roomDisplay) {
            roomDisplay.style.display = 'flex';
            roomCodeText.textContent = roomId;
            
            // Copia el link completo (ej: https://nonaga.com/?room=...)
            btnCopy.addEventListener('click', () => {
                const linkCompleto = window.location.href;
                navigator.clipboard.writeText(linkCompleto).then(() => {
                    btnCopy.textContent = "¡Link copiado!";
                    setTimeout(() => btnCopy.textContent = "📋 Copiar Link", 2000);
                });
            });
        }

        statusText.innerHTML = `Conectando a sala: <b>${roomId}</b>...`; 
        joinGame(roomId);
    }

    if (btnCreate) {
        btnCreate.addEventListener('click', () => {
            const nuevoNombre = generarNombreSala();
            window.location.search = `?room=${nuevoNombre}`;
        });
    }

    if (btnJoin) {
        btnJoin.addEventListener('click', () => {
            let salaEscrita = inputRoom.value.trim(); 
            if (salaEscrita) {
                if (salaEscrita.includes('room=')) {
                    try {
                        salaEscrita = new URL(salaEscrita).searchParams.get('room') || salaEscrita;
                    } catch (_) {}
                }
                window.location.search = `?room=${salaEscrita}`;
            } else {
                alert("Por favor escribe un nombre de sala primero.");
            }
        });
    }

    // --- LÓGICA DE FIREBASE ---
    function joinGame(id) {
        const gameRef = ref(db, 'games/' + id);
        
        get(gameRef).then((snapshot) => {
            if (snapshot.exists()) {
                const data = snapshot.val();
                const storedId = localStorage.getItem(`nonaga_player_${id}`);

                if (storedId) {
                    myPlayerId = parseInt(storedId);
                } else {
                    if (data.playerCount && data.playerCount >= 2) {
                        alert("¡La sala está llena! Estás entrando en modo ESPECTADOR.");
                        isSpectator = true;
                        myPlayerId = 0;
                        statusText.style.color = "purple";
                    } else {
                        myPlayerId = 2;
                        localStorage.setItem(`nonaga_player_${id}`, 2);
                        update(gameRef, { playerCount: 2 });
                    }
                }
            } else {
                myPlayerId = 1;
                localStorage.setItem(`nonaga_player_${id}`, 1);
                initGame(); 
                gameState.playerCount = 1; 
                saveGameState(); 
            }
            
            onValue(gameRef, (snap) => {
                const serverData = snap.val();
                if (serverData) {
                    const currentCount = serverData.playerCount || gameState.playerCount;
                    gameState = serverData;
                    gameState.playerCount = currentCount;
                    
                    renderBoard();
                    updateStatus();
                }
            });
        }).catch((err) => {
            console.error(err);
            statusText.textContent = `Error conectando a Firebase (${err.code || err.message}). Revisá las Reglas de Realtime Database.`;
            statusText.style.color = '#e74c3c';
        });
    }

    function saveGameState() {
        if (!isOnline) return;
        set(ref(db, 'games/' + roomId), gameState);
    }

    // --- Inicialización ---
    function initGame() {
        clearBotTimeouts();
        panOffset = { x: 0, y: 0 };
        const initialCoords = [];
        const radius = 2;
        for (let q = -radius; q <= radius; q++) {
            for (let r = -radius; r <= radius; r++) {
                if (Math.abs(q + r) <= radius) initialCoords.push({q, r});
            }
        }
        gameState.rings = initialCoords.map(coords => ({ ...coords, pawn: null }));
        const pawnPositions = [
            { q: 0, r: -2, player: 1 }, { q: 2, r: 0, player: 1 }, { q: -2, r: 2, player: 1 },
            { q: 2, r: -2, player: 2 }, { q: 0, r: 2, player: 2 }, { q: -2, r: 0, player: 2 }
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

    function updateCameraBounds() {
        if (!gameState.rings || gameState.rings.length === 0) {
            currentViewBoxSize = 600;
            currentCenter = { x: 300 + panOffset.x, y: 300 + panOffset.y };
            return;
        }
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        gameState.rings.forEach(ring => {
            const p = axialToPixel(ring.q, ring.r);
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.y > maxY) maxY = p.y;
        });
        const padding = RING_SIZE * 2.5;
        const spanX = (maxX - minX) + padding * 2;
        const spanY = (maxY - minY) + padding * 2;
        currentViewBoxSize = Math.max(600, Math.ceil(Math.max(spanX, spanY)));
        const midX = (minX + maxX) / 2;
        const midY = (minY + maxY) / 2;
        currentCenter = {
            x: currentViewBoxSize / 2 - midX + panOffset.x,
            y: currentViewBoxSize / 2 - midY + panOffset.y
        };
    }

    // --- Renderizado ---
    function renderBoard() {
        svg.innerHTML = '';
        updateCameraBounds();
        svg.setAttribute('viewBox', `0 0 ${currentViewBoxSize} ${currentViewBoxSize}`);

        gameState.rings.forEach(ring => {
            const pixel = axialToPixel(ring.q, ring.r);
            const points = Array.from({ length: 6 }, (_, i) => {
                const corner = getHexCorner({ x: 0, y: 0 }, RING_SIZE, i);
                return `${corner.x},${corner.y}`;
            }).join(' ');
            const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            polygon.setAttribute('points', points);
            polygon.setAttribute('class', 'ring');
            polygon.setAttribute('transform', `translate(${currentCenter.x + pixel.x}, ${currentCenter.y + pixel.y})`);
            polygon.dataset.q = ring.q;
            polygon.dataset.r = ring.r;
            polygon.addEventListener('click', onRingClick);
            polygon.addEventListener('touchstart', (e) => {
                e.preventDefault();
                onRingClick(e);
            }, {passive: false});
            svg.appendChild(polygon);
        });

        gameState.rings.forEach(ring => {
            if (ring.pawn) {
                const pixel = axialToPixel(ring.q, ring.r);
                const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                circle.setAttribute('cx', currentCenter.x + pixel.x);
                circle.setAttribute('cy', currentCenter.y + pixel.y);
                circle.setAttribute('r', RING_SIZE * 0.5);
                circle.setAttribute('class', `pawn player${ring.pawn}`);
                circle.style.pointerEvents = 'none';
                svg.appendChild(circle);
            }
        });
        highlightElements();
    }

    // --- Deslizar / Panear el tablero arrastrando el fondo ---
    function startPan(e) {
        if (carryState.isCarrying || e.target !== svg) return;
        const pt = e.touches && e.touches.length > 0 ? e.touches[0] : e;
        panState.isPanning = true;
        panState.startX = pt.clientX;
        panState.startY = pt.clientY;
        panState.initialPanX = panOffset.x;
        panState.initialPanY = panOffset.y;
        svg.style.cursor = 'grabbing';
    }

    function movePan(e) {
        if (!panState.isPanning) return;
        if (e.type === 'touchmove') e.preventDefault();
        const pt = e.touches && e.touches.length > 0 ? e.touches[0] : e;
        const ctm = svg.getScreenCTM();
        const scale = ctm ? ctm.a : 1;
        panOffset.x = panState.initialPanX + (pt.clientX - panState.startX) / scale;
        panOffset.y = panState.initialPanY + (pt.clientY - panState.startY) / scale;
        renderBoard();
    }

    function endPan() {
        if (!panState.isPanning) return;
        panState.isPanning = false;
        svg.style.cursor = 'grab';
    }

    svg.style.cursor = 'grab';
    svg.addEventListener('mousedown', startPan);
    svg.addEventListener('touchstart', startPan, { passive: false });
    document.addEventListener('mousemove', movePan);
    document.addEventListener('touchmove', movePan, { passive: false });
    document.addEventListener('mouseup', endPan);
    document.addEventListener('touchend', endPan);

    // --- Manejo de Eventos ---
    function onRingClick(event) {
        event.stopPropagation();
        
        if (isSpectator) return;
        if (isOnline && gameState.currentPlayer !== myPlayerId) return;
        if (!isOnline && modes[currentModeIndex].isBot && (gameState.currentPlayer === BOT_PLAYER || botThinking)) return;
        if (gameState.winner) return;

        const q = parseInt(event.target.dataset.q);
        const r = parseInt(event.target.dataset.r);
        const clickedRing = findRing(q, r);

        if (gameState.turnPhase === 'MOVE_PAWN') {
            handlePawnMovePhase(clickedRing);
            return;
        }
        if (gameState.turnPhase === 'RELOCATE_RING') {
            if (carryState.isCarrying) return;
            if (isValidRingToRemove(clickedRing)) startCarryingRing(clickedRing, event.target);
        }
    }

    function startCarryingRing(ring, visualElement) {
        carryState.isCarrying = true;
        carryState.originalRing = ring;
        carryState.carriedElement = visualElement.cloneNode(true);
        carryState.carriedElement.style.pointerEvents = 'none';
        carryState.carriedElement.style.opacity = '0.7';
        carryState.carriedElement.classList.add('dragging');
        svg.appendChild(carryState.carriedElement);
        visualElement.style.opacity = '0.2';
        document.addEventListener('mousemove', onDocumentMouseMove);
        document.addEventListener('touchmove', onDocumentMouseMove, { passive: false });
        setTimeout(() => { 
            document.addEventListener('click', tryPlaceRing);
            document.addEventListener('touchend', tryPlaceRing);
        }, 50);
    }

    function onDocumentMouseMove(event) {
        if (!carryState.isCarrying) return;

        if (event.type === 'touchmove') {
            event.preventDefault();
        }

        let clientX, clientY;
        if (event.touches && event.touches.length > 0) {
            clientX = event.touches[0].clientX;
            clientY = event.touches[0].clientY;
        } else {
            clientX = event.clientX;
            clientY = event.clientY;
        }

        let pt = svg.createSVGPoint();
        pt.x = clientX;
        pt.y = clientY;
        let svgP = pt.matrixTransform(svg.getScreenCTM().inverse());
        carryState.carriedElement.setAttribute('transform', `translate(${svgP.x}, ${svgP.y})`);
    }

    function tryPlaceRing(event) {
        if (!carryState.isCarrying) return;
        document.removeEventListener('mousemove', onDocumentMouseMove);
        document.removeEventListener('touchmove', onDocumentMouseMove);
        document.removeEventListener('click', tryPlaceRing);
        document.removeEventListener('touchend', tryPlaceRing);
        if (carryState.carriedElement) {
            carryState.carriedElement.remove();
            carryState.carriedElement = null;
        }
        carryState.isCarrying = false;
        let clientX, clientY;
        if(event.changedTouches && event.changedTouches.length > 0) {
             clientX = event.changedTouches[0].clientX;
             clientY = event.changedTouches[0].clientY;
        } else {
             clientX = event.clientX;
             clientY = event.clientY;
        }
        
        const targetAxial = pixelToAxial(clientX, clientY);
        const originRing = carryState.originalRing;

        if (originRing.q === targetAxial.q && originRing.r === targetAxial.r) {
            renderBoard(); return;
        }

        const otherRings = gameState.rings.filter(r => r !== originRing);
        const isOccupied = otherRings.some(r => r.q === targetAxial.q && r.r === targetAxial.r);
        let touchingCount = 0;
        HEX_DIRECTIONS.forEach(dir => {
            if (otherRings.some(r => r.q === targetAxial.q + dir.q && r.r === targetAxial.r + dir.r)) touchingCount++;
        });

        if (!isOccupied && touchingCount >= 2) {
            originRing.q = targetAxial.q;
            originRing.r = targetAxial.r;
            gameState.lastRelocatedRingCoords = { q: targetAxial.q, r: targetAxial.r };
            gameState.currentPlayer = gameState.currentPlayer === 1 ? 2 : 1;
            gameState.turnPhase = 'MOVE_PAWN';
            renderBoard(); updateStatus(); saveGameState();
            maybeTriggerBotTurn();
        } else {
            renderBoard();
        }
    }

    function handlePawnMovePhase(clickedRing) {
        if (!gameState.selectedPawn) {
            if (clickedRing.pawn === gameState.currentPlayer) gameState.selectedPawn = clickedRing;
        } else {
            const from = gameState.selectedPawn;
            const to = clickedRing;
            if (from === to) {
                gameState.selectedPawn = null;
            } else if (isValidPawnMove(from, to)) {
                to.pawn = from.pawn;
                from.pawn = null;
                gameState.selectedPawn = null;
                if (checkWinCondition(to.pawn)) gameState.winner = to.pawn;
                else gameState.turnPhase = 'RELOCATE_RING';
                saveGameState();
            } else {
                if (to.pawn === gameState.currentPlayer) gameState.selectedPawn = to;
            }
        }
        renderBoard(); updateStatus();
    }

    // --- Helpers ---
    function findRing(q, r, ringsList = gameState.rings) { return ringsList.find(ring => ring.q === q && ring.r === r); }
    function getNeighbors(q, r, ringsList = gameState.rings) {
        return HEX_DIRECTIONS.map(dir => {
            const nQ = q + dir.q;
            const nR = r + dir.r;
            return ringsList.find(ring => ring.q === nQ && ring.r === nR);
        }).filter(Boolean);
    }
    function isValidPawnMove(from, to, ringsList = gameState.rings) {
        if (!from || !to || to.pawn) return false;
        const dq = to.q - from.q;
        const dr = to.r - from.r;
        const ds = (-to.q - to.r) - (-from.q - from.r);
        if (dq === 0 || dr === 0 || ds === 0) {
            const dist = (Math.abs(dq) + Math.abs(dr) + Math.abs(ds)) / 2;
            if (dist === 0) return false;
            const stepQ = dq / dist;
            const stepR = dr / dist;
            for (let i = 1; i < dist; i++) {
                const intermediateRing = findRing(from.q + stepQ * i, from.r + stepR * i, ringsList);
                if (!intermediateRing || intermediateRing.pawn) return false;
            }
            const nextQ = to.q + stepQ;
            const nextR = to.r + stepR;
            const nextRing = findRing(nextQ, nextR, ringsList);
            if (nextRing && !nextRing.pawn) return false;
            return true;
        }
        return false;
    }
    function isPeripheral(ring, ringsList = gameState.rings) { return getNeighbors(ring.q, ring.r, ringsList).length < 6; }
    function isValidRingToRemove(ring, ringsList = gameState.rings, lastCoords = gameState.lastRelocatedRingCoords) {
        if (!ring || ring.pawn || !isPeripheral(ring, ringsList)) return false;
        if (lastCoords && ring.q === lastCoords.q && ring.r === lastCoords.r) return false;
        const tempRings = ringsList.filter(r => r !== ring);
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
                if (!visited.has(key)) { visited.add(key); queue.push(neighbor); }
            }
        }
        return count === rings.length;
    }
    function checkWinCondition(player, ringsList = gameState.rings) {
        const playerPawns = ringsList.filter(r => r.pawn === player);
        if (playerPawns.length < 3) return false;
        const [p1, p2, p3] = playerPawns;
        const d12 = hexDist(p1, p2) === 1;
        const d13 = hexDist(p1, p3) === 1;
        const d23 = hexDist(p2, p3) === 1;
        return (d12 && d13) || (d12 && d23) || (d13 && d23);
    }

    // --- INTELIGENCIA ARTIFICIAL (BOT) ---
    function cloneRings(rings) {
        return rings.map(r => ({ q: r.q, r: r.r, pawn: r.pawn || null }));
    }

    function getLegalPawnMovesPure(rings, player) {
        const moves = [];
        const playerRings = rings.filter(r => r.pawn === player);
        for (const from of playerRings) {
            for (const dir of HEX_DIRECTIONS) {
                let step = 1;
                let lastValid = null;
                while (true) {
                    const nextRing = findRing(from.q + dir.q * step, from.r + dir.r * step, rings);
                    if (!nextRing || nextRing.pawn) break;
                    lastValid = nextRing;
                    step++;
                }
                if (lastValid) {
                    moves.push({ fromQ: from.q, fromR: from.r, toQ: lastValid.q, toR: lastValid.r });
                }
            }
        }
        return moves;
    }

    function getValidRingTargetsPure(rings, ringToRemove) {
        const otherRings = rings.filter(r => !(r.q === ringToRemove.q && r.r === ringToRemove.r));
        const occupiedSet = new Set(otherRings.map(r => `${r.q},${r.r}`));
        const candidateCounts = new Map();

        for (const r of otherRings) {
            for (const dir of HEX_DIRECTIONS) {
                const cQ = r.q + dir.q;
                const cR = r.r + dir.r;
                if (cQ === ringToRemove.q && cR === ringToRemove.r) continue;
                const key = `${cQ},${cR}`;
                if (occupiedSet.has(key)) continue;
                candidateCounts.set(key, (candidateCounts.get(key) || 0) + 1);
            }
        }

        const targets = [];
        for (const [key, count] of candidateCounts.entries()) {
            if (count >= 2) {
                const [qStr, rStr] = key.split(',');
                targets.push({ q: parseInt(qStr, 10), r: parseInt(rStr, 10) });
            }
        }
        return targets;
    }

    function clusterDistance(rings, player) {
        const pawns = rings.filter(r => r.pawn === player);
        if (pawns.length < 3) return 99;
        const d12 = hexDist(pawns[0], pawns[1]);
        const d13 = hexDist(pawns[0], pawns[2]);
        const d23 = hexDist(pawns[1], pawns[2]);
        return Math.min(d12 + d13, d12 + d23, d13 + d23);
    }

    function countImmediateWinningMoves(rings, player) {
        const moves = getLegalPawnMovesPure(rings, player);
        let wins = 0;
        for (const m of moves) {
            const nextRings = cloneRings(rings);
            findRing(m.fromQ, m.fromR, nextRings).pawn = null;
            findRing(m.toQ, m.toR, nextRings).pawn = player;
            if (checkWinCondition(player, nextRings)) wins++;
        }
        return wins;
    }

    function computeBestBotTurn() {
        const diff = modes[currentModeIndex].diff || 'medium';
        const initialRings = cloneRings(gameState.rings);
        const pawnMoves = getLegalPawnMovesPure(initialRings, BOT_PLAYER);
        if (pawnMoves.length === 0) return null;

        for (const pm of pawnMoves) {
            const afterPawn = cloneRings(initialRings);
            findRing(pm.fromQ, pm.fromR, afterPawn).pawn = null;
            findRing(pm.toQ, pm.toR, afterPawn).pawn = BOT_PLAYER;
            if (checkWinCondition(BOT_PLAYER, afterPawn)) {
                if (diff !== 'easy' || Math.random() < 0.7) {
                    return { pawnMove: pm, ringMove: null };
                }
            }
        }

        const candidates = [];
        for (const pm of pawnMoves) {
            const afterPawn = cloneRings(initialRings);
            findRing(pm.fromQ, pm.fromR, afterPawn).pawn = null;
            findRing(pm.toQ, pm.toR, afterPawn).pawn = BOT_PLAYER;

            const removable = afterPawn.filter(r =>
                isValidRingToRemove(r, afterPawn, gameState.lastRelocatedRingCoords)
            );

            for (const rem of removable) {
                const targets = getValidRingTargetsPure(afterPawn, rem);
                for (const target of targets) {
                    const afterRing = cloneRings(afterPawn);
                    const moved = findRing(rem.q, rem.r, afterRing);
                    moved.q = target.q;
                    moved.r = target.r;

                    const botDist = clusterDistance(afterRing, BOT_PLAYER);
                    const humanDist = clusterDistance(afterRing, 1);
                    let score = 0;

                    if (diff === 'easy') {
                        score = -botDist * 15 + Math.random() * 45;
                    } else if (diff === 'medium') {
                        const humanWins = countImmediateWinningMoves(afterRing, 1);
                        score = (humanWins > 0 ? -15000 * humanWins : 0) - botDist * 60 + humanDist * 35 + Math.random() * 18;
                    } else {
                        const humanWins = countImmediateWinningMoves(afterRing, 1);
                        const botThreats = countImmediateWinningMoves(afterRing, BOT_PLAYER);
                        score = (humanWins > 0 ? -50000 * humanWins : 0) + botThreats * 450 - botDist * 120 + humanDist * 95 + Math.random() * 4;
                    }

                    candidates.push({
                        pawnMove: pm,
                        ringMove: { fromQ: rem.q, fromR: rem.r, toQ: target.q, toR: target.r },
                        score
                    });
                }
            }
        }

        if (candidates.length === 0) return null;
        candidates.sort((a, b) => b.score - a.score);
        return candidates[0];
    }

    function maybeTriggerBotTurn() {
        if (isOnline || !modes[currentModeIndex].isBot || gameState.winner) return;
        if (gameState.currentPlayer !== BOT_PLAYER) return;

        botThinking = true;
        updateStatus();

        const t1 = setTimeout(() => {
            const plan = computeBestBotTurn();
            if (!plan) { botThinking = false; return; }

            const fromRing = findRing(plan.pawnMove.fromQ, plan.pawnMove.fromR);
            gameState.selectedPawn = fromRing;
            renderBoard();

            const t2 = setTimeout(() => {
                const toRing = findRing(plan.pawnMove.toQ, plan.pawnMove.toR);
                if (fromRing && toRing) {
                    toRing.pawn = BOT_PLAYER;
                    fromRing.pawn = null;
                }
                gameState.selectedPawn = null;

                if (checkWinCondition(BOT_PLAYER)) {
                    gameState.winner = BOT_PLAYER;
                    botThinking = false;
                    renderBoard(); updateStatus();
                    return;
                }

                gameState.turnPhase = 'RELOCATE_RING';
                renderBoard(); updateStatus();

                const t3 = setTimeout(() => {
                    if (plan.ringMove) {
                        const ringToMove = findRing(plan.ringMove.fromQ, plan.ringMove.fromR);
                        if (ringToMove) {
                            ringToMove.q = plan.ringMove.toQ;
                            ringToMove.r = plan.ringMove.toR;
                            gameState.lastRelocatedRingCoords = { q: plan.ringMove.toQ, r: plan.ringMove.toR };
                        }
                    }
                    gameState.currentPlayer = 1;
                    gameState.turnPhase = 'MOVE_PAWN';
                    botThinking = false;
                    renderBoard(); updateStatus();
                }, 450);
                botTimeouts.push(t3);
            }, 400);
            botTimeouts.push(t2);
        }, 400);
        botTimeouts.push(t1);
    }
    
    function updateStatus() {
        if (isSpectator) {
            statusText.textContent = `Sala llena. Estás viendo la partida como ESPECTADOR.`;
            statusText.style.color = 'purple';
            return;
        }

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
        else text += 'Mueve Hexágono vacío del borde.';
        
        statusText.textContent = text;
        statusText.style.color = '#333';
    }

    function highlightElements() {
        document.querySelectorAll('.ring').forEach(r => r.classList.remove('selected', 'valid-move', 'peripheral'));
        
        if (isSpectator) return;
        if (isOnline && gameState.currentPlayer !== myPlayerId) return;
        if (!isOnline && modes[currentModeIndex].isBot && gameState.currentPlayer === BOT_PLAYER) {
            if (gameState.selectedPawn) {
                const botEl = document.querySelector(`[data-q="${gameState.selectedPawn.q}"][data-r="${gameState.selectedPawn.r}"]`);
                if (botEl) botEl.classList.add('selected');
            }
            return;
        }

        if (gameState.selectedPawn) {
            const ringEl = document.querySelector(`[data-q="${gameState.selectedPawn.q}"][data-r="${gameState.selectedPawn.r}"]`);
            if(ringEl) ringEl.classList.add('selected');
        }
        if (gameState.turnPhase === 'MOVE_PAWN' && gameState.selectedPawn) {
            gameState.rings.forEach(ring => {
                if (isValidPawnMove(gameState.selectedPawn, ring)) {
                    const ringEl = document.querySelector(`[data-q="${ring.q}"][data-r="${ring.r}"]`);
                    if(ringEl) ringEl.classList.add('valid-move');
                }
            });
        }
        if (gameState.turnPhase === 'RELOCATE_RING') {
            gameState.rings.forEach(ring => {
                if (isValidRingToRemove(ring)) {
                    const ringEl = document.querySelector(`[data-q="${ring.q}"][data-r="${ring.r}"]`);
                    if(ringEl) ringEl.classList.add('peripheral');
                }
            });
        }
    }

    if (!isOnline) {
        initGame(); 
    }
    window.addEventListener('resize', renderBoard);
});
