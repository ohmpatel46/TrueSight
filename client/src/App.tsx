import React, { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import VideoTile from './components/VideoTile';
import Controls from './components/Controls';
import EventLog from './components/EventLog';

interface Peer {
  id: string;
  connection: RTCPeerConnection;
  stream?: MediaStream;
  processingOffer?: boolean;
}

interface LogEntry {
  timestamp: Date;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
}

const App: React.FC = () => {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isRoomCreator, setIsRoomCreator] = useState(false);
  const [processedOffers, setProcessedOffers] = useState<Set<string>>(new Set());
  const [roomName, setRoomName] = useState('');
  const [signalingUrl, setSignalingUrl] = useState(() => {
    // Auto-detect signaling URL based on current host
    const hostname = window.location.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return 'http://localhost:3001';
    } else {
      return `http://${hostname}:3001`;
    }
  });
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [peers, setPeers] = useState<Map<string, Peer>>(new Map());
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isLocalVideoEnabled, setIsLocalVideoEnabled] = useState(true);

  // Check browser compatibility on mount
  useEffect(() => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      addLog('Warning: Camera/microphone not supported on this device', 'warning');
    }
    if (!window.RTCPeerConnection) {
      addLog('Warning: WebRTC not supported on this device', 'warning');
    }
  }, []);

  const addLog = (message: string, type: LogEntry['type'] = 'info') => {
    setLogs(prev => [...prev, { timestamp: new Date(), message, type }]);
  };

  const createPeerConnection = (peerId: string): RTCPeerConnection => {
    addLog(`Creating peer connection for ${peerId}`, 'info');
    
    const configuration = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' }
      ]
    };

    const peerConnection = new RTCPeerConnection(configuration);

    // Handle incoming tracks
    peerConnection.ontrack = (event) => {
      addLog(`Received track from ${peerId}`, 'success');
      addLog(`Track info: ${event.track.kind} track, ${event.streams.length} streams`, 'info');
      setPeers(prev => {
        const newPeers = new Map(prev);
        const peer = newPeers.get(peerId);
        if (peer) {
          peer.stream = event.streams[0];
          newPeers.set(peerId, peer);
        }
        return newPeers;
      });
    };

    // Handle ICE candidates
    peerConnection.onicecandidate = (event) => {
      if (event.candidate && socket) {
        socket.emit('signaling', {
          type: 'ice-candidate',
          room: roomName,
          from: socket.id,
          to: peerId,
          data: event.candidate
        });
      }
    };

    // Handle connection state changes
    peerConnection.onconnectionstatechange = () => {
      addLog(`Connection state with ${peerId}: ${peerConnection.connectionState}`, 'info');
    };

    peerConnection.oniceconnectionstatechange = () => {
      addLog(`ICE connection state with ${peerId}: ${peerConnection.iceConnectionState}`, 'info');
    };

    return peerConnection;
  };

  const joinRoom = async () => {
    if (!roomName.trim()) {
      addLog('Please enter a room name', 'error');
      return;
    }

    try {
      // Try to get local media stream, but don't fail if not available
      let stream = null;
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: true
          });
          setLocalStream(stream);
          addLog('Local media stream obtained', 'success');
        } catch (error) {
          addLog(`Camera/microphone not available: ${error.message}`, 'warning');
          addLog('Joining as viewer only (no local video)', 'info');
        }
      } else {
        addLog('Camera/microphone not supported on this device', 'warning');
        addLog('Joining as viewer only (no local video)', 'info');
      }

      // Connect to signaling server
      addLog(`Attempting to connect to: ${signalingUrl}`, 'info');
      const newSocket = io(signalingUrl);
      setSocket(newSocket);

      newSocket.on('connect', () => {
        addLog(`✅ Connected to signaling server (${signalingUrl})`, 'success');
        addLog(`Socket ID: ${newSocket.id}`, 'info');
        setIsConnected(true);
        addLog(`Joining room: ${roomName}`, 'info');
        newSocket.emit('join-room', { room: roomName });
      });

      newSocket.on('connect_error', (error) => {
        addLog(`❌ Connection error: ${error.message}`, 'error');
        addLog(`Failed to connect to: ${signalingUrl}`, 'error');
        setIsConnected(false);
      });

      newSocket.on('disconnect', (reason) => {
        addLog(`⚠️ Disconnected: ${reason}`, 'warning');
        setIsConnected(false);
      });

      newSocket.on('existing-peers', ({ peers }: { peers: string[] }) => {
        addLog(`Found ${peers.length} existing peers`, 'info');
        
        if (peers.length === 0) {
          // We're the first peer - we're the room creator
          setIsRoomCreator(true);
          addLog(`🏠 ROLE: Room Creator (waiting for others to join)`, 'info');
        } else {
          // We're joining an existing room - we're the joiner
          setIsRoomCreator(false);
          addLog(`🚪 ROLE: Room Joiner (will initiate offers)`, 'info');
        }
        
        // Create connections to existing peers
        peers.forEach(peerId => {
          const peerConnection = createPeerConnection(peerId);
          setPeers(prev => new Map(prev).set(peerId, { id: peerId, connection: peerConnection }));

          // Add local stream to peer connection (if available)
          if (stream) {
            stream.getTracks().forEach(track => {
              peerConnection.addTrack(track, stream);
            });
          }

          // Room creator waits, joiner initiates
          if (peers.length === 0) {
            addLog(`⏳ ROOM CREATOR: Waiting for offer from ${peerId}`, 'info');
          } else {
            addLog(`🚀 ROOM JOINER: Will create offer for ${peerId}`, 'info');
            // Create offer immediately since we're the joiner
            peerConnection.createOffer().then(offer => {
              addLog(`✅ Created offer for existing peer ${peerId}`, 'info');
              peerConnection.setLocalDescription(offer);
              newSocket.emit('signaling', {
                type: 'offer',
                room: roomName,
                from: newSocket.id,
                to: peerId,
                data: offer
              });
              addLog(`📤 Sent offer to existing peer ${peerId}`, 'info');
            }).catch(error => {
              addLog(`❌ Error creating offer for existing peer ${peerId}: ${error}`, 'error');
            });
          }
        });
      });

      newSocket.on('peer-joined', ({ peerId }: { peerId: string }) => {
        addLog(`New peer joined: ${peerId}`, 'info');
        
        // Create connection to new peer
        const peerConnection = createPeerConnection(peerId);
        setPeers(prev => new Map(prev).set(peerId, { id: peerId, connection: peerConnection }));

        // Add local stream to peer connection (if available)
        if (stream) {
          stream.getTracks().forEach(track => {
            peerConnection.addTrack(track, stream);
          });
        }

        // Room creators initiate offers to new peers, joiners wait
        // Check if we have existing peers to determine our role
        const currentPeerCount = peers.size;
        if (currentPeerCount === 0) {
          // We're the room creator - initiate offer to new peer
          addLog(`🏠 ROOM CREATOR: Creating offer for new peer ${peerId}`, 'info');
          peerConnection.createOffer().then(offer => {
            addLog(`✅ Created offer for new peer ${peerId}`, 'info');
            peerConnection.setLocalDescription(offer);
            newSocket.emit('signaling', {
              type: 'offer',
              room: roomName,
              from: newSocket.id,
              to: peerId,
              data: offer
            });
            addLog(`📤 Sent offer to new peer ${peerId}`, 'info');
          }).catch(error => {
            addLog(`❌ Error creating offer for new peer ${peerId}: ${error}`, 'error');
          });
        } else {
          // We're a joiner - wait for offer from new peer
          addLog(`🚪 ROOM JOINER: Waiting for offer from new peer ${peerId}`, 'info');
        }
      });

      newSocket.on('peer-left', ({ peerId }: { peerId: string }) => {
        addLog(`Peer left: ${peerId}`, 'warning');
        setPeers(prev => {
          const newPeers = new Map(prev);
          const peer = newPeers.get(peerId);
          if (peer) {
            peer.connection.close();
            newPeers.delete(peerId);
          }
          return newPeers;
        });
      });

      newSocket.on('signaling', async ({ type, from, data }: any) => {
        addLog(`📨 NEW LOGIC: Received ${type} from ${from}`, 'info');
        
        // Get peer from current state using setPeers callback
        setPeers(currentPeers => {
          const peer = currentPeers.get(from);
          if (!peer) {
            addLog(`No peer connection found for ${from}`, 'warning');
            return currentPeers;
          }

          // Handle signaling message asynchronously
          (async () => {
            try {
              switch (type) {
                case 'offer':
                  addLog(`📥 Processing offer from ${from}, current state: ${peer.connection.signalingState}`, 'info');
                  
                  // Create unique offer ID for duplicate detection
                  const offerId = `${from}-${data.sdp?.slice(0, 20) || 'unknown'}`;
                  
                  // Check if we've already processed this exact offer
                  if (processedOffers.has(offerId)) {
                    addLog(`⚠️ Already processed offer ${offerId}, ignoring duplicate`, 'warning');
                    break;
                  }
                  
                  if (peer.connection.signalingState === 'stable') {
                    addLog(`✅ Connection stable, processing offer from ${from}`, 'info');
                    
                    // Mark offer as processed
                    setProcessedOffers(prev => new Set(prev).add(offerId));
                    
                    try {
                      await peer.connection.setRemoteDescription(data);
                      const answer = await peer.connection.createAnswer();
                      await peer.connection.setLocalDescription(answer);
                      
                      newSocket.emit('signaling', {
                        type: 'answer',
                        room: roomName,
                        from: newSocket.id,
                        to: from,
                        data: answer
                      });
                      addLog(`📤 Sent answer to ${from}`, 'info');
                    } catch (error) {
                      addLog(`❌ Error processing offer from ${from}: ${error}`, 'error');
                      // Remove from processed set on error so it can be retried
                      setProcessedOffers(prev => {
                        const newSet = new Set(prev);
                        newSet.delete(offerId);
                        return newSet;
                      });
                    }
                  } else if (peer.connection.signalingState === 'have-local-offer') {
                    addLog(`⚠️ Already have local offer, ignoring offer from ${from}`, 'warning');
                  } else {
                    addLog(`❌ Ignoring offer from ${from} - wrong state: ${peer.connection.signalingState}`, 'warning');
                  }
                  break;

                case 'answer':
                  addLog(`📥 Processing answer from ${from}, current state: ${peer.connection.signalingState}`, 'info');
                  if (peer.connection.signalingState === 'have-local-offer') {
                    addLog(`✅ Have local offer, processing answer from ${from}`, 'info');
                    await peer.connection.setRemoteDescription(data);
                    addLog(`✅ Received answer from ${from}`, 'success');
                  } else if (peer.connection.signalingState === 'stable') {
                    addLog(`ℹ️ Answer from ${from} received but connection already established`, 'info');
                  } else {
                    addLog(`❌ Ignoring answer from ${from} - wrong state: ${peer.connection.signalingState}`, 'warning');
                  }
                  break;

                case 'ice-candidate':
                  if (peer.connection.remoteDescription) {
                    await peer.connection.addIceCandidate(data);
                    addLog(`Added ICE candidate from ${from}`, 'info');
                  } else {
                    addLog(`Ignoring ICE candidate from ${from} - no remote description`, 'warning');
                  }
                  break;
              }
            } catch (error) {
              addLog(`Error handling ${type} from ${from}: ${error}`, 'error');
            }
          })();

          return currentPeers;
        });
      });


    } catch (error) {
      addLog(`Error joining room: ${error}`, 'error');
    }
  };

  const leaveRoom = () => {
    if (socket) {
      socket.disconnect();
      setSocket(null);
    }

    // Close all peer connections
    peers.forEach(peer => {
      peer.connection.close();
    });
    setPeers(new Map());
    
    // Clear processed offers
    setProcessedOffers(new Set());

    // Stop local stream
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
      setLocalStream(null);
    }

    setIsConnected(false);
    addLog('Left room and closed all connections', 'info');
  };

  const toggleLocalVideo = () => {
    if (localStream) {
      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsLocalVideoEnabled(videoTrack.enabled);
        addLog(`Local video ${videoTrack.enabled ? 'enabled' : 'disabled'}`, 'info');
      }
    } else {
      addLog('No local video stream available', 'warning');
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 p-4">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold text-center mb-8">Video Conference</h1>
        
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Controls */}
          <div className="lg:col-span-1">
            <Controls
              roomName={roomName}
              setRoomName={setRoomName}
              signalingUrl={signalingUrl}
              setSignalingUrl={setSignalingUrl}
              isConnected={isConnected}
              isLocalVideoEnabled={isLocalVideoEnabled}
              onJoinRoom={joinRoom}
              onLeaveRoom={leaveRoom}
              onToggleLocalVideo={toggleLocalVideo}
            />
          </div>

          {/* Video Grid */}
          <div className="lg:col-span-3">
            <div className="bg-white rounded-lg shadow-lg p-4">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-semibold">Video Streams</h2>
                {isConnected && (
                  <div className={`px-3 py-1 rounded-full text-sm font-medium ${
                    isRoomCreator 
                      ? 'bg-blue-100 text-blue-800' 
                      : 'bg-green-100 text-green-800'
                  }`}>
                    {isRoomCreator ? '🏠 Room Creator' : '🚪 Room Joiner'}
                  </div>
                )}
              </div>
              
              {/* Responsive grid that shows all participants */}
              <div className={`grid gap-4 ${
                (peers.size + (localStream ? 1 : 0)) === 1 ? 'grid-cols-1' :
                (peers.size + (localStream ? 1 : 0)) === 2 ? 'grid-cols-1 md:grid-cols-2' :
                (peers.size + (localStream ? 1 : 0)) === 3 ? 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3' :
                'grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
              }`}>
                {/* Local video tile */}
                {localStream && (
                  <VideoTile
                    stream={localStream}
                    peerId="local"
                    isLocal={true}
                    isEnabled={isLocalVideoEnabled}
                  />
                )}
                
                {/* Remote peer tiles */}
                {Array.from(peers.values()).map(peer => {
                  console.log(`Rendering peer ${peer.id} with stream:`, peer.stream);
                  return (
                    <VideoTile
                      key={peer.id}
                      stream={peer.stream}
                      peerId={peer.id}
                      isLocal={false}
                      isEnabled={true}
                    />
                  );
                })}
              </div>
              
              {/* Show participant count */}
              <div className="mt-4 text-sm text-gray-600 text-center">
                {peers.size + (localStream ? 1 : 0)} participant{(peers.size + (localStream ? 1 : 0)) !== 1 ? 's' : ''} in room
              </div>
            </div>
          </div>
        </div>

        {/* Event Log */}
        <div className="mt-6">
          <EventLog logs={logs} />
        </div>

        {/* Mobile floating leave button */}
        {isConnected && (
          <div className="fixed bottom-4 right-4 lg:hidden z-50">
            <button
              onClick={leaveRoom}
              className="bg-red-600 text-white px-6 py-3 rounded-full shadow-lg hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 text-sm font-medium"
            >
              Leave Meeting
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
