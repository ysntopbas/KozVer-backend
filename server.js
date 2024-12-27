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
        origin: "https://kozver.netlify.app",
        methods: ["GET", "POST"],
        credentials: true,
        transports: ['websocket', 'polling']
    },
    allowEIO3: true,
    pingTimeout: 60000, // 60 saniye
    pingInterval: 25000, // 25 saniye
    cookie: {
        name: "socket-io",
        httpOnly: true,
        sameSite: "strict",
        secure: process.env.NODE_ENV === "production"
    }
});

app.use(cors({
    origin: "https://kozver.netlify.app",
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
    let connectionAttempts = 0;
    const MAX_CONNECTION_ATTEMPTS = 5;
    
    const startHeartbeat = () => {
        if (heartbeat) {
            clearInterval(heartbeat);
        }

        heartbeat = setInterval(() => {
            if (connectionAttempts >= MAX_CONNECTION_ATTEMPTS) {
                console.log(`${socket.id} için maksimum bağlantı denemesi aşıldı`);
                clearInterval(heartbeat);
                socket.disconnect(true);
                return;
            }

            socket.emit('ping', Date.now(), (response) => {
                if (!response) {
                    heartbeatMisses++;
                    connectionAttempts++;
                    console.log(`Heartbeat kaçırıldı: ${socket.id}, Deneme: ${connectionAttempts}`);
                } else {
                    heartbeatMisses = 0;
                    connectionAttempts = 0;
                }
            });
            
            if (heartbeatMisses >= MAX_RECONNECTION_ATTEMPTS) {
                console.log(`${socket.id} için heartbeat yanıtı alınamadı, bağlantı kesiliyor`);
                clearInterval(heartbeat);
                socket.disconnect(true);
            }
        }, HEARTBEAT_INTERVAL);
    };

    socket.on('pong', () => {
        heartbeatMisses = 0;
        connectionAttempts = 0;
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
            console.log(`Ses sinyali gönderiliyor: ${fromUsername} -> ${to} (${type})`);
            socket.to(targetSocketId).emit('voice-signal', {
                from: fromUsername,
                signal,
                type
            });
        } else {
            console.log(`Hedef kullanıcı bulunamadı: ${to}`);
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

    socket.on('disconnect', (reason) => {
        console.log(`Kullanıcı bağlantısı kesildi: ${socket.id}, Sebep: ${reason}`);
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

    // Yeni hata yakalama
    socket.on('error', (error) => {
        console.error(`Socket hatası (${socket.id}):`, error);
    });
});

// Global hata yakalama
io.engine.on('connection_error', (err) => {
    console.error('Bağlantı hatası:', err);
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
