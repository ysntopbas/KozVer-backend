const express = require('express');
const http = require('http');
const cors = require('cors');
const socketIO = require('socket.io');
const cookieParser = require('cookie-parser');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        credentials: true,
        allowedHeaders: ["my-custom-header"],
    },
    cookie: {
        name: "socket-io",
        httpOnly: true,
        sameSite: "strict",
        secure: process.env.NODE_ENV === "production"
    }
});

app.use(cors({
    origin: "*",
    credentials: true
}));

app.use(cookieParser());

const users = new Map();
const rooms = new Map();

io.on('connection', (socket) => {
    console.log('Bir kullanıcı bağlandı:', socket.id);

    socket.on('join-room', (username) => {
        users.set(socket.id, username);
        
        if (!rooms.has('main')) {
            rooms.set('main', new Set());
        }
        rooms.get('main').add(socket.id);

        const roomUsers = Array.from(users.values());
        io.emit('room-users', roomUsers);
        socket.broadcast.emit('user-joined', { username });
        console.log(`${username} odaya katıldı`);
    });

    socket.on('voice-signal', ({ to, signal, type }) => {
        const fromUsername = users.get(socket.id);
        const targetSocketId = Array.from(users.entries())
            .find(([_, username]) => username === to)?.[0];
        
        if (targetSocketId) {
            if (io.sockets.sockets.has(targetSocketId)) {
                console.log(`Ses sinyali: ${fromUsername} -> ${to} (${type})`);
                socket.to(targetSocketId).emit('voice-signal', {
                    from: fromUsername,
                    signal,
                    type
                });
            } else {
                socket.emit('voice-error', {
                    target: to,
                    error: 'user-not-connected'
                });
            }
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
    console.log(`Server ${PORT} portunda çalışıyor`);
});
