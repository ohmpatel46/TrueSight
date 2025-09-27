import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

// Store room information - now maps room -> Set of PeerJS peer IDs
const rooms = new Map<string, Set<string>>();

// Map socket ID to PeerJS peer ID for cleanup
const socketToPeer = new Map<string, string>();

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('join-room', (data: { room: string; peerId: string }) => {
    const { room, peerId } = data;
    const socketId = socket.id;

    console.log(`Socket ${socketId} with PeerJS ID ${peerId} attempting to join room: ${room}`);

    // Join the socket room
    socket.join(room);

    // Track socket -> peer mapping for cleanup
    socketToPeer.set(socketId, peerId);

    // Add PeerJS peer ID to room tracking
    if (!rooms.has(room)) {
      rooms.set(room, new Set());
      console.log(`Created new room: ${room}`);
    }
    rooms.get(room)!.add(peerId);

    // Notify existing peers about new peer
    const existingPeers = Array.from(rooms.get(room)!).filter(id => id !== peerId);
    socket.emit('existing-peers', { peers: existingPeers });

    // Notify other peers about new peer
    socket.to(room).emit('peer-joined', { peerId });

    console.log(`PeerJS peer ${peerId} joined room ${room}. Existing peers:`, existingPeers);
    console.log(`Total peers in room ${room}:`, rooms.get(room)!.size);
  });

  // PeerJS handles all signaling internally, so we can remove the signaling handler
  // The socket server now only manages room membership

  socket.on('disconnect', () => {
    const socketId = socket.id;
    const peerId = socketToPeer.get(socketId);
    
    console.log(`Client disconnected: socket=${socketId}, peer=${peerId}`);

    if (peerId) {
      // Remove from all rooms and notify peers
      rooms.forEach((peers, room) => {
        if (peers.has(peerId)) {
          peers.delete(peerId);
          socket.to(room).emit('peer-left', { peerId });
          
          if (peers.size === 0) {
            rooms.delete(room);
          }
          
          console.log(`PeerJS peer ${peerId} left room ${room}`);
        }
      });

      // Clean up mapping
      socketToPeer.delete(socketId);
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Signaling server running on port ${PORT}`);
});
