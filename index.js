const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mineflayer = require('mineflayer');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let activeBot = null;
let currentConnectionState = {
    connected: false,
    username: '',
    host: '',
    port: 25565
};

io.on('connection', (socket) => {
    // Send current status on load
    socket.emit('status', currentConnectionState);

    // Handle connection request from frontend
    socket.on('connect-server', (data) => {
        const { host, port, username } = data;

        if (activeBot) {
            socket.emit('chat-message', { sender: 'System', message: 'Already connected or connecting. Disconnect first.' });
            return;
        }

        if (!host || !username) {
            socket.emit('chat-message', { sender: 'System', message: 'Host and Username are required.' });
            return;
        }

        currentConnectionState.username = username;
        currentConnectionState.host = host;
        currentConnectionState.port = parseInt(port) || 25565;

        io.emit('status', currentConnectionState);
        io.emit('chat-message', { sender: 'System', message: `Attempting to connect to ${host}:${port} as ${username}...` });

        try {
            activeBot = mineflayer.createBot({
                host: currentConnectionState.host,
                port: currentConnectionState.port,
                username: currentConnectionState.username,
                version: false // Auto-detect version
            });

            activeBot.on('spawn', () => {
                currentConnectionState.connected = true;
                io.emit('status', currentConnectionState);
                io.emit('chat-message', { sender: 'System', message: 'Successfully joined the server!' });
            });

            activeBot.on('chat', (username, message) => {
                io.emit('chat-message', { sender: username, message: message });
            });

            activeBot.on('messagestr', (message) => {
                // Catches server announcements and non-player chat logs
                io.emit('chat-message', { sender: 'Server', message: message });
            });

            activeBot.on('end', (reason) => {
                io.emit('chat-message', { sender: 'System', message: `Disconnected from server: ${reason}` });
                cleanupBot();
            });

            activeBot.on('error', (err) => {
                io.emit('chat-message', { sender: 'System', message: `Connection Error: ${err.message}` });
                cleanupBot();
            });

        } catch (e) {
            io.emit('chat-message', { sender: 'System', message: `Failed to create bot: ${e.message}` });
            cleanupBot();
        }
    });

    // Handle user sending chat messages to the server
    socket.on('send-chat', (message) => {
        if (activeBot && currentConnectionState.connected) {
            activeBot.chat(message);
            // Optionally display own message locally
            io.emit('chat-message', { sender: currentConnectionState.username, message: message });
        } else {
            socket.emit('chat-message', { sender: 'System', message: 'Cannot chat: Bot is not connected.' });
        }
    });

    // Handle manual disconnect
    socket.on('disconnect-server', () => {
        if (activeBot) {
            activeBot.quit();
            cleanupBot();
            io.emit('chat-message', { sender: 'System', message: 'Disconnected by user.' });
        }
    });
});

function cleanupBot() {
    if (activeBot) {
        try { activeBot.end(); } catch(e) {}
        activeBot = null;
    }
    currentConnectionState.connected = false;
    io.emit('status', currentConnectionState);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
