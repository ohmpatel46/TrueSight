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

// Store room information
const rooms = new Map<string, Set<string>>();

interface SignalingMessage {
  type: 'offer' | 'answer' | 'ice-candidate' | 'join' | 'leave';
  room: string;
  from: string;
  to?: string;
  data?: any;
}

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('join-room', (data: { room: string }) => {
    const { room } = data;
    const peerId = socket.id;

    console.log(`Peer ${peerId} attempting to join room: ${room}`);

    // Join the socket room
    socket.join(room);

    // Add peer to room tracking
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

    console.log(`Peer ${peerId} joined room ${room}. Existing peers:`, existingPeers);
    console.log(`Total peers in room ${room}:`, rooms.get(room)!.size);
  });

  socket.on('signaling', (message: SignalingMessage) => {
    const { type, room, from, to, data } = message;

    if (to) {
      // Send to specific peer
      io.to(to).emit('signaling', {
        type,
        room,
        from,
        data
      });
    } else {
      // Broadcast to room
      socket.to(room).emit('signaling', {
        type,
        room,
        from,
        data
      });
    }

    console.log(`Signaling message: ${type} from ${from} to ${to || 'room'}`);
  });

  socket.on('disconnect', () => {
    const peerId = socket.id;
    console.log('Client disconnected:', peerId);

    // Remove from all rooms and notify peers
    rooms.forEach((peers, room) => {
      if (peers.has(peerId)) {
        peers.delete(peerId);
        socket.to(room).emit('peer-left', { peerId });
        
        if (peers.size === 0) {
          rooms.delete(room);
        }
        
        console.log(`Peer ${peerId} left room ${room}`);
      }
    });
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Signaling server running on port ${PORT}`);
});
