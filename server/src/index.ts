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

// Enhanced room participant tracking
interface RoomParticipant {
  peerId: string;
  socketId: string;
  role: 'interviewer' | 'interviewee-laptop' | 'interviewee-phone';
  joinedAt: Date;
}

// Store room information - maps room -> Map of peerId -> participant info
const rooms = new Map<string, Map<string, RoomParticipant>>();

// Map socket ID to PeerJS peer ID for cleanup
const socketToPeer = new Map<string, string>();

// Track room creators (first to join = interviewer)
const roomCreators = new Map<string, string>(); // room -> interviewer peerId

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('join-room', (data: { room: string; peerId: string }) => {
    const { room, peerId } = data;
    const socketId = socket.id;

    console.log(`Socket ${socketId} with PeerJS ID ${peerId} attempting to join room: ${room}`);

    // Initialize room if it doesn't exist
    if (!rooms.has(room)) {
      rooms.set(room, new Map());
      console.log(`Created new room: ${room}`);
    }

    const roomParticipants = rooms.get(room)!;
    
    // Determine role based on join order
    let role: 'interviewer' | 'interviewee-laptop';
    
    if (roomParticipants.size === 0) {
      // First person to join = interviewer
      role = 'interviewer';
      roomCreators.set(room, peerId);
      console.log(`👨‍💼 ${peerId} assigned as INTERVIEWER (room creator)`);
    } else if (roomParticipants.size === 1) {
      // Second person = interviewee laptop
      role = 'interviewee-laptop';
      console.log(`👨‍💻 ${peerId} assigned as INTERVIEWEE LAPTOP`);
    } else {
      // Room is full (max 2 web clients + 1 phone)
      console.log(`❌ Room ${room} is full. Rejecting ${peerId}`);
      socket.emit('room-full', { room });
      return;
    }

    // Join the socket room
    socket.join(room);

    // Track socket -> peer mapping for cleanup
    socketToPeer.set(socketId, peerId);

    // Add participant to room tracking
    const participant: RoomParticipant = {
      peerId,
      socketId,
      role,
      joinedAt: new Date()
    };
    roomParticipants.set(peerId, participant);

    // Notify client of their assigned role
    socket.emit('role-assigned', { role, room });

    // Get existing peers (only web clients for WebRTC)
    const existingWebPeers = Array.from(roomParticipants.values())
      .filter(p => p.role !== 'interviewee-phone' && p.peerId !== peerId)
      .map(p => ({ peerId: p.peerId, role: p.role }));

    socket.emit('existing-peers', { peers: existingWebPeers });

    // Notify other web clients about new peer
    socket.to(room).emit('peer-joined', { peerId, role });

    console.log(`✅ ${peerId} (${role}) joined room ${room}`);
    console.log(`📊 Room ${room} participants:`, Array.from(roomParticipants.values()).map(p => `${p.peerId}:${p.role}`));
  });

  // Handle video frames from Android phones
  socket.on('video-frame', (data: any) => {
    console.log(`📱 Received video-frame from socket ${socket.id}`);
    
    // Detect if this is a phone by checking for JSON structure with base64 data
    let frameData: any;
    let isPhone = false;
    
    if (typeof data === 'string') {
      // Raw base64 string - assume it's a phone
      isPhone = true;
      frameData = {
        type: 'video-frame',
        data: data,
        timestamp: Date.now(),
        from: `phone-${socket.id}`
      };
    } else if (typeof data === 'object' && data.data) {
      // JSON object with base64 data - definitely a phone
      isPhone = true;
      frameData = data;
    } else {
      console.log(`❌ Invalid video-frame format from ${socket.id}`);
      return;
    }

    if (isPhone) {
      // Auto-assign phone role if not already assigned
      const phoneId = `phone-${socket.id}`;
      
      // Find room this phone should belong to
      let targetRoom: string | null = null;
      
      if (frameData.room) {
        targetRoom = frameData.room;
      } else {
        // If no room specified, try to find a room that needs a phone
        for (const [roomName, participants] of rooms.entries()) {
          const hasPhone = Array.from(participants.values()).some(p => p.role === 'interviewee-phone');
          if (!hasPhone && participants.size >= 1) {
            targetRoom = roomName;
            break;
          }
        }
      }

      if (!targetRoom) {
        console.log(`❌ No suitable room found for phone ${socket.id}`);
        return;
      }

      const roomParticipants = rooms.get(targetRoom);
      if (!roomParticipants) {
        console.log(`❌ Room ${targetRoom} not found for phone`);
        return;
      }

      // Check if phone already exists in room
      const existingPhone = Array.from(roomParticipants.values()).find(p => p.role === 'interviewee-phone');
      if (!existingPhone) {
        // Add phone to room
        socket.join(targetRoom);
        const phoneParticipant: RoomParticipant = {
          peerId: phoneId,
          socketId: socket.id,
          role: 'interviewee-phone',
          joinedAt: new Date()
        };
        roomParticipants.set(phoneId, phoneParticipant);
        
        console.log(`📱 Phone ${phoneId} auto-joined room ${targetRoom}`);
        
        // Notify web clients that phone connected
        socket.to(targetRoom).emit('phone-connected', { phoneId });
      }

      // Forward frame to all participants in the room
      const forwardedData = {
        ...frameData,
        room: targetRoom,
        from: phoneId,
        serverTimestamp: Date.now()
      };

      socket.to(targetRoom).emit('video-frame', forwardedData);
      console.log(`📤 Forwarded phone frame to room ${targetRoom}`);
    }
  });

  // Handle malpractice detection alerts
  socket.on('malpractice-detected', (data: { alert: any; room?: string }) => {
    console.log(`🚨 Malpractice alert from ${socket.id}:`, data.alert);
    
    // Find the room this socket belongs to
    let targetRoom: string | null = data.room;
    
    if (!targetRoom) {
      // Find room by socket
      for (const [roomName, participants] of rooms.entries()) {
        const participant = Array.from(participants.values()).find(p => p.socketId === socket.id);
        if (participant) {
          targetRoom = roomName;
          break;
        }
      }
    }
    
    if (targetRoom) {
      // Forward alert to interviewer in the room
      const roomParticipants = rooms.get(targetRoom);
      if (roomParticipants) {
        const interviewer = Array.from(roomParticipants.values()).find(p => p.role === 'interviewer');
        if (interviewer) {
          io.to(interviewer.socketId).emit('malpractice-detected', data);
          console.log(`📤 Forwarded alert to interviewer ${interviewer.peerId} in room ${targetRoom}`);
        }
      }
    }
  });

  // PeerJS handles all signaling internally, so we can remove the signaling handler
  // The socket server now only manages room membership

  socket.on('disconnect', () => {
    const socketId = socket.id;
    const peerId = socketToPeer.get(socketId);
    
    console.log(`Client disconnected: socket=${socketId}, peer=${peerId}`);

    // Handle both web clients and phones
    rooms.forEach((participants, roomName) => {
      // Check for web client by peerId
      if (peerId && participants.has(peerId)) {
        const participant = participants.get(peerId)!;
        participants.delete(peerId);
        
        socket.to(roomName).emit('peer-left', { peerId, role: participant.role });
        console.log(`${participant.role} ${peerId} left room ${roomName}`);
        
        // Clean up room creator tracking
        if (participant.role === 'interviewer') {
          roomCreators.delete(roomName);
        }
      }
      
      // Check for phone by socketId (phones use socket-based IDs)
      const phoneParticipant = Array.from(participants.values()).find(p => p.socketId === socketId);
      if (phoneParticipant) {
        participants.delete(phoneParticipant.peerId);
        socket.to(roomName).emit('phone-disconnected', { phoneId: phoneParticipant.peerId });
        console.log(`Phone ${phoneParticipant.peerId} disconnected from room ${roomName}`);
      }
      
      // Clean up empty rooms
      if (participants.size === 0) {
        rooms.delete(roomName);
        roomCreators.delete(roomName);
        console.log(`Room ${roomName} deleted (empty)`);
      }
    });

    // Clean up mapping
    if (peerId) {
      socketToPeer.delete(socketId);
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Signaling server running on port ${PORT}`);
});
