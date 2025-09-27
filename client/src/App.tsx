import React, { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { Peer, MediaConnection } from 'peerjs';
import VideoTile from './components/VideoTile';
import Controls from './components/Controls';
import EventLog from './components/EventLog';

interface PeerInfo {
  id: string;
  connection?: MediaConnection;
  stream?: MediaStream;
}

interface LogEntry {
  timestamp: Date;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
}

const App: React.FC = () => {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [peer, setPeer] = useState<Peer | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [roomName, setRoomName] = useState('');
  const [signalingUrl, setSignalingUrl] = useState(() => {
    const hostname = window.location.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return 'http://localhost:3001';
    } else {
      return `http://${hostname}:3001`;
    }
  });

  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const [peers, setPeers] = useState<Map<string, PeerInfo>>(new Map());
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isLocalVideoEnabled, setIsLocalVideoEnabled] = useState(true);
  const [myPeerId, setMyPeerId] = useState<string>('');

  const DEBUG_ENABLED = true;

  const debugLog = (...args: unknown[]) => {
    if (DEBUG_ENABLED) {
      // eslint-disable-next-line no-console
      console.log('[DEBUG]', ...args);
    }
  };

  const addLog = (message: string, type: LogEntry['type'] = 'info') => {
    setLogs(prev => [...prev, { timestamp: new Date(), message, type }]);
    // eslint-disable-next-line no-console
    console.log(`[LOG] ${type.toUpperCase()}: ${message}`);
  };

  const updatePeers = (updater: (peers: Map<string, PeerInfo>) => Map<string, PeerInfo>) => {
    setPeers(prev => {
      const newPeers = updater(prev);
      addLog(`📊 Peers updated: ${newPeers.size} peers total`, 'info');
      debugLog('Peer snapshot', Array.from(newPeers.values()).map(p => ({
        id: p.id,
        hasStream: !!p.stream,
        hasConnection: !!p.connection
      })));
      return newPeers;
    });
  };

  // Initialize PeerJS
  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) {
      addLog('Warning: Camera/microphone not supported on this device', 'warning');
    }
  }, []);

  const joinRoom = async () => {
    if (!roomName.trim()) {
      addLog('Please enter a room name', 'error');
      return;
    }

    try {
      // Get local media stream
      let stream: MediaStream | null = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        setLocalStream(stream);
        localStreamRef.current = stream;
        addLog('Local media stream obtained', 'success');
        debugLog('Local media stream tracks', stream.getTracks().map(t => `${t.kind}:${t.readyState}`));
      } catch (err) {
        addLog(`No local camera/mic: joining as viewer (reason: ${(err as Error)?.message ?? err})`, 'warning');
      }

      // Create PeerJS peer with free TURN servers
      addLog('Creating PeerJS peer...', 'info');
      const newPeer = new Peer({
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { 
              urls: 'turn:0.peerjs.com:3478', 
              username: 'peerjs', 
              credential: 'peerjsp' 
            }
          ]
        },
        debug: DEBUG_ENABLED ? 2 : 0
      });

      setPeer(newPeer);

      newPeer.on('open', (id) => {
        addLog(`✅ PeerJS connected with ID: ${id}`, 'success');
        setMyPeerId(id);
        debugLog('PeerJS peer opened', { id });

        // Connect to signaling server
        addLog(`Connecting to signaling: ${signalingUrl}`, 'info');
        const newSocket = io(signalingUrl);
        setSocket(newSocket);

        newSocket.on('connect', () => {
          addLog(`✅ Connected to signaling (${signalingUrl}), socket=${newSocket.id}`, 'success');
          setIsConnected(true);
          newSocket.emit('join-room', { room: roomName, peerId: id });
          addLog(`Joining room: ${roomName}`, 'info');
        });

        newSocket.on('connect_error', (e) => {
          addLog(`❌ Signaling connection error: ${e.message}`, 'error');
          setIsConnected(false);
        });

        newSocket.on('disconnect', (reason) => {
          addLog(`⚠️ Disconnected from signaling: ${reason}`, 'warning');
          setIsConnected(false);
        });

        // Handle existing peers in room
        newSocket.on('existing-peers', ({ peers }: { peers: string[] }) => {
          addLog(`Found ${peers.length} existing peers`, 'info');
          debugLog('existing-peers payload', peers);

          // Call each existing peer
          peers.forEach(peerId => {
            if (peerId !== id) { // Don't call ourselves
              addLog(`📞 Calling existing peer: ${peerId}`, 'info');
              debugLog('Calling peer', peerId);
              
              const call = newPeer.call(peerId, stream || new MediaStream());
              
              updatePeers(prev => new Map(prev).set(peerId, { 
                id: peerId, 
                connection: call 
              }));

              call.on('stream', (remoteStream) => {
                addLog(`📺 Received stream from ${peerId}`, 'success');
                debugLog('Received stream from peer', {
                  peerId,
                  streamId: remoteStream.id,
                  tracks: remoteStream.getTracks().map(t => `${t.kind}:${t.readyState}`)
                });
                
                updatePeers(prev => {
                  const newPeers = new Map(prev);
                  const peerInfo = newPeers.get(peerId);
                  if (peerInfo) {
                    peerInfo.stream = remoteStream;
                    newPeers.set(peerId, peerInfo);
                  }
                  return newPeers;
                });
              });

              call.on('close', () => {
                addLog(`📞 Call with ${peerId} closed`, 'warning');
                updatePeers(prev => {
                  const newPeers = new Map(prev);
                  newPeers.delete(peerId);
                  return newPeers;
                });
              });

              call.on('error', (err) => {
                addLog(`❌ Call error with ${peerId}: ${err}`, 'error');
                debugLog('Call error', { peerId, error: err });
              });
            }
          });
        });

        // Handle new peer joining
        newSocket.on('peer-joined', ({ peerId }: { peerId: string }) => {
          addLog(`New peer joined: ${peerId}`, 'info');
          debugLog('peer-joined', peerId);
          
          // Don't call ourselves
          if (peerId === id) return;

          // Add to peers list (they will call us)
          updatePeers(prev => new Map(prev).set(peerId, { id: peerId }));
        });

        // Handle peer leaving
        newSocket.on('peer-left', ({ peerId }: { peerId: string }) => {
          addLog(`Peer left: ${peerId}`, 'warning');
          debugLog('peer-left', peerId);
          updatePeers(prev => {
            const newPeers = new Map(prev);
            const peerInfo = newPeers.get(peerId);
            if (peerInfo?.connection) {
              peerInfo.connection.close();
            }
            newPeers.delete(peerId);
            return newPeers;
          });
        });
      });

      // Handle incoming calls
      newPeer.on('call', (call) => {
        const callerPeerId = call.peer;
        addLog(`📞 Incoming call from ${callerPeerId}`, 'info');
        debugLog('Incoming call', { from: callerPeerId });

        // Answer the call with our stream
        call.answer(stream || new MediaStream());
        
        updatePeers(prev => new Map(prev).set(callerPeerId, { 
          id: callerPeerId, 
          connection: call 
        }));

        call.on('stream', (remoteStream) => {
          addLog(`📺 Received stream from ${callerPeerId}`, 'success');
          debugLog('Received stream from caller', {
            peerId: callerPeerId,
            streamId: remoteStream.id,
            tracks: remoteStream.getTracks().map(t => `${t.kind}:${t.readyState}`)
          });
          
          updatePeers(prev => {
            const newPeers = new Map(prev);
            const peerInfo = newPeers.get(callerPeerId);
            if (peerInfo) {
              peerInfo.stream = remoteStream;
              newPeers.set(callerPeerId, peerInfo);
            }
            return newPeers;
          });
        });

        call.on('close', () => {
          addLog(`📞 Call with ${callerPeerId} closed`, 'warning');
          updatePeers(prev => {
            const newPeers = new Map(prev);
            newPeers.delete(callerPeerId);
            return newPeers;
          });
        });

        call.on('error', (err) => {
          addLog(`❌ Call error with ${callerPeerId}: ${err}`, 'error');
          debugLog('Call error', { peerId: callerPeerId, error: err });
        });
      });

      newPeer.on('error', (err) => {
        addLog(`❌ PeerJS error: ${err}`, 'error');
        debugLog('PeerJS error', err);
      });

      newPeer.on('disconnected', () => {
        addLog('⚠️ PeerJS disconnected', 'warning');
      });

      newPeer.on('close', () => {
        addLog('PeerJS connection closed', 'info');
      });

    } catch (error) {
      addLog(`Error joining room: ${String(error)}`, 'error');
      debugLog('Join room error', error);
    }
  };

  const leaveRoom = () => {
    if (socket) {
      socket.disconnect();
      setSocket(null);
    }

    if (peer) {
      peer.destroy();
      setPeer(null);
    }

    // Close all peer connections
    peers.forEach(peerInfo => {
      if (peerInfo.connection) {
        peerInfo.connection.close();
      }
    });
    setPeers(new Map());

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
    }
    setLocalStream(null);

    setIsConnected(false);
    setMyPeerId('');
    addLog('Left room and closed all connections', 'info');
  };

  const toggleLocalVideo = () => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
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
        <h1 className="text-3xl font-bold text-center mb-8">TrueSight Video Conference</h1>
        
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
                {isConnected && myPeerId && (
                  <div className="px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-800">
                    🆔 {myPeerId.slice(0, 8)}...
                  </div>
                )}
              </div>
              
              <div
                className={`grid gap-4 ${
                  (peers.size + (localStream ? 1 : 0)) === 1
                    ? 'grid-cols-1'
                    : (peers.size + (localStream ? 1 : 0)) === 2
                    ? 'grid-cols-1 md:grid-cols-2'
                    : (peers.size + (localStream ? 1 : 0)) === 3
                    ? 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'
                    : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
                }`}
              >
                {localStream && (
                  <VideoTile stream={localStream} peerId="local" isLocal={true} isEnabled={isLocalVideoEnabled} />
                )}
                {Array.from(peers.values()).map(peerInfo => {
                  debugLog(`Rendering peer ${peerInfo.id}, has stream:`, !!peerInfo.stream);
                  return (
                    <VideoTile key={peerInfo.id} stream={peerInfo.stream} peerId={peerInfo.id} isLocal={false} isEnabled={true} />
                  );
                })}
              </div>
              
              <div className="mt-4 text-sm text-gray-600 text-center">
                {peers.size + (localStream ? 1 : 0)} participant{(peers.size + (localStream ? 1 : 0)) !== 1 ? 's' : ''} in room
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6">
          <EventLog logs={logs} />
        </div>

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