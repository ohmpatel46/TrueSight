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
  const [depthData, setDepthData] = useState<any>(null);

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

  const analyzeDepth = async (frameData: string) => {
    if (!frameData) return;
    
    try {
      console.log('🏠 Analyzing depth data...');
      const response = await fetch('http://localhost:8000/analyze-depth', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          data: frameData,
          timestamp: Date.now(),
          room: roomName
        }),
      });

      if (response.ok) {
        const result = await response.json();
        console.log('🏠 Depth analysis result:', result);
        setDepthData(result);
      } else {
        console.error('❌ Depth analysis failed:', response.status);
      }
    } catch (error) {
      console.error('❌ Depth analysis error:', error);
    }
  };

  const updatePeers = (updater: (peers: Map<string, PeerInfo>) => Map<string, PeerInfo>) => {
    setPeers(prev => {
      const newPeers = updater(prev);
      addLog(`Peers updated: ${newPeers.size} peers total`, 'info');
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

    // Tab visibility detection for interviewee laptop
    const handleVisibilityChange = () => {
      if (myRole === 'interviewee-laptop' && socket && isConnected) {
        if (document.hidden) {
          // User switched away from tab
          console.log('🔄 Tab switch detected - user left interview tab');
          socket.emit('tab-switch-detected', { 
            type: 'away',
            timestamp: Date.now(),
            room: roomName
          });
        } else {
          // User returned to tab
          console.log('🔄 Tab switch detected - user returned to interview tab');
          socket.emit('tab-switch-detected', { 
            type: 'back',
            timestamp: Date.now(),
            room: roomName
          });
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [myRole, socket, isConnected, roomName]);

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
        addLog(`PeerJS connected with ID: ${id}`, 'success');
        setMyPeerId(id);
        debugLog('PeerJS peer opened', { id });

        // Connect to signaling server
        addLog(`Connecting to signaling: ${signalingUrl}`, 'info');
        const newSocket = io(signalingUrl);
        setSocket(newSocket);

        newSocket.on('connect', () => {
          addLog(`Connected to signaling (${signalingUrl}), socket=${newSocket.id}`, 'success');
          setIsConnected(true);
          newSocket.emit('join-room', { room: roomName, peerId: id });
          addLog(`Joining room: ${roomName}`, 'info');
        });

        // Handle role assignment from server
        newSocket.on('role-assigned', ({ role }: { role: 'interviewer' | 'interviewee-laptop' }) => {
          console.log('👤 [ROLE DEBUG] Role assigned by server:', {
            assignedRole: role,
            previousRole: myRole
          });
          setMyRole(role);
          addLog(`Assigned role: ${role === 'interviewer' ? 'Interviewer' : 'Interviewee'}`, 'success');
        });

        // Handle room full rejection
        newSocket.on('room-full', () => {
          addLog(`Room is full (max 2 participants + 1 phone)`, 'error');
          setIsConnected(false);
        });

        newSocket.on('connect_error', (e) => {
          addLog(`Signaling connection error: ${e.message}`, 'error');
          setIsConnected(false);
        });

        newSocket.on('disconnect', (reason) => {
          addLog(`Disconnected from signaling: ${reason}`, 'warning');
          setIsConnected(false);
        });

        // Handle phone connection/disconnection
        newSocket.on('phone-connected', ({ phoneId }: { phoneId: string }) => {
          setPhoneConnected(true);
          addLog(`Phone connected: ${phoneId}`, 'success');
        });

        newSocket.on('phone-disconnected', ({ phoneId }: { phoneId: string }) => {
          setPhoneConnected(false);
          setLatestPhoneFrame('');
          addLog(`Phone disconnected: ${phoneId}`, 'warning');
        });

        // Handle video frames from phone
        newSocket.on('video-frame', (data: any) => {
          if (data.data) {
            setLatestPhoneFrame(data.data);
            debugLog('Received phone frame', { size: data.data.length, from: data.from });
            
            // Analyze depth for room simulation (only for interviewer)
            if (myRole === 'interviewer') {
              analyzeDepth(data.data);
            }
          }
        });

        // Handle existing peers in room
        newSocket.on('existing-peers', ({ peers }: { peers: Array<{ peerId: string; role: string }> }) => {
          addLog(`Found ${peers.length} existing peers`, 'info');
          debugLog('existing-peers payload', peers);

          // Call each existing peer
          peers.forEach(peerInfo => {
            if (peerInfo.peerId !== id) { // Don't call ourselves
              addLog(`Calling existing peer: ${peerInfo.peerId} (${peerInfo.role})`, 'info');
              debugLog('Calling peer', peerInfo);
              
              const call = newPeer.call(peerInfo.peerId, stream || new MediaStream());
              
              updatePeers(prev => new Map(prev).set(peerInfo.peerId, { 
                id: peerInfo.peerId, 
                connection: call 
              }));

              call.on('stream', (remoteStream) => {
                addLog(`Received stream from ${peerInfo.peerId}`, 'success');
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
                addLog(`Call with ${peerInfo.peerId} closed`, 'warning');
                updatePeers(prev => {
                  const newPeers = new Map(prev);
                  newPeers.delete(peerInfo.peerId);
                  return newPeers;
                });
              });

              call.on('error', (err) => {
                addLog(`Call error with ${peerInfo.peerId}: ${err}`, 'error');
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
        addLog(`Incoming call from ${callerPeerId}`, 'info');
        debugLog('Incoming call', { from: callerPeerId });

        // Answer the call with our stream
        call.answer(stream || new MediaStream());
        
        updatePeers(prev => new Map(prev).set(callerPeerId, { 
          id: callerPeerId, 
          connection: call 
        }));

        call.on('stream', (remoteStream) => {
          addLog(`Received stream from ${callerPeerId}`, 'success');
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
          addLog(`Call with ${callerPeerId} closed`, 'warning');
          updatePeers(prev => {
            const newPeers = new Map(prev);
            newPeers.delete(callerPeerId);
            return newPeers;
          });
        });

        call.on('error', (err) => {
          addLog(`Call error with ${callerPeerId}: ${err}`, 'error');
          debugLog('Call error', { peerId: callerPeerId, error: err });
        });
      });

      newPeer.on('error', (err) => {
        addLog(`PeerJS error: ${err}`, 'error');
        debugLog('PeerJS error', err);
      });

      newPeer.on('disconnected', () => {
        addLog('PeerJS disconnected', 'warning');
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
    <div className="min-h-screen bg-slate-900 relative overflow-hidden">
      {/* Animated background grid */}
      <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-blue-900 to-indigo-900">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#0f172a_1px,transparent_1px),linear-gradient(to_bottom,#0f172a_1px,transparent_1px)] bg-[size:4rem_4rem] opacity-20"></div>
        <div className="absolute inset-0 bg-gradient-to-t from-slate-900/50 to-transparent"></div>
      </div>

      {/* Floating orbs */}
      <div className="absolute top-1/4 left-1/4 w-64 h-64 bg-blue-600/20 rounded-full blur-3xl animate-pulse"></div>
      <div className="absolute top-3/4 right-1/4 w-96 h-96 bg-indigo-600/10 rounded-full blur-3xl animate-pulse delay-1000"></div>

      <div className="relative z-10 p-6">
        <div className="max-w-7xl mx-auto">
          {/* Header */}
          <div className="text-center mb-12">
            <div className="inline-flex items-center justify-center space-x-4 mb-6">
              <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center shadow-2xl shadow-blue-500/25">
                <div className="w-6 h-6 bg-white rounded-sm"></div>
              </div>
              <h1 className="text-6xl font-black bg-gradient-to-r from-blue-400 via-blue-300 to-indigo-400 bg-clip-text text-transparent tracking-tight">
                CheatGPT 4o-4™
              </h1>
            </div>
            <p className="text-blue-300/80 text-lg font-medium tracking-wide">
              Advanced Interview Monitoring Platform
            </p>
            <div className="w-24 h-1 bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full mx-auto mt-4"></div>
          </div>
          
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
            {/* Controls */}
            <div className="lg:col-span-1">
              <div className="bg-slate-800/40 backdrop-blur-xl border border-slate-700/50 rounded-2xl p-6 shadow-2xl shadow-slate-900/50">
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
            </div>

            {/* Main Content */}
            <div className="lg:col-span-3">
              <div className="bg-slate-800/40 backdrop-blur-xl border border-slate-700/50 rounded-2xl p-8 shadow-2xl shadow-slate-900/50">
                {/* Header */}
                <div className="flex justify-between items-center mb-8">
                  <div className="flex items-center space-x-4">
                    <div className="w-3 h-3 bg-green-400 rounded-full animate-pulse shadow-lg shadow-green-400/50"></div>
                    <h2 className="text-2xl font-bold text-slate-100">
                      {myRole === 'interviewer' ? 'Interviewer Dashboard' : 
                      myRole === 'interviewee-laptop' ? 'Interview Session' : 
                      'Video Streams'}
                    </h2>
                  </div>
                  {isConnected && myPeerId && (
                    <div className="flex items-center space-x-3">
                      <div className="px-4 py-2 bg-blue-500/10 border border-blue-400/30 rounded-xl text-blue-300 text-sm font-semibold">
                        ID: {myPeerId.slice(0, 8)}
                      </div>
                      {myRole && (
                        <div className={`px-4 py-2 rounded-xl border text-sm font-semibold ${
                          myRole === 'interviewer' 
                            ? 'bg-emerald-500/10 border-emerald-400/30 text-emerald-300' 
                            : 'bg-purple-500/10 border-purple-400/30 text-purple-300'
                        }`}>
                          {myRole === 'interviewer' ? 'Interviewer' : 'Candidate'}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                
                {/* Video Grid */}
                <div className="grid gap-6 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
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
                  
                  {/* Phone Monitor */}
                  {isConnected && (
                    <PhonePlaceholder 
                      isConnected={phoneConnected}
                      latestFrame={latestPhoneFrame}
                      role={myRole}
                    />
                  )}
                </div>
                
                {/* Stats */}
                <div className="mt-8 pt-6 border-t border-slate-700/50">
                  <div className="flex justify-between items-center text-slate-400">
                    <span className="text-sm font-medium">
                      {peers.size + (localStream ? 1 : 0)} Active Participant{(peers.size + (localStream ? 1 : 0)) !== 1 ? 's' : ''}
                    </span>
                    {phoneConnected && (
                      <div className="flex items-center space-x-2">
                        <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                        <span className="text-sm font-medium text-green-400">Mobile Monitor Active</span>
                      </div>
                    )}
                  </div>
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
              {(() => {
                console.log('🏠 [APP DEBUG] Rendering RoomSimulation for interviewer', {
                  myRole,
                  phoneConnected,
                  depthData,
                  isConnected
                });
                return (
                  <RoomSimulation 
                    depthData={depthData}
                    isConnected={phoneConnected}
                    latestPhoneFrame={latestPhoneFrame}
                  />
                );
              })()}
            </div>
          )}

          {/* Mobile Controls */}
          {isConnected && (
            <div className="fixed bottom-6 right-6 lg:hidden z-50">
              <button
                onClick={leaveRoom}
                className="bg-red-600/20 backdrop-blur-xl border border-red-500/50 text-red-400 px-6 py-3 rounded-2xl shadow-2xl shadow-red-600/25 hover:bg-red-600/30 transition-all duration-300 text-sm font-semibold"
              >
                End Session
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;