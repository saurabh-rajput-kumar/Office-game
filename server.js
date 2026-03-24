const express = require('express');
const { Server } = require('socket.io');
const http = require('http');
const path = require('path');

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

// Serve the game HTML
app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>Office Battle Royale</title>
    <script src="/socket.io/socket.io.js"></script>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; touch-action: none; }
        body { overflow: hidden; background: #1a1a1a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; position: fixed; width: 100%; height: 100%; }
        #gameCanvas { width: 100%; height: 100%; display: block; }
        .screen { position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%); display: flex; flex-direction: column; justify-content: center; align-items: center; color: white; z-index: 100; padding: 20px; }
        .hidden { display: none !important; }
        h1 { font-size: 2.5rem; margin-bottom: 10px; text-shadow: 2px 2px 4px rgba(0,0,0,0.3); }
        .subtitle { opacity: 0.9; margin-bottom: 30px; font-size: 1.1rem; }
        input, button { padding: 15px; margin: 8px; font-size: 16px; border-radius: 25px; border: none; width: 90%; max-width: 320px; outline: none; }
        input { background: rgba(255,255,255,0.9); text-align: center; }
        button { background: #ff6b6b; color: white; font-weight: bold; cursor: pointer; box-shadow: 0 4px 15px rgba(0,0,0,0.2); }
        button:active { transform: scale(0.95); }
        .color-selection { display: flex; gap: 10px; margin: 15px 0; flex-wrap: wrap; justify-content: center; }
        .color-btn { width: 50px; height: 50px; border-radius: 50%; border: 3px solid transparent; cursor: pointer; }
        .color-btn.selected { border-color: white; transform: scale(1.2); }
        .instructions { background: rgba(0,0,0,0.3); padding: 15px; border-radius: 15px; margin-top: 20px; font-size: 0.9rem; line-height: 1.4; max-width: 400px; text-align: center; }
        #hud { position: absolute; top: 10px; left: 10px; right: 10px; display: flex; justify-content: space-around; flex-wrap: wrap; pointer-events: none; z-index: 40; gap: 5px; }
        .player-card { background: rgba(0,0,0,0.6); padding: 8px 12px; border-radius: 20px; font-size: 12px; display: flex; align-items: center; gap: 8px; border: 2px solid; }
        .player-card.local { background: rgba(255,255,255,0.2); font-weight: bold; }
        .health-bar { width: 50px; height: 8px; background: rgba(0,0,0,0.5); border-radius: 4px; overflow: hidden; }
        .health-fill { height: 100%; transition: width 0.3s; }
        #touch-controls { position: absolute; bottom: 0; left: 0; width: 100%; height: 220px; pointer-events: none; z-index: 50; display: none; }
        .joystick-zone { position: absolute; width: 140px; height: 140px; background: rgba(255,255,255,0.15); border: 2px solid rgba(255,255,255,0.3); border-radius: 50%; pointer-events: auto; }
        #joystick-move { left: 20px; bottom: 20px; }
        .joystick-knob { position: absolute; width: 50px; height: 50px; background: rgba(255,255,255,0.9); border-radius: 50%; top: 50%; left: 50%; transform: translate(-50%, -50%); }
        #throw-btn { position: absolute; right: 40px; bottom: 40px; width: 100px; height: 100px; border-radius: 50%; background: linear-gradient(135deg, #ff4444, #cc0000); border: 3px solid white; pointer-events: auto; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 14px; text-align: center; user-select: none; }
        #throw-btn.charging { background: linear-gradient(135deg, #ffff44, #ffaa00); color: black; transform: scale(1.1); }
        #game-status { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background: rgba(0,0,0,0.8); padding: 20px; border-radius: 15px; font-size: 24px; font-weight: bold; z-index: 60; display: none; text-align: center; }
    </style>
</head>
<body>
    <div id="menu" class="screen">
        <h1>🏢 OFFICE BATTLE</h1>
        <div class="subtitle">4-Player Online Mayhem</div>
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
            <strong>📱 Mobile:</strong> Left stick to move, Touch right side to aim, Hold RED button to throw<br><br>
            <strong>💻 Desktop:</strong> WASD to move, Mouse to aim, Click to throw
        </div>
    </div>
    <div id="hud" class="hidden"></div>
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
            { name: 'Mug', mass: 1, damage: 15, size: 0.2, color: 0x8B4513, speed: 1.2 },
            { name: 'Keyboard', mass: 2, damage: 20, size: 0.3, color: 0x666666, speed: 1.0 },
            { name: 'Monitor', mass: 4, damage: 35, size: 0.5, color: 0x222222, speed: 0.8 },
            { name: 'Chair', mass: 6, damage: 45, size: 0.7, color: 0x4a4a4a, speed: 0.6 }
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
            if ('ontouchstart' in window) document.getElementById('touch-controls').style.display = 'block';
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
                if (player) { player.targetPos = new THREE.Vector3(data.x, data.y, data.z); player.targetRot = data.rotation; player.health = data.health; }
            });
            socket.on('object-thrown', (data) => { spawnProjectile(data, false); });
            socket.on('damage-dealt', ({target, damage}) => {
                if (target === myId && localPlayer) {
                    localPlayer.health = Math.max(0, localPlayer.health - damage);
                    document.body.style.background = '#ff0000';
                    setTimeout(() => document.body.style.background = '#1a1a1a', 100);
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
            world.gravity.set(0, -25, 0);
            scene = new THREE.Scene();
            scene.background = new THREE.Color(0x87CEEB);
            scene.fog = new THREE.Fog(0x87CEEB, 15, 60);
            camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
            renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('gameCanvas'), antialias: true });
            renderer.setSize(window.innerWidth, window.innerHeight);
            renderer.shadowMap.enabled = true;
            
            const ambient = new THREE.AmbientLight(0xffffff, 0.6);
            scene.add(ambient);
            const dir = new THREE.DirectionalLight(0xffffff, 0.8);
            dir.position.set(15, 25, 10);
            dir.castShadow = true;
            scene.add(dir);

            createOffice();
            createLocalPlayer();
            setupControls();
            lastTime = performance.now();
            animate();
        }

        function createOffice() {
            const floorGeo = new THREE.PlaneGeometry(50, 50);
            const floorMat = new THREE.MeshStandardMaterial({ color: 0x999999, roughness: 0.8 });
            const floor = new THREE.Mesh(floorGeo, floorMat);
            floor.rotation.x = -Math.PI/2;
            floor.receiveShadow = true;
            scene.add(floor);
            const floorBody = new CANNON.Body({ type: CANNON.Body.STATIC, shape: new CANNON.Plane() });
            floorBody.quaternion.setFromAxisAngle(new CANNON.Vec3(1,0,0), -Math.PI/2);
            world.addBody(floorBody);

            const positions = [[-10,-10,0], [10,-10,0], [-10,10,0], [10,10,0], [0,-15,Math.PI/2], [0,15,Math.PI/2]];
            positions.forEach(pos => createCubicle(pos[0], pos[1], pos[2]));
        }

        function createCubicle(x, z, rot) {
            const group = new THREE.Group();
            const wallMat = new THREE.MeshStandardMaterial({ color: 0xdddddd });
            const wall1 = new THREE.Mesh(new THREE.BoxGeometry(4, 2, 0.1), wallMat);
            wall1.position.set(0, 1, -2);
            const wall2 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2, 4), wallMat);
            wall2.position.set(-2, 1, 0);
            wall1.castShadow = wall2.castShadow = true;
            group.add(wall1, wall2);
            group.position.set(x, 0, z);
            group.rotation.y = rot;
            scene.add(group);
            
            const body = new CANNON.Body({ mass: 0 });
            body.addShape(new CANNON.Box(new CANNON.Vec3(2, 1, 0.05)), new CANNON.Vec3(0, 1, -2));
            body.addShape(new CANNON.Box(new CANNON.Vec3(0.05, 1, 2)), new CANNON.Vec3(-2, 1, 0));
            body.position.set(x, 0, z);
            body.quaternion.setFromAxisAngle(new CANNON.Vec3(0,1,0), rot);
            world.addBody(body);
        }

        function createLocalPlayer() {
            const geometry = new THREE.CapsuleGeometry(0.5, 1, 4, 8);
            const material = new THREE.MeshStandardMaterial({ color: playerColor, roughness: 0.3 });
            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.y = 1;
            mesh.castShadow = true;
            
            const canvas = document.createElement('canvas');
            canvas.width = 256; canvas.height = 64;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(0,0,256,64);
            ctx.fillStyle = 'white'; ctx.font = 'bold 40px Arial'; ctx.textAlign = 'center';
            ctx.fillText('You', 128, 45);
            const tex = new THREE.CanvasTexture(canvas);
            const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex }));
            sprite.position.set(0, 1.8, 0); sprite.scale.set(1.5, 0.375, 1);
            mesh.add(sprite);
            
            const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.5, 4), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 }));
            arrow.rotation.x = -Math.PI/2; arrow.position.z = 0.8; mesh.add(arrow);
            scene.add(mesh);
            
            const body = new CANNON.Body({ mass: 50, position: new CANNON.Vec3(0, 2, 0), shape: new CANNON.Sphere(0.5), linearDamping: 0.9, fixedRotation: true });
            world.addBody(body);
            localPlayer = { mesh, body, health: 100, lastShot: 0 };
            updateHUD();
        }

        function createRemotePlayer(data) {
            const geometry = new THREE.CapsuleGeometry(0.5, 1, 4, 8);
            const material = new THREE.MeshStandardMaterial({ color: data.color });
            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.set(data.x, data.y, data.z); mesh.castShadow = true;
            
            const canvas = document.createElement('canvas');
            canvas.width = 256; canvas.height = 64;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(0,0,256,64);
            ctx.fillStyle = 'white'; ctx.font = 'bold 40px Arial'; ctx.textAlign = 'center';
            ctx.fillText(data.name, 128, 45);
            const tex = new THREE.CanvasTexture(canvas);
            const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex }));
            sprite.position.set(0, 1.8, 0); sprite.scale.set(1.5, 0.375, 1);
            mesh.add(sprite);
            scene.add(mesh);
            
            const body = new CANNON.Body({ mass: 0, position: new CANNON.Vec3(data.x, data.y, data.z), shape: new CANNON.Sphere(0.5), type: CANNON.Body.KINEMATIC });
            world.addBody(body);
            remotePlayers.set(data.id, { mesh, body, name: data.name, color: data.color, health: 100, targetPos: new THREE.Vector3(data.x, data.y, data.z), targetRot: 0 });
        }

        function spawnProjectile(data, isLocal) {
            const weapon = weapons.find(w => w.name === data.weapon) || weapons[0];
            const geometry = new THREE.BoxGeometry(weapon.size, weapon.size, weapon.size);
            const material = new THREE.MeshStandardMaterial({ color: weapon.color });
            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.set(data.x, data.y, data.z); mesh.castShadow = true;
            scene.add(mesh);
            
            const body = new CANNON.Body({ mass: weapon.mass, position: new CANNON.Vec3(data.x, data.y, data.z), shape: new CANNON.Box(new CANNON.Vec3(weapon.size/2, weapon.size/2, weapon.size/2)) });
            body.velocity.set(data.velX, data.velY, data.velZ);
            body.angularVelocity.set(Math.random()*10, Math.random()*10, Math.random()*10);
            world.addBody(body);
            
            if (!isLocal) {
                body.addEventListener('collide', (e) => {
                    if (e.body === localPlayer.body) {
                        const speed = body.velocity.length();
                        if (speed > 3) socket.emit('player-hit', { targetId: myId, damage: Math.floor(weapon.damage * (speed/20)) });
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
            const power = 15 + (charge * 15);
            const pos = localPlayer.mesh.position.clone(); pos.y += 0.5;
            const angle = Math.atan2(input.aim.x, input.aim.y);
            const dir = new THREE.Vector3(Math.sin(angle), 0.3, Math.cos(angle));
            
            const data = { weapon: weapon.name, x: pos.x, y: pos.y, z: pos.z, velX: dir.x * power * weapon.speed, velY: dir.y * power, velZ: dir.z * power * weapon.speed };
            socket.emit('throw-object', data);
            spawnProjectile(data, true);
            localPlayer.lastShot = now; input.charge = 0;
            localPlayer.body.applyForce(new CANNON.Vec3(-dir.x * 100, 0, -dir.z * 100), localPlayer.body.position);
        }

        function setupControls() {
            const moveZone = document.getElementById('joystick-move');
            const moveKnob = document.getElementById('knob-move');
            const throwBtn = document.getElementById('throw-btn');
            let moveActive = false, moveCenter = {x:0, y:0};
            
            moveZone.addEventListener('touchstart', (e) => { e.preventDefault(); moveActive = true; const touch = e.touches[0]; const rect = moveZone.getBoundingClientRect(); moveCenter = { x: rect.left + 70, y: rect.top + 70 }; }, {passive: false});
            moveZone.addEventListener('touchmove', (e) => { e.preventDefault(); if (!moveActive) return; const touch = e.touches[0]; let dx = touch.clientX - moveCenter.x; let dy = touch.clientY - moveCenter.y; const dist = Math.sqrt(dx*dx + dy*dy); const max = 40; if (dist > max) { dx = (dx/dist) * max; dy = (dy/dist) * max; } moveKnob.style.transform = \`translate(calc(-50% + \${dx}px), calc(-50% + \${dy}px))\`; input.move.x = dx / max; input.move.y = dy / max; }, {passive: false});
            moveZone.addEventListener('touchend', () => { moveActive = false; moveKnob.style.transform = 'translate(-50%, -50%)'; input.move.x = 0; input.move.y = 0; });
            
            document.addEventListener('touchmove', (e) => { const touch = e.touches[0]; if (touch.clientX > window.innerWidth / 2) { const centerX = window.innerWidth * 0.75; const centerY = window.innerHeight - 90; input.aim.x = (touch.clientX - centerX) / 100; input.aim.y = -(touch.clientY - centerY) / 100; const len = Math.sqrt(input.aim.x**2 + input.aim.y**2); if (len > 1) { input.aim.x /= len; input.aim.y /= len; } } }, {passive: false});
            
            throwBtn.addEventListener('touchstart', (e) => { e.preventDefault(); input.charging = true; throwBtn.classList.add('charging'); throwBtn.innerHTML = 'CHARGING...'; }, {passive: false});
            throwBtn.addEventListener('touchend', (e) => { e.preventDefault(); if (input.charging) { throwWeapon(); input.charging = false; throwBtn.classList.remove('charging'); throwBtn.innerHTML = 'HOLD TO<br>THROW'; } });
            
            document.addEventListener('keydown', (e) => { const key = e.key.toLowerCase(); const speed = 0.8; if (key === 'w' || key === 'arrowup') input.move.y = -speed; if (key === 's' || key === 'arrowdown') input.move.y = speed; if (key === 'a' || key === 'arrowleft') input.move.x = -speed; if (key === 'd' || key === 'arrowright') input.move.x = speed; if (key === ' ' && !input.charging) input.charging = true; });
            document.addEventListener('keyup', (e) => { const key = e.key.toLowerCase(); if (['w','s','arrowup','arrowdown'].includes(key)) input.move.y = 0; if (['a','d','arrowleft','arrowright'].includes(key)) input.move.x = 0; if (key === ' ' && input.charging) { throwWeapon(); input.charging = false; } });
            document.addEventListener('mousemove', (e) => { if (!localPlayer) return; const rect = renderer.domElement.getBoundingClientRect(); const centerX = rect.left + rect.width/2; const centerY = rect.top + rect.height/2; input.aim.x = (e.clientX - centerX) / 200; input.aim.y = -(e.clientY - centerY) / 200; const len = Math.sqrt(input.aim.x**2 + input.aim.y**2); if (len > 1) { input.aim.x /= len; input.aim.y /= len; } });
            document.addEventListener('mousedown', () => { if (!input.charging) input.charging = true; });
            document.addEventListener('mouseup', () => { if (input.charging) { throwWeapon(); input.charging = false; } });
        }

        function updateHUD() {
            const hud = document.getElementById('hud');
            hud.innerHTML = '';
            if (localPlayer) {
                const div = document.createElement('div'); div.className = 'player-card local'; div.style.borderColor = '#' + playerColor.toString(16).padStart(6,'0');
                div.innerHTML = \`<span>You</span><div class="health-bar"><div class="health-fill" style="width: \${localPlayer.health}%; background: #\${playerColor.toString(16).padStart(6,'0')}"></div></div>\`;
                hud.appendChild(div);
            }
            remotePlayers.forEach(player => {
                const div = document.createElement('div'); div.className = 'player-card'; div.style.borderColor = '#' + player.color.toString(16).padStart(6,'0');
                div.innerHTML = \`<span>\${player.name}</span><div class="health-bar"><div class="health-fill" style="width: \${player.health}%; background: #\${player.color.toString(16).padStart(6,'0')}"></div></div>\`;
                hud.appendChild(div);
            });
        }

        function handleDeath() {
            const status = document.getElementById('game-status');
            status.innerHTML = '<div>☠️ ELIMINATED</div><div style="font-size: 16px; margin-top: 10px;">Respawning...</div>';
            status.style.display = 'block';
            localPlayer.mesh.visible = false;
            setTimeout(() => { localPlayer.health = 100; localPlayer.body.position.set(0, 5, 0); localPlayer.mesh.visible = true; status.style.display = 'none'; updateHUD(); }, 2000);
        }

        function animate() {
            requestAnimationFrame(animate);
            const now = performance.now();
            const delta = Math.min((now - lastTime) / 1000, 0.1);
            lastTime = now;
            world.step(1/60, delta, 3);
            
            if (localPlayer && localPlayer.health > 0) {
                const speed = 20;
                const force = new CANNON.Vec3(input.move.x * speed, 0, input.move.y * speed);
                localPlayer.body.applyForce(force, localPlayer.body.position);
                
                if (Math.abs(input.aim.x) > 0.1 || Math.abs(input.aim.y) > 0.1) {
                    const angle = Math.atan2(input.aim.x, input.aim.y);
                    const q = new CANNON.Quaternion();
                    q.setFromAxisAngle(new CANNON.Vec3(0,1,0), angle);
                    localPlayer.body.quaternion = q;
                }
                
                if (input.charging) input.charge = Math.min(input.charge + delta * 2, 2);
                
                localPlayer.mesh.position.copy(localPlayer.body.position);
                localPlayer.mesh.quaternion.copy(localPlayer.body.quaternion);
                
                const targetPos = localPlayer.mesh.position.clone();
                targetPos.y += 12; targetPos.z += 8;
                camera.position.lerp(targetPos, 0.1);
                camera.lookAt(localPlayer.mesh.position);
                
                if (Math.random() < 0.3) socket.emit('player-update', { x: localPlayer.body.position.x, y: localPlayer.body.position.y, z: localPlayer.body.position.z, rotation: Math.atan2(input.aim.x, input.aim.y), health: localPlayer.health });
            }
            
            remotePlayers.forEach(player => {
                if (player.targetPos) {
                    player.mesh.position.lerp(player.targetPos, 0.2);
                    const currentRot = player.mesh.rotation.y;
                    let diff = player.targetRot - currentRot;
                    while (diff > Math.PI) diff -= Math.PI * 2;
                    while (diff < -Math.PI) diff += Math.PI * 2;
                    player.mesh.rotation.y = currentRot + diff * 0.2;
                    player.body.position.copy(player.mesh.position);
                }
            });
            
            for (let i = projectiles.length - 1; i >= 0; i--) {
                const proj = projectiles[i];
                proj.mesh.position.copy(proj.body.position);
                proj.mesh.quaternion.copy(proj.body.quaternion);
                if (Date.now() - proj.created > 8000 || proj.body.position.y < -10) {
                    scene.remove(proj.mesh); world.removeBody(proj.body); projectiles.splice(i, 1);
                }
            }
            
            renderer.render(scene, camera);
        }

        window.addEventListener('resize', () => { if (camera && renderer) { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight); } });
    </script>
</body>
</html>`);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🎮 Office Battle running on port ${PORT}`));
