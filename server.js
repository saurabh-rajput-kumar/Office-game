const express = require('express');
const { Server } = require('socket.io');
const http = require('http');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const rooms = new Map();

io.on('connection', (socket) => {
    socket.on('join-room', (roomId, playerName, playerColor) => {
        socket.join(roomId);
        if (!rooms.has(roomId)) {
            rooms.set(roomId, { players: new Map(), host: socket.id });
        }
        const room = rooms.get(roomId);
        const spawns = [[-8,2,-8], [8,2,-8], [-8,2,8], [8,2,8]];
        const idx = room.players.size % 4;
        
        const playerData = {
            id: socket.id,
            name: playerName || 'Anonymous',
            color: playerColor || 0xff4444,
            x: spawns[idx][0], y: spawns[idx][1], z: spawns[idx][2],
            rotation: 0, health: 100
        };
        
        room.players.set(socket.id, playerData);
        socket.playerData = playerData;
        socket.roomId = roomId;
        
        socket.emit('current-players', Array.from(room.players.values()));
        socket.to(roomId).emit('player-joined', playerData);
    });

    socket.on('player-update', (data) => {
        if (socket.roomId && rooms.has(socket.roomId)) {
            const room = rooms.get(socket.roomId);
            const player = room.players.get(socket.id);
            if (player) {
                Object.assign(player, data);
                socket.to(socket.roomId).emit('player-moved', { id: socket.id, ...data });
            }
        }
    });

    socket.on('throw-object', (data) => {
        if (socket.roomId) {
            socket.to(socket.roomId).emit('object-thrown', { ...data, playerId: socket.id });
        }
    });

    socket.on('player-hit', (data) => {
        if (socket.roomId) {
            io.to(socket.roomId).emit('damage-dealt', data);
        }
    });

    socket.on('disconnect', () => {
        if (socket.roomId) {
            const room = rooms.get(socket.roomId);
            if (room) {
                room.players.delete(socket.id);
                io.to(socket.roomId).emit('player-left', socket.id);
                if (room.players.size === 0) rooms.delete(socket.roomId);
            }
        }
    });
});

app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>Office Battle Royale 3D</title>
    <script src="/socket.io/socket.io.js"></script>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; touch-action: none; -webkit-touch-callout: none; }
        body { overflow: hidden; background: #0a0a0a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; position: fixed; width: 100%; height: 100%; }
        #gameCanvas { width: 100%; height: 100%; display: block; }
        .screen { position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%); display: flex; flex-direction: column; justify-content: center; align-items: center; color: white; z-index: 100; padding: 20px; }
        .hidden { display: none !important; }
        h1 { font-size: 2.8rem; margin-bottom: 10px; text-shadow: 0 0 20px rgba(255,107,107,0.5); letter-spacing: 2px; }
        .subtitle { opacity: 0.9; margin-bottom: 30px; font-size: 1.2rem; color: #eee; }
        input, button { padding: 15px; margin: 8px; font-size: 16px; border-radius: 25px; border: none; width: 90%; max-width: 320px; outline: none; }
        input { background: rgba(255,255,255,0.95); text-align: center; box-shadow: 0 4px 15px rgba(0,0,0,0.2); }
        button { background: linear-gradient(135deg, #ff6b6b, #ee5a6f); color: white; font-weight: bold; cursor: pointer; box-shadow: 0 6px 20px rgba(238,90,111,0.4); transition: all 0.3s; }
        button:active { transform: scale(0.95); box-shadow: 0 2px 10px rgba(238,90,111,0.4); }
        .color-selection { display: flex; gap: 12px; margin: 20px 0; flex-wrap: wrap; justify-content: center; }
        .color-btn { width: 55px; height: 55px; border-radius: 50%; border: 3px solid transparent; cursor: pointer; transition: all 0.2s; box-shadow: 0 4px 10px rgba(0,0,0,0.3); }
        .color-btn.selected { border-color: white; transform: scale(1.15); box-shadow: 0 0 20px rgba(255,255,255,0.6); }
        .instructions { background: rgba(255,255,255,0.1); padding: 20px; border-radius: 15px; margin-top: 25px; font-size: 0.9rem; line-height: 1.5; max-width: 400px; text-align: center; backdrop-filter: blur(10px); border: 1px solid rgba(255,255,255,0.1); }
        #hud { position: absolute; top: 10px; left: 10px; right: 10px; display: flex; justify-content: space-around; flex-wrap: wrap; pointer-events: none; z-index: 40; gap: 5px; }
        .player-card { background: rgba(0,0,0,0.7); padding: 10px 15px; border-radius: 25px; font-size: 13px; display: flex; align-items: center; gap: 10px; border: 2px solid; backdrop-filter: blur(5px); box-shadow: 0 4px 10px rgba(0,0,0,0.3); }
        .player-card.local { background: rgba(255,255,255,0.15); font-weight: bold; border-width: 3px; }
        .health-bar { width: 60px; height: 10px; background: rgba(0,0,0,0.5); border-radius: 5px; overflow: hidden; border: 1px solid rgba(255,255,255,0.2); }
        .health-fill { height: 100%; transition: width 0.3s; }
        #touch-controls { position: absolute; bottom: 0; left: 0; width: 100%; height: 240px; pointer-events: none; z-index: 50; display: none; }
        .joystick-zone { position: absolute; width: 150px; height: 150px; background: rgba(255,255,255,0.1); border: 3px solid rgba(255,255,255,0.3); border-radius: 50%; pointer-events: auto; backdrop-filter: blur(5px); transition: background 0.2s; }
        #joystick-move { left: 25px; bottom: 25px; }
        .joystick-zone.active { background: rgba(255,255,255,0.25); }
        .joystick-knob { position: absolute; width: 60px; height: 60px; background: rgba(255,255,255,0.9); border-radius: 50%; top: 50%; left: 50%; transform: translate(-50%, -50%); box-shadow: 0 4px 15px rgba(0,0,0,0.4); border: 2px solid rgba(0,0,0,0.1); }
        #throw-btn { position: absolute; right: 25px; bottom: 25px; width: 110px; height: 110px; border-radius: 50%; background: linear-gradient(135deg, #ff4444, #cc0000); border: 4px solid white; pointer-events: auto; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 16px; text-align: center; user-select: none; color: white; box-shadow: 0 6px 20px rgba(255,68,68,0.4); text-shadow: 0 2px 4px rgba(0,0,0,0.3); transition: transform 0.1s; }
        #throw-btn.charging { background: linear-gradient(135deg, #ffff44, #ffaa00); color: #333; transform: scale(1.1); box-shadow: 0 0 30px rgba(255,255,68,0.6); }
        #game-status { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background: rgba(0,0,0,0.85); padding: 30px 40px; border-radius: 20px; font-size: 28px; font-weight: bold; z-index: 60; display: none; text-align: center; color: white; border: 2px solid rgba(255,255,255,0.1); box-shadow: 0 10px 40px rgba(0,0,0,0.5); }
        .crosshair { position: absolute; top: 50%; left: 50%; width: 20px; height: 20px; border: 2px solid rgba(255,255,255,0.8); border-radius: 50%; transform: translate(-50%, -50%); pointer-events: none; z-index: 30; display: none; }
        .crosshair::after { content: ''; position: absolute; top: 50%; left: 50%; width: 4px; height: 4px; background: white; border-radius: 50%; transform: translate(-50%, -50%); }
    </style>
</head>
<body>
    <div id="menu" class="screen">
        <h1>🏢 OFFICE BATTLE</h1>
        <div class="subtitle">3D Office Warfare</div>
        <input type="text" id="playerName" placeholder="Your Name" maxlength="10" value="Player">
        <input type="text" id="roomCode" placeholder="Room Code" maxlength="8" value="ROOM1">
        <div class="color-selection">
            <div class="color-btn selected" style="background: #ff4444;" data-color="0xff4444" onclick="selectColor(this)"></div>
            <div class="color-btn" style="background: #4444ff;" data-color="0x4444ff" onclick="selectColor(this)"></div>
            <div class="color-btn" style="background: #44ff44;" data-color="0x44ff44" onclick="selectColor(this)"></div>
            <div class="color-btn" style="background: #ffff44;" data-color="0xffff44" onclick="selectColor(this)"></div>
            <div class="color-btn" style="background: #ff44ff;" data-color="0xff44ff" onclick="selectColor(this)"></div>
            <div class="color-btn" style="background: #44ffff;" data-color="0x44ffff" onclick="selectColor(this)"></div>
        </div>
        <button onclick="joinGame()">ENTER OFFICE</button>
        <div class="instructions">
            <strong>📱 Mobile:</strong> Left stick to move, Touch right side to aim, Hold RED button to throw<br><br>
            <strong>💻 Desktop:</strong> WASD to move, Mouse to aim, Click to throw<br><br>
            <small>Throw office furniture at your coworkers!</small>
        </div>
    </div>
    <div id="hud" class="hidden"></div>
    <div class="crosshair" id="crosshair"></div>
    <div id="touch-controls">
        <div class="joystick-zone" id="joystick-move">
            <div class="joystick-knob" id="knob-move"></div>
        </div>
        <div id="throw-btn">HOLD TO<br>THROW</div>
    </div>
    <div id="game-status"></div>
    <canvas id="gameCanvas"></canvas>

    <script type="importmap">
        {
            "imports": {
                "three": "https://unpkg.com/three@0.160.0/build/three.module.js",
                "three/addons/": "https://unpkg.com/three@0.160.0/examples/jsm/",
                "cannon-es": "https://unpkg.com/cannon-es@0.20.0/dist/cannon-es.js"
            }
        }
    </script>

    <script type="module">
        import * as THREE from 'three';
        import * as CANNON from 'cannon-es';

        let socket, roomId, myId, playerColor = 0xff4444;
        let localPlayer = null;
        const remotePlayers = new Map();
        const projectiles = [];
        let world, scene, camera, renderer;
        let lastTime;
        const input = { move: { x: 0, y: 0 }, aim: { x: 0, y: 0 }, charging: false, charge: 0 };
        
        const weapons = [
            { name: 'Coffee Mug', mass: 0.5, damage: 12, size: 0.15, color: 0x8B4513, speed: 1.4 },
            { name: 'Stapler', mass: 1, damage: 18, size: 0.25, color: 0x2c3e50, speed: 1.2 },
            { name: 'Keyboard', mass: 1.5, damage: 22, size: 0.35, color: 0x34495e, speed: 1.1 },
            { name: 'Monitor', mass: 5, damage: 40, size: 0.6, color: 0x1a1a2e, speed: 0.8 },
            { name: 'Office Chair', mass: 8, damage: 50, size: 0.8, color: 0x8e44ad, speed: 0.6 },
            { name: 'Printer', mass: 10, damage: 60, size: 0.9, color: 0x95a5a6, speed: 0.5 }
        ];

        window.selectColor = function(el) {
            document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('selected'));
            el.classList.add('selected');
            playerColor = parseInt(el.dataset.color);
        };

        window.joinGame = function() {
            const name = document.getElementById('playerName').value || 'Anonymous';
            roomId = (document.getElementById('roomCode').value || 'default').toUpperCase();
            document.getElementById('menu').classList.add('hidden');
            document.getElementById('hud').classList.remove('hidden');
            document.getElementById('crosshair').style.display = 'block';
            if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
                document.getElementById('touch-controls').style.display = 'block';
            }
            initConnection(name);
        };

        function initConnection(name) {
            socket = io();
            socket.on('connect', () => {
                myId = socket.id;
                socket.emit('join-room', roomId, name, playerColor);
                initGame();
            });
            socket.on('current-players', (players) => {
                players.forEach(p => { if (p.id !== myId) createRemotePlayer(p); });
                updateHUD();
            });
            socket.on('player-joined', (player) => { createRemotePlayer(player); updateHUD(); });
            socket.on('player-moved', (data) => {
                const player = remotePlayers.get(data.id);
                if (player) { 
                    player.targetPos = new THREE.Vector3(data.x, data.y, data.z); 
                    player.targetRot = data.rotation; 
                    player.health = data.health;
                    if (data.throwAnim) player.throwTime = Date.now();
                }
            });
            socket.on('object-thrown', (data) => { spawnProjectile(data, false); });
            socket.on('damage-dealt', ({target, damage}) => {
                if (target === myId && localPlayer) {
                    localPlayer.health = Math.max(0, localPlayer.health - damage);
                    document.body.style.background = '#ff0000';
                    setTimeout(() => document.body.style.background = '#0a0a0a', 100);
                    if (localPlayer.health <= 0) handleDeath();
                    updateHUD();
                }
            });
            socket.on('player-left', (id) => {
                const player = remotePlayers.get(id);
                if (player) { scene.remove(player.mesh); world.removeBody(player.body); remotePlayers.delete(id); updateHUD(); }
            });
        }

        function initGame() {
            world = new CANNON.World();
            world.gravity.set(0, -30, 0);
            world.broadphase = new CANNON.NaiveBroadphase();
            
            scene = new THREE.Scene();
            scene.background = new THREE.Color(0xd0d0d0);
            scene.fog = new THREE.Fog(0xd0d0d0, 20, 60);
            
            camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
            renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('gameCanvas'), antialias: true, alpha: false });
            renderer.setSize(window.innerWidth, window.innerHeight);
            renderer.shadowMap.enabled = true;
            renderer.shadowMap.type = THREE.PCFSoftShadowMap;
            renderer.outputColorSpace = THREE.SRGBColorSpace;
            
            const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
            scene.add(hemiLight);
            
            const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
            dirLight.position.set(20, 30, 10);
            dirLight.castShadow = true;
            dirLight.shadow.camera.left = -30;
            dirLight.shadow.camera.right = 30;
            dirLight.shadow.camera.top = 30;
            dirLight.shadow.camera.bottom = -30;
            dirLight.shadow.mapSize.width = 2048;
            dirLight.shadow.mapSize.height = 2048;
            dirLight.shadow.camera.far = 100;
            scene.add(dirLight);
            
            const colors = [0xff6b6b, 0x4ecdc4, 0xffe66d, 0x95e1d3];
            for (let i = 0; i < 4; i++) {
                const light = new THREE.PointLight(colors[i], 0.5, 20);
                light.position.set((Math.random()-0.5)*40, 5, (Math.random()-0.5)*40);
                scene.add(light);
            }

            createDetailedOffice();
            createLocalPlayer();
            setupControls();
            lastTime = performance.now();
            animate();
        }

        function createDetailedOffice() {
            const floorGeo = new THREE.PlaneGeometry(60, 60);
            const floorMat = new THREE.MeshStandardMaterial({ 
                color: 0xe0e0e0, 
                roughness: 0.8,
                metalness: 0.1
            });
            const floor = new THREE.Mesh(floorGeo, floorMat);
            floor.rotation.x = -Math.PI/2;
            floor.receiveShadow = true;
            scene.add(floor);
            
            const floorBody = new CANNON.Body({ type: CANNON.Body.STATIC, shape: new CANNON.Plane() });
            floorBody.quaternion.setFromAxisAngle(new CANNON.Vec3(1,0,0), -Math.PI/2);
            world.addBody(floorBody);
            
            const cubiclePositions = [
                [-12, -12, 0], [0, -12, 0], [12, -12, 0],
                [-12, 0, 0], [12, 0, 0],
                [-12, 12, 0], [0, 12, 0], [12, 12, 0]
            ];
            
            cubiclePositions.forEach((pos, idx) => {
                createRealisticCubicle(pos[0], pos[1], pos[2], idx);
            });
            
            createMeetingRoom();
            
            for (let i = 0; i < 6; i++) {
                createPlant((Math.random()-0.5)*50, (Math.random()-0.5)*50);
            }
            
            createWaterCooler(0, -8);
            createWaterCooler(0, 8);
            
            createWhiteboard(-20, 0, Math.PI/2);
            createWhiteboard(20, 0, -Math.PI/2);
        }

        function createRealisticCubicle(x, z, rot, index) {
            const group = new THREE.Group();
            
            const deskMat = new THREE.MeshStandardMaterial({ color: 0xd4a373 });
            const desk1 = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.1, 1.2), deskMat);
            desk1.position.set(0, 0.75, 0);
            desk1.castShadow = true;
            desk1.receiveShadow = true;
            
            const desk2 = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.1, 1.5), deskMat);
            desk2.position.set(-0.85, 0.75, 1.35);
            desk2.castShadow = true;
            desk2.receiveShadow = true;
            group.add(desk1, desk2);
            
            const wallMat = new THREE.MeshStandardMaterial({ color: 0x7f8c8d, roughness: 0.9 });
            const wallHeight = 1.4;
            const wallThickness = 0.05;
            
            const wall1 = new THREE.Mesh(new THREE.BoxGeometry(2.8, wallHeight, wallThickness), wallMat);
            wall1.position.set(0, wallHeight/2, -0.7);
            wall1.castShadow = true;
            
            const wall2 = new THREE.Mesh(new THREE.BoxGeometry(wallThickness, wallHeight, 2.8), wallMat);
            wall2.position.set(-1.4, wallHeight/2, 0.7);
            wall2.castShadow = true;
            
            group.add(wall1, wall2);
            
            const legMat = new THREE.MeshStandardMaterial({ color: 0x2c3e50, metalness: 0.5 });
            const leg1 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.75, 0.1), legMat);
            leg1.position.set(-1, 0.375, -0.4);
            const leg2 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.75, 0.1), legMat);
            leg2.position.set(1, 0.375, -0.4);
            const leg3 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.75, 0.1), legMat);
            leg3.position.set(-1.2, 0.375, 0.4);
            group.add(leg1, leg2, leg3);
            
            const monitorStand = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.3), legMat);
            monitorStand.position.set(0, 0.85, -0.2);
            const monitor = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.5, 0.05), new THREE.MeshStandardMaterial({ color: 0x1a1a2e, metalness: 0.3, roughness: 0.2 }));
            monitor.position.set(0, 1.2, -0.15);
            monitor.castShadow = true;
            
            const screenGeo = new THREE.PlaneGeometry(0.7, 0.4);
            const screenMat = new THREE.MeshBasicMaterial({ color: 0x3498db });
            const screen = new THREE.Mesh(screenGeo, screenMat);
            screen.position.set(0, 1.2, -0.12);
            group.add(monitorStand, monitor, screen);
            
            const kb = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.02, 0.2), new THREE.MeshStandardMaterial({ color: 0x2c3e50 }));
            kb.position.set(0, 0.81, 0.2);
            const mouse = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.03, 0.12), new THREE.MeshStandardMaterial({ color: 0xe74c3c }));
            mouse.position.set(0.5, 0.81, 0.2);
            group.add(kb, mouse);
            
            const chairGroup = new THREE.Group();
            const seat = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.1, 0.6), new THREE.MeshStandardMaterial({ color: 0x8e44ad }));
            seat.position.y = 0.5;
            const back = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.1), new THREE.MeshStandardMaterial({ color: 0x8e44ad }));
            back.position.set(0, 0.9, -0.25);
            const base = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.5), legMat);
            base.position.y = 0.25;
            const star = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.05, 5), legMat);
            star.position.y = 0.025;
            chairGroup.add(seat, back, base, star);
            chairGroup.position.set(0.5, 0, 1);
            chairGroup.rotation.y = Math.random() * 0.5;
            group.add(chairGroup);
            
            group.position.set(x, 0, z);
            group.rotation.y = rot;
            scene.add(group);
            
            const body = new CANNON.Body({ mass: 0 });
            body.addShape(new CANNON.Box(new CANNON.Vec3(1.25, 0.05, 0.6)), new CANNON.Vec3(0, 0.75, 0));
            body.addShape(new CANNON.Box(new CANNON.Vec3(0.4, 0.05, 0.75)), new CANNON.Vec3(-0.85, 0.75, 1.35));
            body.addShape(new CANNON.Box(new CANNON.Vec3(1.4, wallHeight/2, 0.025)), new CANNON.Vec3(0, wallHeight/2, -0.7));
            body.addShape(new CANNON.Box(new CANNON.Vec3(0.025, wallHeight/2, 1.4)), new CANNON.Vec3(-1.4, wallHeight/2, 0.7));
            
            body.position.set(x, 0, z);
            body.quaternion.setFromAxisAngle(new CANNON.Vec3(0,1,0), rot);
            world.addBody(body);
        }

        function createMeetingRoom() {
            const group = new THREE.Group();
            
            const tableTop = new THREE.Mesh(new THREE.BoxGeometry(6, 0.1, 3), new THREE.MeshStandardMaterial({ color: 0x8b4513 }));
            tableTop.position.y = 0.8;
            tableTop.castShadow = true;
            tableTop.receiveShadow = true;
            
            const leg1 = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.8, 0.2), new THREE.MeshStandardMaterial({ color: 0x2c3e50 }));
            leg1.position.set(-2.5, 0.4, -1.2);
            const leg2 = leg1.clone(); leg2.position.set(2.5, 0.4, -1.2);
            const leg3 = leg1.clone(); leg3.position.set(-2.5, 0.4, 1.2);
            const leg4 = leg1.clone(); leg4.position.set(2.5, 0.4, 1.2);
            
            group.add(tableTop, leg1, leg2, leg3, leg4);
            
            for (let i = 0; i < 6; i++) {
                const angle = (i / 6) * Math.PI * 2;
                const chair = new THREE.Group();
                const seat = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.1, 0.6), new THREE.MeshStandardMaterial({ color: 0x34495e }));
                seat.position.y = 0.5;
                const back = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 0.1), new THREE.MeshStandardMaterial({ color: 0x34495e }));
                back.position.set(0, 0.8, -0.25);
                chair.add(seat, back);
                chair.position.set(Math.cos(angle) * 3.5, 0, Math.sin(angle) * 2);
                chair.rotation.y = -angle;
                group.add(chair);
            }
            
            scene.add(group);
            
            const body = new CANNON.Body({ mass: 0 });
            body.addShape(new CANNON.Box(new CANNON.Vec3(3, 0.05, 1.5)), new CANNON.Vec3(0, 0.8, 0));
            world.addBody(body);
        }

        function createPlant(x, z) {
            const group = new THREE.Group();
            
            const pot = new THREE.Mesh(
                new THREE.CylinderGeometry(0.4, 0.3, 0.6, 8),
                new THREE.MeshStandardMaterial({ color: 0xd2691e })
            );
            pot.position.y = 0.3;
            pot.castShadow = true;
            
            const leafMat = new THREE.MeshStandardMaterial({ color: 0x228b22, roughness: 0.8 });
            for (let i = 0; i < 5; i++) {
                const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.3 + Math.random()*0.2, 8, 8), leafMat);
                leaf.position.set((Math.random()-0.5)*0.6, 0.8 + Math.random()*0.5, (Math.random()-0.5)*0.6);
                leaf.castShadow = true;
                group.add(leaf);
            }
            
            group.add(pot);
            group.position.set(x, 0, z);
            scene.add(group);
            
            const body = new CANNON.Body({ mass: 0, position: new CANNON.Vec3(x, 0.3, z), shape: new CANNON.Cylinder(0.4, 0.3, 0.6, 8) });
            world.addBody(body);
        }

        function createWaterCooler(x, z) {
            const group = new THREE.Group();
            
            const base = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.35, 1.2, 16), new THREE.MeshStandardMaterial({ color: 0xc0c0c0, metalness: 0.3 }));
            base.position.y = 0.6;
            base.castShadow = true;
            
            const bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.6, 16), new THREE.MeshStandardMaterial({ color: 0x3498db, transparent: true, opacity: 0.6 }));
            bottle.position.y = 1.5;
            bottle.castShadow = true;
            
            group.add(base, bottle);
            group.position.set(x, 0, z);
            scene.add(group);
            
            const body = new CANNON.Body({ mass: 0, position: new CANNON.Vec3(x, 0.6, z), shape: new CANNON.Cylinder(0.35, 0.35, 1.2, 8) });
            world.addBody(body);
        }

        function createWhiteboard(x, z, rot) {
            const board = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2, 3), new THREE.MeshStandardMaterial({ color: 0xffffff }));
            board.position.set(x, 1, z);
            board.rotation.y = rot;
            board.castShadow = true;
            scene.add(board);
            
            const body = new CANNON.Body({ mass: 0, position: new CANNON.Vec3(x, 1, z), shape: new CANNON.Box(new CANNON.Vec3(0.05, 1, 1.5)) });
            body.quaternion.setFromAxisAngle(new CANNON.Vec3(0,1,0), rot);
            world.addBody(body);
        }

        function createHumanoidPlayer(color) {
            const group = new THREE.Group();
            
            const shirtMat = new THREE.MeshStandardMaterial({ color: color, roughness: 0.7 });
            const skinMat = new THREE.MeshStandardMaterial({ color: 0xffdbac, roughness: 0.5 });
            const pantsMat = new THREE.MeshStandardMaterial({ color: 0x2c3e50, roughness: 0.8 });
            
            const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.3), shirtMat);
            torso.position.y = 1.15;
            torso.castShadow = true;
            group.add(torso);
            
            const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 16), skinMat);
            head.position.y = 1.75;
            head.castShadow = true;
            group.add(head);
            
            const leftLeg = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.9, 0.22), pantsMat);
            leftLeg.position.set(-0.15, 0.45, 0);
            leftLeg.castShadow = true;
            
            const rightLeg = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.9, 0.22), pantsMat);
            rightLeg.position.set(0.15, 0.45, 0);
            rightLeg.castShadow = true;
            group.add(leftLeg, rightLeg);
            
            const armGroup = new THREE.Group();
            armGroup.position.set(0.35, 1.4, 0);
            
            const arm = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.6, 0.15), shirtMat);
            arm.position.y = -0.3;
            arm.castShadow = true;
            armGroup.add(arm);
            
            const hand = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8), skinMat);
            hand.position.y = -0.65;
            armGroup.add(hand);
            
            group.add(armGroup);
            
            group.userData = { rightArm: armGroup, head: head };
            
            return group;
        }

        function createLocalPlayer() {
            const mesh = createHumanoidPlayer(playerColor);
            scene.add(mesh);
            
            const canvas = document.createElement('canvas');
            canvas.width = 256; canvas.height = 64;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = 'rgba(0,0,0,0.8)'; 
            ctx.roundRect(0,0,256,64,10);
            ctx.fill();
            ctx.fillStyle = 'white'; ctx.font = 'bold 40px Arial'; ctx.textAlign = 'center';
            ctx.fillText('You', 128, 45);
            const tex = new THREE.CanvasTexture(canvas);
            const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex }));
            sprite.position.set(0, 2.2, 0); 
            sprite.scale.set(1.5, 0.375, 1);
            mesh.add(sprite);
            
            const body = new CANNON.Body({ 
                mass: 50, 
                position: new CANNON.Vec3(0, 2, 0), 
                shape: new CANNON.Sphere(0.35),
                linearDamping: 0.9,
                fixedRotation: true 
            });
            body.addShape(new CANNON.Sphere(0.35), new CANNON.Vec3(0, -0.7, 0));
            world.addBody(body);
            
            localPlayer = { 
                mesh, 
                body, 
                health: 100, 
                lastShot: 0,
                arm: mesh.userData.rightArm,
                head: mesh.userData.head
            };
            updateHUD();
        }

        function createRemotePlayer(data) {
            const mesh = createHumanoidPlayer(data.color);
            mesh.position.set(data.x, data.y, data.z);
            scene.add(mesh);
            
            const canvas = document.createElement('canvas');
            canvas.width = 256; canvas.height = 64;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = 'rgba(0,0,0,0.8)'; 
            ctx.roundRect(0,0,256,64,10);
            ctx.fill();
            ctx.fillStyle = 'white'; ctx.font = 'bold 40px Arial'; ctx.textAlign = 'center';
            ctx.fillText(data.name, 128, 45);
            const tex = new THREE.CanvasTexture(canvas);
            const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex }));
            sprite.position.set(0, 2.2, 0); 
            sprite.scale.set(1.5, 0.375, 1);
            mesh.add(sprite);
            
            const body = new CANNON.Body({ 
                mass: 0, 
                position: new CANNON.Vec3(data.x, data.y, data.z), 
                shape: new CANNON.Sphere(0.35),
                type: CANNON.Body.KINEMATIC 
            });
            body.addShape(new CANNON.Sphere(0.35), new CANNON.Vec3(0, -0.7, 0));
            world.addBody(body);
            
            remotePlayers.set(data.id, { 
                mesh, 
                body, 
                name: data.name, 
                color: data.color, 
                health: 100,
                targetPos: new THREE.Vector3(data.x, data.y, data.z), 
                targetRot: 0,
                arm: mesh.userData.rightArm,
                head: mesh.userData.head,
                throwTime: 0
            });
        }

        function spawnProjectile(data, isLocal) {
            const weapon = weapons.find(w => w.name === data.weapon) || weapons[0];
            
            let geometry, material;
            if (weapon.name === 'Coffee Mug') {
                geometry = new THREE.CylinderGeometry(0.08, 0.08, 0.15, 12);
                material = new THREE.MeshStandardMaterial({ color: weapon.color });
            } else if (weapon.name === 'Monitor') {
                geometry = new THREE.BoxGeometry(0.6, 0.5, 0.1);
                material = new THREE.MeshStandardMaterial({ color: 0x1a1a1a });
            } else if (weapon.name === 'Office Chair') {
                geometry = new THREE.BoxGeometry(weapon.size, weapon.size*0.8, weapon.size);
                material = new THREE.MeshStandardMaterial({ color: weapon.color });
            } else {
                geometry = new THREE.BoxGeometry(weapon.size, weapon.size*0.6, weapon.size*0.4);
                material = new THREE.MeshStandardMaterial({ color: weapon.color });
            }
            
            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.set(data.x, data.y, data.z);
            mesh.castShadow = true;
            scene.add(mesh);
            
            const body = new CANNON.Body({ 
                mass: weapon.mass, 
                position: new CANNON.Vec3(data.x, data.y, data.z), 
                shape: new CANNON.Box(new CANNON.Vec3(weapon.size/2, weapon.size/2, weapon.size/2)) 
            });
            body.velocity.set(data.velX, data.velY, data.velZ);
            body.angularVelocity.set(Math.random()*15, Math.random()*15, Math.random()*15);
            world.addBody(body);
            
            if (!isLocal) {
                body.addEventListener('collide', (e) => {
                    if (e.body === localPlayer.body) {
                        const speed = body.velocity.length();
                        if (speed > 3) {
                            socket.emit('player-hit', { targetId: myId, damage: Math.floor(weapon.damage * (speed/20)) });
                            createBloodEffect(mesh.position);
                        }
                    }
                });
            }
            
            projectiles.push({ mesh, body, created: Date.now() });
        }

        function createBloodEffect(pos) {
            for (let i = 0; i < 5; i++) {
                const geo = new THREE.BoxGeometry(0.08, 0.08, 0.08);
                const mat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
                const mesh = new THREE.Mesh(geo, mat);
                mesh.position.copy(pos);
                mesh.position.x += (Math.random() - 0.5) * 0.3;
                mesh.position.z += (Math.random() - 0.5) * 0.3;
                scene.add(mesh);
                
                const vel = new THREE.Vector3((Math.random()-0.5)*5, Math.random()*5, (Math.random()-0.5)*5);
                let life = 1.0;
                function anim() {
                    if (life <= 0) { scene.remove(mesh); return; }
                    mesh.position.addScaledVector(vel, 0.016);
                    vel.y -= 0.15;
                    mesh.scale.multiplyScalar(0.95);
                    life -= 0.05;
                    requestAnimationFrame(anim);
                }
                anim();
            }
        }

        function throwWeapon() {
            if (!localPlayer) return;
            const now = Date.now();
            if (now - localPlayer.lastShot < 600) return;
            
            const weapon = weapons[Math.floor(Math.random() * weapons.length)];
            const charge = Math.min(input.charge, 2.5);
            const power = 20 + (charge * 15);
            
            const angle = Math.atan2(input.aim.x, input.aim.y);
            const pos = localPlayer.mesh.position.clone();
            pos.x += Math.sin(angle) * 0.5;
            pos.z += Math.cos(angle) * 0.5;
            pos.y += 1.2;
            
            const dir = new THREE.Vector3(Math.sin(angle), 0.3, Math.cos(angle));
            
            const data = { 
                weapon: weapon.name, 
                x: pos.x, y: pos.y, z: pos.z, 
                velX: dir.x * power * weapon.speed, 
                velY: dir.y * power, 
                velZ: dir.z * power * weapon.speed 
            };
            
            socket.emit('throw-object', data);
            spawnProjectile(data, true);
            
            localPlayer.arm.rotation.x = -Math.PI / 2;
            
            localPlayer.lastShot = now; 
            input.charge = 0;
            
            localPlayer.body.applyForce(
                new CANNON.Vec3(-dir.x * 150, 0, -dir.z * 150), 
                localPlayer.body.position
            );
        }

        function setupControls() {
            const moveZone = document.getElementById('joystick-move');
            const moveKnob = document.getElementById('knob-move');
            const throwBtn = document.getElementById('throw-btn');
            let moveActive = false;
            let moveStartX = 0, moveStartY = 0;
            let currentTouchId = null;
            
            // FIXED MOVEMENT JOYSTICK
            moveZone.addEventListener('touchstart', function(e) {
                e.preventDefault();
                if (moveActive) return;
                moveActive = true;
                const touch = e.changedTouches[0];
                currentTouchId = touch.identifier;
                const rect = moveZone.getBoundingClientRect();
                moveStartX = rect.left + rect.width/2;
                moveStartY = rect.top + rect.height/2;
                
                moveZone.classList.add('active');
                updateJoystick(touch.clientX, touch.clientY);
            }, {passive: false});
            
            moveZone.addEventListener('touchmove', function(e) {
                e.preventDefault();
                if (!moveActive) return;
                
                for (let i = 0; i < e.changedTouches.length; i++) {
                    if (e.changedTouches[i].identifier === currentTouchId) {
                        updateJoystick(e.changedTouches[i].clientX, e.changedTouches[i].clientY);
                        break;
                    }
                }
            }, {passive: false});
            
            function updateJoystick(clientX, clientY) {
                let dx = clientX - moveStartX;
                let dy = clientY - moveStartY;
                const distance = Math.sqrt(dx*dx + dy*dy);
                const maxDist = 45;
                
                if (distance > maxDist) {
                    dx = (dx/distance) * maxDist;
                    dy = (dy/distance) * maxDist;
                }
                
                // FIXED: Use transform instead of margin for smoother performance
                moveKnob.style.transform = 'translate(calc(-50% + ' + dx + 'px), calc(-50% + ' + dy + 'px))';
                
                // FIXED: Removed the negative sign from dy
                // Pushing UP (negative dy) now correctly moves character forward (into screen)
                input.move.x = dx / maxDist;
                input.move.y = dy / maxDist;  // CORRECTED: Was -(dy / maxDist)
            }
            
            function resetJoystick() {
                moveActive = false;
                currentTouchId = null;
                moveKnob.style.transform = 'translate(-50%, -50%)';
                moveZone.classList.remove('active');
                input.move.x = 0;
                input.move.y = 0;
            }
            
            moveZone.addEventListener('touchend', function(e) {
                for (let i = 0; i < e.changedTouches.length; i++) {
                    if (e.changedTouches[i].identifier === currentTouchId) {
                        resetJoystick();
                        break;
                    }
                }
            }, {passive: false});
            
            moveZone.addEventListener('touchcancel', resetJoystick, {passive: false});
            
            // Right side aim control
            const gameCanvas = document.getElementById('gameCanvas');
            gameCanvas.addEventListener('touchstart', function(e) {
                for (let i = 0; i < e.touches.length; i++) {
                    if (e.touches[i].clientX > window.innerWidth / 2) {
                        updateAim(e.touches[i].clientX, e.touches[i].clientY);
                    }
                }
            }, {passive: false});
            
            gameCanvas.addEventListener('touchmove', function(e) {
                for (let i = 0; i < e.touches.length; i++) {
                    if (e.touches[i].clientX > window.innerWidth / 2) {
                        updateAim(e.touches[i].clientX, e.touches[i].clientY);
                    }
                }
            }, {passive: false});
            
            function updateAim(clientX, clientY) {
                const centerX = window.innerWidth * 0.75;
                const centerY = window.innerHeight - 100;
                input.aim.x = (clientX - centerX) / 100;
                input.aim.y = (clientY - centerY) / 100;
                const len = Math.sqrt(input.aim.x*input.aim.x + input.aim.y*input.aim.y);
                if (len > 1) {
                    input.aim.x /= len;
                    input.aim.y /= len;
                }
            }
            
            throwBtn.addEventListener('touchstart', function(e) {
                e.preventDefault();
                e.stopPropagation();
                input.charging = true;
                throwBtn.classList.add('charging');
                throwBtn.innerHTML = 'CHARGING...';
            }, {passive: false});
            
            throwBtn.addEventListener('touchend', function(e) {
                e.preventDefault();
                e.stopPropagation();
                if (input.charging) {
                    throwWeapon();
                    input.charging = false;
                    throwBtn.classList.remove('charging');
                    throwBtn.innerHTML = 'HOLD TO<br>THROW';
                }
            }, {passive: false});
            
            document.addEventListener('keydown', (e) => {
                const key = e.key.toLowerCase();
                const speed = 0.8;
                if (key === 'w' || key === 'arrowup') input.move.y = -speed;
                if (key === 's' || key === 'arrowdown') input.move.y = speed;
                if (key === 'a' || key === 'arrowleft') input.move.x = -speed;
                if (key === 'd' || key === 'arrowright') input.move.x = speed;
                if (key === ' ' && !input.charging) input.charging = true;
            });
            
            document.addEventListener('keyup', (e) => {
                const key = e.key.toLowerCase();
                if (['w','s','arrowup','arrowdown'].includes(key)) input.move.y = 0;
                if (['a','d','arrowleft','arrowright'].includes(key)) input.move.x = 0;
                if (key === ' ' && input.charging) {
                    throwWeapon();
                    input.charging = false;
                }
            });
            
            document.addEventListener('mousemove', (e) => {
                if (!localPlayer) return;
                const rect = renderer.domElement.getBoundingClientRect();
                const centerX = rect.left + rect.width/2;
                const centerY = rect.top + rect.height/2;
                input.aim.x = (e.clientX - centerX) / 200;
                input.aim.y = (e.clientY - centerY) / 200;
                const len = Math.sqrt(input.aim.x**2 + input.aim.y**2);
                if (len > 1) {
                    input.aim.x /= len;
                    input.aim.y /= len;
                }
                
                const crosshair = document.getElementById('crosshair');
                crosshair.style.left = (e.clientX / window.innerWidth * 100) + '%';
                crosshair.style.top = (e.clientY / window.innerHeight * 100) + '%';
            });
            
            document.addEventListener('mousedown', () => { if (!input.charging) input.charging = true; });
            document.addEventListener('mouseup', () => { if (input.charging) { throwWeapon(); input.charging = false; } });
        }

        function updateHUD() {
            const hud = document.getElementById('hud');
            hud.innerHTML = '';
            if (localPlayer) {
                const div = document.createElement('div'); 
                div.className = 'player-card local'; 
                div.style.borderColor = '#' + playerColor.toString(16).padStart(6,'0');
                div.innerHTML = '<span>You</span><div class="health-bar"><div class="health-fill" style="width: ' + localPlayer.health + '%; background: #' + playerColor.toString(16).padStart(6,'0') + '"></div></div>';
                hud.appendChild(div);
            }
            remotePlayers.forEach(player => {
                const div = document.createElement('div'); 
                div.className = 'player-card'; 
                div.style.borderColor = '#' + player.color.toString(16).padStart(6,'0');
                div.innerHTML = '<span>' + player.name + '</span><div class="health-bar"><div class="health-fill" style="width: ' + player.health + '%; background: #' + player.color.toString(16).padStart(6,'0') + '"></div></div>';
                hud.appendChild(div);
            });
        }

        function handleDeath() {
            const status = document.getElementById('game-status');
            status.innerHTML = '<div>☠️ KNOCKED OUT</div><div style="font-size: 16px; margin-top: 10px;">Respawning...</div>';
            status.style.display = 'block';
            localPlayer.mesh.visible = false;
            setTimeout(() => { 
                localPlayer.health = 100; 
                localPlayer.body.position.set((Math.random()-0.5)*20, 5, (Math.random()-0.5)*20); 
                localPlayer.mesh.visible = true; 
                status.style.display = 'none'; 
                updateHUD(); 
            }, 2000);
        }

        function animate() {
            requestAnimationFrame(animate);
            const now = performance.now();
            const delta = Math.min((now - lastTime) / 1000, 0.1);
            lastTime = now;
            world.step(1/60, delta, 3);
            
            if (localPlayer && localPlayer.health > 0) {
                const speed = 25;
                const force = new CANNON.Vec3(input.move.x * speed, 0, input.move.y * speed);
                localPlayer.body.applyForce(force, localPlayer.body.position);
                
                if (Math.abs(input.aim.x) > 0.1 || Math.abs(input.aim.y) > 0.1) {
                    const targetAngle = Math.atan2(input.aim.x, input.aim.y);
                    const q = new CANNON.Quaternion();
                    q.setFromAxisAngle(new CANNON.Vec3(0,1,0), targetAngle);
                    localPlayer.body.quaternion = q;
                }
                
                if (input.charging) {
                    input.charge = Math.min(input.charge + delta * 2, 2.5);
                    localPlayer.arm.rotation.x = THREE.MathUtils.lerp(localPlayer.arm.rotation.x, -Math.PI/3, 0.2);
                } else {
                    localPlayer.arm.rotation.x = THREE.MathUtils.lerp(localPlayer.arm.rotation.x, 0, 0.1);
                }
                
                const speed2 = localPlayer.body.velocity.length();
                if (speed2 > 1) {
                    localPlayer.head.position.y = 1.75 + Math.sin(now * 0.01) * 0.02;
                }
                
                localPlayer.mesh.position.copy(localPlayer.body.position);
                localPlayer.mesh.quaternion.copy(localPlayer.body.quaternion);
                
                const targetPos = localPlayer.mesh.position.clone();
                targetPos.y += 15; 
                targetPos.z += 12;
                camera.position.lerp(targetPos, 0.08);
                camera.lookAt(localPlayer.mesh.position.x, localPlayer.mesh.position.y + 1, localPlayer.mesh.position.z);
                
                if (Math.random() < 0.3) {
                    socket.emit('player-update', { 
                        x: localPlayer.body.position.x, 
                        y: localPlayer.body.position.y, 
                        z: localPlayer.body.position.z, 
                        rotation: Math.atan2(input.aim.x, input.aim.y), 
                        health: localPlayer.health,
                        throwAnim: (now - localPlayer.lastShot) < 300
                    });
                }
            }
            
            remotePlayers.forEach(player => {
                if (player.targetPos) {
                    player.mesh.position.lerp(player.targetPos, 0.15);
                    const currentRot = player.mesh.rotation.y;
                    let diff = player.targetRot - currentRot;
                    while (diff > Math.PI) diff -= Math.PI * 2;
                    while (diff < -Math.PI) diff += Math.PI * 2;
                    player.mesh.rotation.y = currentRot + diff * 0.15;
                    player.body.position.copy(player.mesh.position);
                    
                    if ((now - player.throwTime) < 300) {
                        player.arm.rotation.x = -Math.PI/2;
                    } else {
                        player.arm.rotation.x = THREE.MathUtils.lerp(player.arm.rotation.x, 0, 0.1);
                    }
                    
                    if (player.targetPos.distanceTo(player.mesh.position) > 0.1) {
                        player.head.position.y = 1.75 + Math.sin(now * 0.01) * 0.02;
                    }
                }
            });
            
            for (let i = projectiles.length - 1; i >= 0; i--) {
                const proj = projectiles[i];
                proj.mesh.position.copy(proj.body.position);
                proj.mesh.quaternion.copy(proj.body.quaternion);
                if (Date.now() - proj.created > 10000 || proj.body.position.y < -10) {
                    scene.remove(proj.mesh); 
                    world.removeBody(proj.body); 
                    projectiles.splice(i, 1);
                }
            }
            
            renderer.render(scene, camera);
        }

        window.addEventListener('resize', () => { 
            if (camera && renderer) { 
                camera.aspect = window.innerWidth / window.innerHeight; 
                camera.updateProjectionMatrix(); 
                renderer.setSize(window.innerWidth, window.innerHeight); 
            } 
        });
    </script>
</body>
</html>`);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🎮 Enhanced Office Battle running on port ${PORT}`));
