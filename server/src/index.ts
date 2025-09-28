import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import axios from 'axios';

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

// ML Service configuration
const ML_SERVICE_URL = 'http://localhost:8000';

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

      // Validate base64 data before sending to ML service
      console.log(`📱 Frame data validation:`, {
        hasData: !!frameData.data,
        dataType: typeof frameData.data,
        dataLength: frameData.data ? frameData.data.length : 0,
        isBase64Like: frameData.data ? /^[A-Za-z0-9+/]*={0,2}$/.test(frameData.data) : false,
        startsWithJPEG: frameData.data ? frameData.data.startsWith('/9j/') : false
      });

      // Send frame to ML service for human detection (async)
      (async () => {
        try {
          const mlResponse = await axios.post(`${ML_SERVICE_URL}/detect-humans`, {
          data: frameData.data,
          timestamp: frameData.timestamp || Date.now(),
          room: targetRoom
        }, {
          timeout: 5000 // 5 second timeout
        });

        const mlResult = mlResponse.data;
        console.log(`🤖 ML Analysis: ${mlResult.humans_detected} humans, malpractice: ${mlResult.malpractice_detected}`);

        // Forward frame with ML analysis to all participants
        const forwardedData = {
          ...frameData,
          room: targetRoom,
          from: phoneId,
          serverTimestamp: Date.now(),
          mlAnalysis: {
            humans_detected: mlResult.humans_detected,
            malpractice_detected: mlResult.malpractice_detected,
            confidence: mlResult.confidence,
            processing_time: mlResult.processing_time_ms
          }
        };

        socket.to(targetRoom).emit('video-frame', forwardedData);
        
        // Send malpractice alerts if detected
        if (mlResult.malpractice_detected && mlResult.alerts.length > 0) {
          const roomParticipants = rooms.get(targetRoom);
          if (roomParticipants) {
            // Send to interviewer
            const interviewer = Array.from(roomParticipants.values()).find(p => p.role === 'interviewer');
            if (interviewer) {
              io.to(interviewer.socketId).emit('malpractice-alert', {
                type: 'human-detection',
                alerts: mlResult.alerts,
                confidence: mlResult.confidence,
                timestamp: Date.now(),
                humans_detected: mlResult.humans_detected,
                detections: mlResult.human_detections
              });
              console.log(`🚨 Sent malpractice alert to interviewer ${interviewer.peerId}`);
            }
          }
        }

        console.log(`📤 Forwarded analyzed frame to room ${targetRoom}`);
        
      } catch (mlError: any) {
        console.error(`❌ ML service error details:`, {
          message: mlError?.message,
          code: mlError?.code,
          response: mlError?.response?.data,
          status: mlError?.response?.status,
          url: `${ML_SERVICE_URL}/detect-humans`
        });
        
        // Forward frame without ML analysis as fallback
        const forwardedData = {
          ...frameData,
          room: targetRoom,
          from: phoneId,
          serverTimestamp: Date.now(),
          mlAnalysis: {
            error: 'ML service unavailable',
            humans_detected: -1,
            malpractice_detected: false
          }
        };

        socket.to(targetRoom).emit('video-frame', forwardedData);
        console.log(`📤 Forwarded frame without ML analysis to room ${targetRoom}`);
      }
      })(); // End async IIFE
    }
  });

  // Handle malpractice detection alerts
  socket.on('malpractice-detected', (data: { alert: any; room?: string }) => {
    console.log(`🚨 Malpractice alert from ${socket.id}:`, data.alert);
    
    // Find the room this socket belongs to
    let targetRoom: string | null = data.room || null;
    
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

  // Handle tab switch detection from interviewee laptop
  socket.on('tab-switch-detected', async (data: { type: string; timestamp: number; room: string }) => {
    console.log(`🔄 Tab switch detected from ${socket.id}: ${data.type} in room ${data.room}`);
    
    if (data.type === 'away') {
      // User switched away from interview tab - trigger overlay detection sequence
      try {
        console.log(`🎭 [DEMO] Triggering overlay detection sequence for tab switch`);
        
        // Call overlay detection endpoint with demo trigger
        const overlayResponse = await axios.post(`${ML_SERVICE_URL}/detect-overlays`, {
          data: 'demo_tab_switch_trigger', // Special trigger
          timestamp: data.timestamp,
          room: data.room
        }, {
          timeout: 5000
        });

        const overlayResult = overlayResponse.data;
        console.log(`🎭 [DEMO] Overlay detection triggered by tab switch`);

        // Find interviewer in the room and start sending alerts
        const roomParticipants = rooms.get(data.room);
        if (roomParticipants) {
          const interviewer = Array.from(roomParticipants.values()).find(p => p.role === 'interviewer');
          if (interviewer) {
            // Send initial tab switch alert
            io.to(interviewer.socketId).emit('malpractice-alert', {
              type: 'overlay-detection',
              alerts: ['Tab switch detected'],
              confidence: 0.90,
              timestamp: Date.now(),
              overlay_type: 'tab_switch_detected'
            });
            console.log(`🚨 Sent tab switch alert to interviewer ${interviewer.peerId}`);

            // Start sending overlay alerts every 2 seconds (4 times)
            let alertCount = 0;
            const overlayAlertInterval = setInterval(async () => {
              alertCount++;
              
              if (alertCount <= 4) {
                try {
                  // Call overlay detection to get next demo alert
                  const overlayResponse = await axios.post(`${ML_SERVICE_URL}/detect-overlays`, {
                    data: 'demo_check_sequence', // Check for next alert in sequence
                    timestamp: Date.now(),
                    room: data.room
                  }, {
                    timeout: 5000
                  });

                  const overlayResult = overlayResponse.data;
                  
                  if (overlayResult.has_overlay && overlayResult.overlay_type === 'overlay_detected') {
                    // Send overlay alert
                    io.to(interviewer.socketId).emit('malpractice-alert', {
                      type: 'overlay-detection',
                      alerts: ['Overlay detected'],
                      confidence: overlayResult.confidence,
                      timestamp: Date.now(),
                      overlay_type: 'overlay_detected'
                    });
                    console.log(`🚨 Sent overlay alert ${alertCount}/4 to interviewer ${interviewer.peerId}`);
                  }
                } catch (error: any) {
                  console.error(`⚠️ Error sending overlay alert ${alertCount}:`, error.message);
                }
              } else {
                // Stop after 4 alerts
                clearInterval(overlayAlertInterval);
                console.log(`🎭 [DEMO] Completed overlay alert sequence`);
              }
            }, 2000); // Every 2 seconds
          }
        }

      } catch (error: any) {
        console.error(`⚠️ Error triggering overlay detection on tab switch:`, error.message);
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
