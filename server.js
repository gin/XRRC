'use strict';

const http = require('http');
const path = require('path');
const express = require('express');
const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Serve client files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

// In-memory room map: roomName -> Map(clientId -> ws)
const rooms = new Map();

function getRoom(name) {
  if (!rooms.has(name)) {
    rooms.set(name, new Map());
  }
  return rooms.get(name);
}

function broadcastToRoom(room, senderWs, msg) {
  const data = JSON.stringify(msg);
  room.forEach((clientWs) => {
    if (clientWs !== senderWs && clientWs.readyState === 1 /* OPEN */) {
      clientWs.send(data);
    }
  });
}

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const roomName = url.searchParams.get('room') || 'default';
  const id = uuidv4();
  const room = getRoom(roomName);

  // Tell the new client its own ID and list of existing peers
  ws.send(
    JSON.stringify({
      type: 'welcome',
      id,
      peers: Array.from(room.keys()),
    })
  );

  // Notify existing peers that someone joined
  broadcastToRoom(room, ws, { type: 'peer-joined', id });

  // Register client
  room.set(id, ws);
  ws.rcId = id;
  ws.rcRoom = roomName;

  ws.on('message', (rawData) => {
    let msg;
    try {
      msg = JSON.parse(rawData);
    } catch {
      return; // ignore malformed messages
    }

    // Attach sender's ID so recipients know the source
    msg.from = id;

    if (msg.to) {
      // Directed message → forward to specific peer
      const targetWs = room.get(msg.to);
      if (targetWs && targetWs.readyState === 1) {
        targetWs.send(JSON.stringify(msg));
      }
    } else {
      // Broadcast to all other peers in the room
      broadcastToRoom(room, ws, msg);
    }
  });

  ws.on('close', () => {
    room.delete(id);
    broadcastToRoom(room, ws, { type: 'peer-left', id });
    // Clean up empty rooms
    if (room.size === 0) {
      rooms.delete(roomName);
    }
  });

  ws.on('error', (err) => {
    console.error(`WebSocket error for ${id}:`, err.message);
  });
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`XRRC server running → http://localhost:${PORT}`);
  });
}

module.exports = { server };
