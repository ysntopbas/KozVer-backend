const express = require('express');
const http = require('http');
const cors = require('cors');
const socketIO = require('socket.io');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
    cors: {
        origin: "http://localhost:3000",
        methods: ["GET", "POST"],
        credentials: true,
        transports: ['websocket', 'polling']
    },
    allowEIO3: true,
    cookie: {
        name: "socket-io",
        httpOnly: true,
        sameSite: "strict",
        secure: process.env.NODE_ENV === "production"
    }
});

app.use(cors({
    origin: "http://localhost:3000",
    methods: ["GET", "POST"],
    credentials: true
}));

app.use(cookieParser());

const users = new Map();
const rooms = new Map();

const HEARTBEAT_INTERVAL = 15000; // 15 saniye
const MAX_RECONNECTION_ATTEMPTS = 3;

io.on('connection', (socket) => {
    console.log('Yeni kullanıcı bağlandı:', socket.id);
    
    let heartbeat = null;
    let heartbeatMisses = 0;
    
    const startHeartbeat = () => {
        if (heartbeat) {
            clearInterval(heartbeat);
        }

        heartbeat = setInterval(() => {
            socket.emit('ping', Date.now());
            heartbeatMisses++;
            
            if (heartbeatMisses >= MAX_RECONNECTION_ATTEMPTS) {
                clearInterval(heartbeat);
                socket.disconnect(true);
            }
        }, HEARTBEAT_INTERVAL);
    };

    socket.on('pong', () => {
        heartbeatMisses = 0;
    });

    socket.on('join-room', (username) => {
        users.set(socket.id, username);
        startHeartbeat();
        
        const roomUsers = Array.from(users.values());
        io.emit('room-users', roomUsers);
        socket.broadcast.emit('user-joined', { username });
    });

    socket.on('voice-signal', ({ to, signal, type }) => {
        const fromUsername = users.get(socket.id);
        const targetSocketId = Array.from(users.entries())
            .find(([_, username]) => username === to)?.[0];
        
        if (targetSocketId && io.sockets.sockets.has(targetSocketId)) {
            socket.to(targetSocketId).emit('voice-signal', {
                from: fromUsername,
                signal,
                type
            });
        } else {
            // Hedef kullanıcı bulunamadı, göndereni bilgilendir
            socket.emit('voice-error', {
                target: to,
                error: 'user-not-connected'
            });
        }
    });

    socket.on('screen-signal', ({ to, signal }) => {
        const fromUsername = users.get(socket.id);
        io.to(Array.from(users.entries())
            .find(([_, username]) => username === to)?.[0])
            .emit('screen-signal', { 
                from: fromUsername, 
                signal 
            });
    });

    socket.on('disconnect', () => {
        if (heartbeat) {
            clearInterval(heartbeat);
        }
        
        const username = users.get(socket.id);
        if (username) {
            users.delete(socket.id);
            
            rooms.forEach(room => {
                room.delete(socket.id);
            });

            const roomUsers = Array.from(users.values());
            io.emit('room-users', roomUsers);
            socket.broadcast.emit('user-left', { username });
            console.log(`${username} odadan ayrıldı`);
        }
    });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
