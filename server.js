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
        * { margin: 0; padding: 0; box-sizing: border-box; touch-action: none; -webkit-touch-callout: none; user-select: none; }
        body { overflow: hidden; background: #0a0a0a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; position: fixed; width: 100%; height: 100%; }
        #gameCanvas { width: 100%; height: 100%; display: block; }
        .screen { position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%); display: flex; flex-direction: column; justify-content: center; align-items: center; color: white; z-index: 100; padding: 20px; }
        .hidden { display: none !important; }
        h1 { font-size: 2.5rem; margin-bottom: 10px; text-shadow: 0 0 20px rgba(255,107,107,0.5); }
        .subtitle { opacity: 0.9; margin-bottom: 30px; font-size: 1.1rem; }
        input, button { padding: 15px; margin: 8px; font-size: 16px; border-radius: 25px; border: none; width: 90%; max-width: 320px; outline: none; }
        input { background: rgba(255,255,255,0.95); text-align: center; }
        button { background: linear-gradient(135deg, #ff6b6b, #ee5a6f); color: white; font-weight: bold; cursor: pointer; box-shadow: 0 6px 20px rgba(238,90,111,0.4); }
        button:active { transform: scale(0.95); }
        .color-selection { display: flex; gap: 12px; margin: 20px 0; flex-wrap: wrap; justify-content: center; }
        .color-btn { width: 55px; height: 55px; border-radius: 50%; border: 3px solid transparent; cursor: pointer; transition: all 0.2s; }
        .color-btn.selected { border-color: white; transform: scale(1.15); box-shadow: 0 0 20px rgba(255,255,255,0.6); }
        .instructions { background: rgba(255,255,255,0.1); padding: 20px; border-radius: 15px; margin-top: 25px; font-size: 0.9rem; line-height: 1.5; max-width: 400px; text-align: center; backdrop-filter: blur(10px); border: 1px solid rgba(255,255,255,0.1); }
        #hud { position: absolute; top: 10px; left: 10px; right: 10px; display: flex; justify-content: space-around; flex-wrap: wrap; pointer-events: none; z-index: 40; gap: 5px; }
        .player-card { background: rgba(0,0,0,0.7); padding: 10px 15px; border-radius: 25px; font-size: 13px; display: flex; align-items: center; gap: 10px; border: 2px solid; backdrop-filter: blur(5px); }
        .player-card.local { background: rgba(255,255,255,0.15); font-weight: bold; border-width: 3px; }
        .health-bar { width: 60px; height: 10px; background: rgba(0,0,0,0.5); border-radius: 5px; overflow: hidden; border: 1px solid rgba(255,255,255,0.2); }
        .health-fill { height: 100%; transition: width 0.3s; }
        
        /* FIXED TOUCH CONTROLS - Always visible on mobile */
        #touch-controls { 
            position: absolute; 
            bottom: 0; 
            left: 0; 
            width: 100%; 
            height: 250px; 
            pointer-events: none; 
            z-index: 50; 
            display: block; /* Always block, we hide with opacity if needed */
        }
        
        .joystick-zone { 
            position: absolute; 
            width: 150px; 
            height: 150px; 
            background: rgba(255,255,255,0.15); 
            border: 3px solid rgba(255,255,255,0.4); 
            border-radius: 50%; 
            pointer-events: auto; 
            touch-action: none;
        }
        
        #joystick-move { 
            left: 20px; 
            bottom: 20px; 
        }
        
        .joystick-knob { 
            position: absolute; 
            width: 60px; 
            height: 60px; 
            background: rgba(255,255,255,0.95); 
            border-radius: 50%; 
            top: 45px;  /* Center in 150px zone: (150-60)/2 */
            left: 45px;
            box-shadow: 0 4px 15px rgba(0,0,0,0.4); 
            border: 2px solid rgba(0,0,0,0.1);
            transition: none; /* No transition for instant response */
        }
        
        #throw-btn { 
            position: absolute; 
            right: 20px; 
            bottom: 20px; 
            width: 110px; 
            height: 110px; 
            border-radius: 50%; 
            background: linear-gradient(135deg, #ff4444, #cc0000); 
            border: 4px solid white; 
            pointer-events: auto; 
            display: flex; 
            align-items: center; 
            justify-content: center; 
            font-weight: bold; 
            font-size: 16px; 
            text-align: center; 
            color: white; 
            box-shadow: 0 6px 20px rgba(255,68,68,0.4); 
            touch-action: none;
        }
        
        #throw-btn.charging { 
            background: linear-gradient(135deg, #ffff44, #ffaa00); 
            color: #333; 
            transform: scale(1.1); 
        }
        
        #game-status { 
            position: absolute; 
            top: 50%; 
            left: 50%; 
            transform: translate(-50%, -50%); 
            background: rgba(0,0,0,0.85); 
            padding: 30px; 
            border-radius: 20px; 
            font-size: 24px; 
            font-weight: bold; 
            z-index: 60; 
            display: none; 
            text-align: center; 
            color: white; 
        }
        
        .crosshair { 
            position: absolute; 
            top: 50%; 
            left: 50%; 
            width: 20px; 
            height: 20px; 
            border: 2px solid rgba(255,255,255,0.8); 
            border-radius: 50%; 
            transform: translate(-50%, -50%); 
            pointer-events: none; 
            z-index: 30; 
            display: none; 
        }
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
        </div>
        <button onclick="joinGame()">ENTER OFFICE</button>
        <div class="instructions">
            <strong>📱 Mobile:</strong> Left stick to move, Touch right side to aim, Hold RED button to throw<br>
            <strong>💻 Desktop:</strong> WASD to move, Mouse to aim, Click to throw
        </div>
    </div>
    
    <div id="hud" class="hidden"></div>
    <div class="crosshair" id="crosshair"></div>
    
    <!-- Touch Controls -->
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
            { name: 'Monitor', mass: 4, damage: 35, size: 0.6, color: 0x1a1a2e, speed: 0.8 }
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
            
            // Show touch controls only on mobile
            const isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
            document.getElementById('touch-controls').style.display = isMobile ? 'block' : 'none';
            if (!isMobile) document.getElementById('crosshair').style.display = 'block';
            
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
            
            scene = new THREE.Scene();
            scene.background = new THREE.Color(0xd0d0d0);
            scene.fog = new THREE.Fog(0xd0d0d0, 20, 60);
            
            camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
            renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('gameCanvas'), antialias: true });
            renderer.setSize(window.innerWidth, window.innerHeight);
            renderer.shadowMap.enabled = true;
            
            const ambient = new THREE.AmbientLight(0xffffff, 0.6);
            scene.add(ambient);
            const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
            dirLight.position.set(20, 30, 10);
            dirLight.castShadow = true;
            dirLight.shadow.camera.left = -30;
            dirLight.shadow.camera.right = 30;
            dirLight.shadow.camera.top = 30;
            dirLight.shadow.camera.bottom = -30;
            scene.add(dirLight);

            createOffice();
            createLocalPlayer();
            setupControls();
            
            lastTime = performance.now();
            animate();
        }

        function createOffice() {
            const floorGeo = new THREE.PlaneGeometry(60, 60);
            const floorMat = new THREE.MeshStandardMaterial({ color: 0x999999, roughness: 0.8 });
            const floor = new THREE.Mesh(floorGeo, floorMat);
            floor.rotation.x = -Math.PI/2;
            floor.receiveShadow = true;
            scene.add(floor);
            
            const floorBody = new CANNON.Body({ type: CANNON.Body.STATIC, shape: new CANNON.Plane() });
            floorBody.quaternion.setFromAxisAngle(new CANNON.Vec3(1,0,0), -Math.PI/2);
            world.addBody(floorBody);

            // Create 8 cubicles
            for (let i = 0; i < 8; i++) {
                const angle = (i / 8) * Math.PI * 2;
                const radius = 12;
                const x = Math.cos(angle) * radius;
                const z = Math.sin(angle) * radius;
                createCubicle(x, z, angle);
            }
        }

        function createCubicle(x, z, rot) {
            const group = new THREE.Group();
            
            // Desk
            const desk = new THREE.Mesh(
                new THREE.BoxGeometry(3, 0.8, 1.5),
                new THREE.MeshStandardMaterial({ color: 0x8B4513 })
            );
            desk.position.y = 0.4;
            desk.castShadow = true;
            group.add(desk);
            
            // Partition walls
            const wallMat = new THREE.MeshStandardMaterial({ color: 0x95a5a6 });
            const wall1 = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.5, 0.1), wallMat);
            wall1.position.set(0, 0.75, -0.8);
            const wall2 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.5, 1.7), wallMat);
            wall2.position.set(-1.6, 0.75, 0);
            
            group.add(wall1, wall2);
            group.position.set(x, 0, z);
            group.rotation.y = rot;
            scene.add(group);
            
            // Physics
            const body = new CANNON.Body({ mass: 0 });
            body.addShape(new CANNON.Box(new CANNON.Vec3(1.5, 0.4, 0.75)), new CANNON.Vec3(0, 0.4, 0));
            body.position.set(x, 0, z);
            body.quaternion.setFromAxisAngle(new CANNON.Vec3(0,1,0), rot);
            world.addBody(body);
        }

        function createHumanoidPlayer(color) {
            const group = new THREE.Group();
            
            const shirtMat = new THREE.MeshStandardMaterial({ color: color });
            const skinMat = new THREE.MeshStandardMaterial({ color: 0xffdbac });
            const pantsMat = new THREE.MeshStandardMaterial({ color: 0x2c3e50 });
            
            // Torso
            const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.3), shirtMat);
            torso.position.y = 1.15;
            torso.castShadow = true;
            group.add(torso);
            
            // Head
            const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 16), skinMat);
            head.position.y = 1.75;
            head.castShadow = true;
            group.add(head);
            
            // Legs
            const leftLeg = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.9, 0.22), pantsMat);
            leftLeg.position.set(-0.15, 0.45, 0);
            const rightLeg = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.9, 0.22), pantsMat);
            rightLeg.position.set(0.15, 0.45, 0);
            group.add(leftLeg, rightLeg);
            
            // Arm (pivot at shoulder)
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
            
            // Name tag
            const canvas = document.createElement('canvas');
            canvas.width = 256; canvas.height = 64;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = 'rgba(0,0,0,0.8)'; 
            ctx.fillRect(0,0,256,64);
            ctx.fillStyle = 'white'; ctx.font = 'bold 40px Arial'; ctx.textAlign = 'center';
            ctx.fillText('You', 128, 45);
            const tex = new THREE.CanvasTexture(canvas);
            const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex }));
            sprite.position.set(0, 2.2, 0); 
            sprite.scale.set(1.5, 0.375, 1);
            mesh.add(sprite);
            
            // Physics body
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
            ctx.fillRect(0,0,256,64);
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
            const geometry = new THREE.BoxGeometry(weapon.size, weapon.size, weapon.size);
            const material = new THREE.MeshStandardMaterial({ color: weapon.color });
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
            world.addBody(body);
            
            if (!isLocal) {
                body.addEventListener('collide', (e) => {
                    if (e.body === localPlayer.body) {
                        const speed = body.velocity.length();
                        if (speed > 2) {
                            socket.emit('player-hit', { targetId: myId, damage: Math.floor(weapon.damage * (speed/20)) });
                        }
                    }
                });
            }
            projectiles.push({ mesh, body, created: Date.now() });
        }

        function throwWeapon() {
            if (!localPlayer) return;
            const now = Date.now();
            if (now - localPlayer.lastShot < 500) return;
            
            const weapon = weapons[Math.floor(Math.random() * weapons.length)];
            const charge = Math.min(input.charge, 2);
            const power = 15 + (charge * 10);
            
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
        }

        // ==========================================
        // FIXED CONTROL SYSTEM - BULLETPROOF VERSION
        // ==========================================
        function setupControls() {
            const moveZone = document.getElementById('joystick-move');
            const moveKnob = document.getElementById('knob-move');
            const throwBtn = document.getElementById('throw-btn');
            
            let moveTouchId = null;
            let moveStartX = 0;
            let moveStartY = 0;
            
            // Helper to get touch from identifier
            function getTouch(touches, id) {
                for (let i = 0; i < touches.length; i++) {
                    if (touches[i].identifier === id) return touches[i];
                }
                return null;
            }
            
            // MOVEMENT JOYSTICK - LEFT SIDE
            moveZone.addEventListener('touchstart', function(e) {
                e.preventDefault();
                e.stopPropagation();
                
                const touch = e.changedTouches[0];
                moveTouchId = touch.identifier;
                
                const rect = moveZone.getBoundingClientRect();
                moveStartX = rect.left + rect.width / 2;
                moveStartY = rect.top + rect.height / 2;
                
                updateJoystick(touch.clientX, touch.clientY);
            }, {passive: false});
            
            moveZone.addEventListener('touchmove', function(e) {
                e.preventDefault();
                e.stopPropagation();
                
                if (moveTouchId === null) return;
                
                const touch = getTouch(e.changedTouches, moveTouchId);
                if (touch) {
                    updateJoystick(touch.clientX, touch.clientY);
                }
            }, {passive: false});
            
            moveZone.addEventListener('touchend', function(e) {
                e.preventDefault();
                
                const touch = getTouch(e.changedTouches, moveTouchId);
                if (touch) {
                    resetJoystick();
                }
            }, {passive: false});
            
            moveZone.addEventListener('touchcancel', function(e) {
                resetJoystick();
            }, {passive: false});
            
            function updateJoystick(clientX, clientY) {
                let dx = clientX - moveStartX;
                let dy = clientY - moveStartY;
                const distance = Math.sqrt(dx*dx + dy*dy);
                const maxDist = 45; // Max joystick movement
                
                if (distance > maxDist) {
                    dx = (dx / distance) * maxDist;
                    dy = (dy / distance) * maxDist;
                }
                
                // Move knob visually - using left/top positioning for reliability
                moveKnob.style.left = (45 + dx) + 'px';
                moveKnob.style.top = (45 + dy) + 'px';
                
                // Update input values (-1 to 1)
                // IMPORTANT: dy is positive when dragging down, but in 3D, that should move backward (positive Z)
                // So we keep dy positive = move backward (into screen is negative Z, so we flip)
                input.move.x = dx / maxDist;
                input.move.y = dy / maxDist; // Forward/backward
            }
            
            function resetJoystick() {
                moveTouchId = null;
                moveKnob.style.left = '45px';
                moveKnob.style.top = '45px';
                input.move.x = 0;
                input.move.y = 0;
            }
            
            // AIMING - RIGHT SIDE OF SCREEN
            const gameCanvas = document.getElementById('gameCanvas');
            let aimTouchId = null;
            
            gameCanvas.addEventListener('touchstart', function(e) {
                for (let i = 0; i < e.touches.length; i++) {
                    const touch = e.touches[i];
                    // Only use right side for aiming
                    if (touch.clientX > window.innerWidth / 2 && aimTouchId === null) {
                        aimTouchId = touch.identifier;
                        updateAim(touch.clientX, touch.clientY);
                        break;
                    }
                }
            }, {passive: false});
            
            gameCanvas.addEventListener('touchmove', function(e) {
                for (let i = 0; i < e.changedTouches.length; i++) {
                    const touch = e.changedTouches[i];
                    if (touch.identifier === aimTouchId) {
                        updateAim(touch.clientX, touch.clientY);
                        break;
                    }
                }
            }, {passive: false});
            
            gameCanvas.addEventListener('touchend', function(e) {
                for (let i = 0; i < e.changedTouches.length; i++) {
                    if (e.changedTouches[i].identifier === aimTouchId) {
                        aimTouchId = null;
                        break;
                    }
                }
            }, {passive: false});
            
            function updateAim(clientX, clientY) {
                // Use center-right of screen as origin
                const centerX = window.innerWidth * 0.75;
                const centerY = window.innerHeight * 0.7;
                
                let dx = (clientX - centerX) / 100;
                let dy = (clientY - centerY) / 100;
                
                const len = Math.sqrt(dx*dx + dy*dy);
                if (len > 1) {
                    dx /= len;
                    dy /= len;
                }
                
                input.aim.x = dx;
                input.aim.y = dy;
            }
            
            // THROW BUTTON
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
            
            // KEYBOARD CONTROLS (Desktop)
            const keys = {};
            document.addEventListener('keydown', (e) => {
                keys[e.key.toLowerCase()] = true;
                
                if (e.key === ' ' && !input.charging) {
                    input.charging = true;
                }
            });
            
            document.addEventListener('keyup', (e) => {
                keys[e.key.toLowerCase()] = false;
                
                if (e.key === ' ' && input.charging) {
                    throwWeapon();
                    input.charging = false;
                }
                
                // Recalculate movement
                updateKeyboardMovement();
            });
            
            function updateKeyboardMovement() {
                let dx = 0;
                let dy = 0;
                
                if (keys['w'] || keys['arrowup']) dy -= 1;
                if (keys['s'] || keys['arrowdown']) dy += 1;
                if (keys['a'] || keys['arrowleft']) dx -= 1;
                if (keys['d'] || keys['arrowright']) dx += 1;
                
                // Normalize
                const len = Math.sqrt(dx*dx + dy*dy);
                if (len > 0) {
                    dx /= len;
                    dy /= len;
                }
                
                input.move.x = dx;
                input.move.y = dy;
            }
            
            // Update movement continuously for keyboard
            setInterval(updateKeyboardMovement, 16);
            
            // MOUSE AIM (Desktop)
            document.addEventListener('mousemove', (e) => {
                if (!localPlayer) return;
                const rect = renderer.domElement.getBoundingClientRect();
                const centerX = rect.left + rect.width/2;
                const centerY = rect.top + rect.height/2;
                
                let dx = (e.clientX - centerX) / 200;
                let dy = (e.clientY - centerY) / 200;
                
                const len = Math.sqrt(dx*dx + dy*dy);
                if (len > 1) {
                    dx /= len;
                    dy /= len;
                }
                
                input.aim.x = dx;
                input.aim.y = dy;
            });
            
            document.addEventListener('mousedown', () => {
                if (!input.charging) input.charging = true;
            });
            
            document.addEventListener('mouseup', () => {
                if (input.charging) {
                    throwWeapon();
                    input.charging = false;
                }
            });
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
                // MOVEMENT APPLICATION
                const speed = 30; // Increased speed for better feel
                const forceX = input.move.x * speed;
                const forceZ = input.move.y * speed; // Z is forward/back
                
                localPlayer.body.applyForce(new CANNON.Vec3(forceX, 0, forceZ), localPlayer.body.position);
                
                // Rotation (aiming)
                if (Math.abs(input.aim.x) > 0.1 || Math.abs(input.aim.y) > 0.1) {
                    const angle = Math.atan2(input.aim.x, input.aim.y);
                    const q = new CANNON.Quaternion();
                    q.setFromAxisAngle(new CANNON.Vec3(0,1,0), angle);
                    localPlayer.body.quaternion = q;
                }
                
                // Charging animation
                if (input.charging) {
                    input.charge = Math.min(input.charge + delta * 2, 2);
                    localPlayer.arm.rotation.x = THREE.MathUtils.lerp(localPlayer.arm.rotation.x, -Math.PI/2, 0.2);
                } else {
                    localPlayer.arm.rotation.x = THREE.MathUtils.lerp(localPlayer.arm.rotation.x, 0, 0.1);
                }
                
                // Sync mesh with physics
                localPlayer.mesh.position.copy(localPlayer.body.position);
                localPlayer.mesh.quaternion.copy(localPlayer.body.quaternion);
                
                // Camera follow
                const targetPos = localPlayer.mesh.position.clone();
                targetPos.y += 12; 
                targetPos.z += 10;
                camera.position.lerp(targetPos, 0.1);
                camera.lookAt(localPlayer.mesh.position.x, localPlayer.mesh.position.y + 1, localPlayer.mesh.position.z);
                
                // Network sync
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
            
            // Update remote players
            remotePlayers.forEach(player => {
                if (player.targetPos) {
                    player.mesh.position.lerp(player.targetPos, 0.2);
                    const currentRot = player.mesh.rotation.y;
                    let diff = player.targetRot - currentRot;
                    while (diff > Math.PI) diff -= Math.PI * 2;
                    while (diff < -Math.PI) diff += Math.PI * 2;
                    player.mesh.rotation.y = currentRot + diff * 0.2;
                    player.body.position.copy(player.mesh.position);
                    
                    if ((now - player.throwTime) < 300) {
                        player.arm.rotation.x = -Math.PI/2;
                    } else {
                        player.arm.rotation.x = THREE.MathUtils.lerp(player.arm.rotation.x, 0, 0.1);
                    }
                }
            });
            
            // Cleanup projectiles
            for (let i = projectiles.length - 1; i >= 0; i--) {
                const proj = projectiles[i];
                proj.mesh.position.copy(proj.body.position);
                proj.mesh.quaternion.copy(proj.body.quaternion);
                
                if (Date.now() - proj.created > 8000 || proj.body.position.y < -10) {
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
server.listen(PORT, () => console.log(`🎮 Office Battle Server running on port ${PORT}`));
