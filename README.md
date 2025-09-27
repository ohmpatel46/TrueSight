# Anti-Cheating Video Conference

A local video-conferencing prototype with mesh WebRTC for connecting multiple peers (laptops and phones) in the same room.

## Features

- **Mesh WebRTC**: Each peer connects directly to every other peer
- **Real-time Signaling**: Node.js + Socket.io server for coordination
- **Modern UI**: React + Vite + TypeScript with Tailwind CSS
- **Multi-device Support**: Works with laptops and phones
- **Auto-layout Video Tiles**: Responsive grid for all participants
- **Connection Monitoring**: Real-time event log and status tracking
- **Camera Controls**: Toggle local video on/off
- **ICE Connectivity**: Google STUN server for NAT traversal

## Architecture

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   Laptop 1  │    │   Laptop 2  │    │    Phone    │
│             │    │             │    │             │
│  ┌────────┐ │    │  ┌────────┐ │    │  ┌────────┐ │
│  │ React  │ │    │  │ React  │ │    │  │React   │ │
│  │ Client │ │    │  │ Client │ │    │  │Native  │ │
│  └────────┘ │    │  └────────┘ │    │  └────────┘ │
└─────────────┘    └─────────────┘    └─────────────┘
       │                   │                   │
       └───────────────────┼───────────────────┘
                           │
                    ┌─────────────┐
                    │   Socket.io │
                    │   Server    │
                    │  (Signaling)│
                    └─────────────┘
```

## Quick Start

### Prerequisites
- Node.js 18+ 
- Modern browser with WebRTC support
- Camera and microphone access

### Installation

1. **Clone and install dependencies:**
   ```bash
   git clone <repository>
   cd anti-cheating-video-conference
   npm install
   ```

2. **Start development servers:**
   ```bash
   npm run dev
   ```
   This starts:
   - Signaling server on `http://localhost:3001`
   - Web client on `http://localhost:5173`

3. **Open browser:**
   Navigate to `http://localhost:5173`

### Usage

1. **Join a room:**
   - Enter a room name (e.g., "interview-room")
   - Verify signaling URL (default: http://localhost:3001)
   - Click "Join Room"
   - Allow camera/microphone permissions

2. **Connect additional peers:**
   - Open the same URL in other browsers/devices
   - Use the same room name
   - Video tiles will appear automatically

3. **Controls:**
   - **Toggle Camera**: Enable/disable local video
   - **Leave Room**: Disconnect and close all connections
   - **Event Log**: Monitor connection states and ICE events

## Project Structure

```
├── server/                 # Signaling server
│   ├── src/
│   │   └── index.ts       # Socket.io server with room management
│   ├── package.json
│   └── tsconfig.json
├── client/                 # React web client
│   ├── src/
│   │   ├── components/
│   │   │   ├── Controls.tsx    # Room controls and settings
│   │   │   ├── VideoTile.tsx   # Individual video stream display
│   │   │   └── EventLog.tsx    # Connection event monitoring
│   │   ├── App.tsx        # Main WebRTC mesh implementation
│   │   └── main.tsx
│   ├── package.json
│   └── vite.config.ts
├── package.json           # Root package with dev scripts
└── README.md
```

## WebRTC Implementation Details

### Mesh Topology
- Each peer maintains a separate `RTCPeerConnection` for every other peer
- Direct peer-to-peer connections (no media server required)
- Automatic offer/answer exchange for new peers

### Signaling Protocol
```typescript
// Message types
type SignalingMessage = {
  type: 'offer' | 'answer' | 'ice-candidate' | 'join' | 'leave';
  room: string;
  from: string;
  to?: string;        // Optional: specific peer or broadcast
  data?: any;         // RTCSessionDescription or RTCIceCandidate
}
```

### Connection Flow
1. **Join Room**: Client connects to signaling server
2. **Peer Discovery**: Server sends list of existing peers
3. **Offer Creation**: Existing peers create offers for new peer
4. **Answer Exchange**: New peer answers offers from existing peers
5. **ICE Candidates**: Exchange ICE candidates for NAT traversal
6. **Media Streams**: Attach remote tracks to video tiles

### Phone Compatibility
The web client is designed to work with React Native clients using the same signaling protocol:
- Accepts offers from phone clients
- Sends offers to phone clients
- Handles bidirectional media streams

## Development

### Available Scripts

```bash
# Development (both server and client)
npm run dev

# Server only
npm run dev:server

# Client only  
npm run dev:client

# Production build
npm run build

# Start production server
npm start
```

### Environment Variables
- `PORT`: Server port (default: 3001)
- `NODE_ENV`: Environment mode

## Browser Support

- Chrome 56+
- Firefox 52+
- Safari 11+
- Edge 79+

## Troubleshooting

### Common Issues

1. **Camera not working**: Check browser permissions
2. **Connection failed**: Verify signaling server is running
3. **No video tiles**: Check network connectivity and firewall
4. **ICE failures**: Ensure STUN server is accessible

### Debug Information
- Event log shows real-time connection states
- Browser dev tools Network tab for signaling messages
- Console logs for WebRTC events

## Security Notes

- Designed for local network use (same Wi-Fi)
- No TURN server required for local testing
- STUN server used for NAT traversal only
- No authentication implemented (local prototype)

## Future Enhancements

- [ ] TURN server support for external networks
- [ ] Screen sharing capabilities
- [ ] Chat functionality
- [ ] Recording features
- [ ] Mobile app integration
- [ ] Authentication and room security
