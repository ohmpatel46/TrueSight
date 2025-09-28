import React, { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { Peer, MediaConnection } from 'peerjs';
import VideoTile from './components/VideoTile';
import Controls from './components/Controls';
import PhonePlaceholder from './components/PhonePlaceholder';
import MalpracticeAlerts from './components/MalpracticeAlerts';
import RoomSimulation from './components/RoomSimulation';

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
  const [myRole, setMyRole] = useState<'interviewer' | 'interviewee-laptop' | null>(null);
  const [phoneConnected, setPhoneConnected] = useState(false);
  const [latestPhoneFrame, setLatestPhoneFrame] = useState<string>('');

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

        // Handle role assignment from server
        newSocket.on('role-assigned', ({ role }: { role: 'interviewer' | 'interviewee-laptop' }) => {
          setMyRole(role);
          addLog(`🎭 Assigned role: ${role === 'interviewer' ? 'Interviewer' : 'Interviewee'}`, 'success');
        });

        // Handle room full rejection
        newSocket.on('room-full', () => {
          addLog(`❌ Room is full (max 2 participants + 1 phone)`, 'error');
          setIsConnected(false);
        });

        newSocket.on('connect_error', (e) => {
          addLog(`❌ Signaling connection error: ${e.message}`, 'error');
          setIsConnected(false);
        });

        newSocket.on('disconnect', (reason) => {
          addLog(`⚠️ Disconnected from signaling: ${reason}`, 'warning');
          setIsConnected(false);
        });

        // Handle phone connection/disconnection
        newSocket.on('phone-connected', ({ phoneId }: { phoneId: string }) => {
          setPhoneConnected(true);
          addLog(`📱 Phone connected: ${phoneId}`, 'success');
        });

        newSocket.on('phone-disconnected', ({ phoneId }: { phoneId: string }) => {
          setPhoneConnected(false);
          setLatestPhoneFrame('');
          addLog(`📱 Phone disconnected: ${phoneId}`, 'warning');
        });

        // Handle video frames from phone
        newSocket.on('video-frame', (data: any) => {
          if (data.data) {
            setLatestPhoneFrame(data.data);
            debugLog('Received phone frame', { size: data.data.length, from: data.from });
          }
        });

        // Handle existing peers in room
        newSocket.on('existing-peers', ({ peers }: { peers: Array<{ peerId: string; role: string }> }) => {
          addLog(`Found ${peers.length} existing peers`, 'info');
          debugLog('existing-peers payload', peers);

          // Call each existing peer
          peers.forEach(peerInfo => {
            if (peerInfo.peerId !== id) { // Don't call ourselves
              addLog(`📞 Calling existing peer: ${peerInfo.peerId} (${peerInfo.role})`, 'info');
              debugLog('Calling peer', peerInfo);
              
              const call = newPeer.call(peerInfo.peerId, stream || new MediaStream());
              
              updatePeers(prev => new Map(prev).set(peerInfo.peerId, { 
                id: peerInfo.peerId, 
                connection: call 
              }));

              call.on('stream', (remoteStream) => {
                addLog(`📺 Received stream from ${peerInfo.peerId}`, 'success');
                debugLog('Received stream from peer', {
                  peerId: peerInfo.peerId,
                  streamId: remoteStream.id,
                  tracks: remoteStream.getTracks().map(t => `${t.kind}:${t.readyState}`)
                });
                
                updatePeers(prev => {
                  const newPeers = new Map(prev);
                  const peer = newPeers.get(peerInfo.peerId);
                  if (peer) {
                    peer.stream = remoteStream;
                    newPeers.set(peerInfo.peerId, peer);
                  }
                  return newPeers;
                });
              });

              call.on('close', () => {
                addLog(`📞 Call with ${peerInfo.peerId} closed`, 'warning');
                updatePeers(prev => {
                  const newPeers = new Map(prev);
                  newPeers.delete(peerInfo.peerId);
                  return newPeers;
                });
              });

              call.on('error', (err) => {
                addLog(`❌ Call error with ${peerInfo.peerId}: ${err}`, 'error');
                debugLog('Call error', { peerId: peerInfo.peerId, error: err });
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
    setMyRole(null);
    setPhoneConnected(false);
    setLatestPhoneFrame('');
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
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-black p-4">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-5xl font-black text-center mb-8 text-cyan-400 tracking-widest animate-pulse drop-shadow-2xl">
          TRUESIGHT
        </h1>
        <p className="text-center text-cyan-300 text-sm tracking-[0.3em] mb-8 opacity-80">
          Anti-Cheating System
        </p>
        
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
            <div className="bg-gray-900 bg-opacity-90 border border-cyan-400 border-opacity-50 rounded-lg shadow-2xl shadow-cyan-400/20 p-6 backdrop-blur-sm">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold text-cyan-400 tracking-wider uppercase">
                  {myRole === 'interviewer' ? '🎯 SURVEILLANCE COMMAND' : 
                  myRole === 'interviewee-laptop' ? '📡 MONITORED SESSION' : 
                  'NEURAL STREAMS'}
                </h2>
                {isConnected && myPeerId && (
                  <div className="flex gap-2">
                    <div className="px-3 py-1 rounded border border-cyan-400 text-sm font-bold bg-cyan-400 bg-opacity-10 text-cyan-400 animate-pulse">
                      ID: {myPeerId.slice(0, 8)}...
                    </div>
                    {myRole && (
                      <div className={`px-3 py-1 rounded border text-sm font-bold ${
                        myRole === 'interviewer' 
                          ? 'border-green-400 bg-green-400 bg-opacity-10 text-green-400' 
                          : 'border-purple-400 bg-purple-400 bg-opacity-10 text-purple-400'
                      }`}>
                        {myRole === 'interviewer' ? 'COMMAND' : 'SUBJECT'}
                      </div>
                    )}
                  </div>
                )}
              </div>
              
              <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
                {/* Local Stream */}
                {localStream && (
                  <VideoTile 
                    stream={localStream} 
                    peerId="local" 
                    isLocal={true} 
                    isEnabled={isLocalVideoEnabled} 
                  />
                )}
                
                {/* Peer Streams */}
                {Array.from(peers.values()).map(peerInfo => {
                  debugLog(`Rendering peer ${peerInfo.id}, has stream:`, !!peerInfo.stream);
                  return (
                    <VideoTile 
                      key={peerInfo.id} 
                      stream={peerInfo.stream} 
                      peerId={peerInfo.id} 
                      isLocal={false} 
                      isEnabled={true} 
                    />
                  );
                })}
                
                {/* Phone Placeholder - Always show when connected to room */}
                {isConnected && (
                  <PhonePlaceholder 
                    isConnected={phoneConnected}
                    latestFrame={latestPhoneFrame}
                    role={myRole}
                  />
                )}
              </div>
              
              <div className="mt-4 text-sm text-cyan-300 text-center tracking-wider">
                {peers.size + (localStream ? 1 : 0)} participant{(peers.size + (localStream ? 1 : 0)) !== 1 ? 's' : ''} in room
              </div>
            </div>
          </div>
        </div>

        {/* Interviewer Dashboard - Malpractice Detection & Room Simulation */}
        {myRole === 'interviewer' && (
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <MalpracticeAlerts 
              socket={socket}
              role={myRole}
              latestPhoneFrame={latestPhoneFrame}
            />
            <RoomSimulation 
              isConnected={phoneConnected}
            />
          </div>
        )}

        {isConnected && (
          <div className="fixed bottom-4 right-4 lg:hidden z-50">
            <button
              onClick={leaveRoom}
              className="bg-red-600 bg-opacity-20 border border-red-400 text-red-400 px-6 py-3 rounded-full shadow-lg shadow-red-400/20 hover:bg-red-600 hover:bg-opacity-30 focus:outline-none focus:ring-2 focus:ring-red-400 text-sm font-bold tracking-wider animate-pulse"
            >
              TERMINATE
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;