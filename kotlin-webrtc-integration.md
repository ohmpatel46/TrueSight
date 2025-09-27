# Kotlin WebRTC Integration Guide

## Architecture Overview

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Kotlin App    │    │  Signaling      │    │   Web Client    │
│   (Android)     │    │   Server        │    │   (PeerJS)      │
│                 │    │                 │    │                 │
│  Native WebRTC  │◄──►│  Socket.io      │◄──►│    PeerJS       │
│                 │    │                 │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## Implementation Steps

### 1. Add WebRTC Dependencies

```kotlin
// app/build.gradle
dependencies {
    implementation 'org.webrtc:google-webrtc:1.0.32006'
    implementation 'io.socket:socket.io-client:2.0.0'
    implementation 'com.google.code.gson:gson:2.8.9'
}
```

### 2. WebRTC Manager Class

```kotlin
class WebRTCManager(private val context: Context) {
    private var peerConnectionFactory: PeerConnectionFactory? = null
    private var localPeer: PeerConnection? = null
    private var localVideoTrack: VideoTrack? = null
    private var localAudioTrack: AudioTrack? = null
    private var socket: Socket? = null
    
    companion object {
        private const val SIGNALING_URL = "http://10.29.154.225:3001"
    }
    
    fun initialize() {
        initializeWebRTC()
        connectToSignalingServer()
    }
    
    private fun initializeWebRTC() {
        val initOptions = PeerConnectionFactory.InitializationOptions.builder(context)
            .setEnableInternalTracer(true)
            .createInitializationOptions()
        PeerConnectionFactory.initialize(initOptions)
        
        val options = PeerConnectionFactory.Options()
        peerConnectionFactory = PeerConnectionFactory.builder()
            .setOptions(options)
            .createPeerConnectionFactory()
    }
    
    private fun connectToSignalingServer() {
        try {
            socket = IO.socket(SIGNALING_URL)
            
            socket?.on(Socket.EVENT_CONNECT) {
                Log.d("WebRTC", "Connected to signaling server")
                joinRoom("your-room-name")
            }
            
            socket?.on("existing-peers") { args ->
                val data = args[0] as JSONObject
                val peers = data.getJSONArray("peers")
                for (i in 0 until peers.length()) {
                    val peerId = peers.getString(i)
                    createOfferToPeer(peerId)
                }
            }
            
            socket?.on("peer-joined") { args ->
                val data = args[0] as JSONObject
                val peerId = data.getString("peerId")
                // Wait for offer from this peer
            }
            
            socket?.on("webrtc-offer") { args ->
                val data = args[0] as JSONObject
                handleOffer(data)
            }
            
            socket?.on("webrtc-answer") { args ->
                val data = args[0] as JSONObject
                handleAnswer(data)
            }
            
            socket?.on("webrtc-ice") { args ->
                val data = args[0] as JSONObject
                handleIceCandidate(data)
            }
            
            socket?.connect()
        } catch (e: Exception) {
            Log.e("WebRTC", "Failed to connect to signaling server", e)
        }
    }
    
    private fun joinRoom(roomName: String) {
        val data = JSONObject().apply {
            put("room", roomName)
            put("peerId", "android-${System.currentTimeMillis()}")
        }
        socket?.emit("join-room", data)
    }
    
    private fun createPeerConnection(peerId: String): PeerConnection? {
        val iceServers = listOf(
            PeerConnection.IceServer.builder("stun:stun.l.google.com:19302").createIceServer(),
            PeerConnection.IceServer.builder("turn:0.peerjs.com:3478")
                .setUsername("peerjs")
                .setPassword("peerjsp")
                .createIceServer()
        )
        
        val rtcConfig = PeerConnection.RTCConfiguration(iceServers).apply {
            tcpCandidatePolicy = PeerConnection.TcpCandidatePolicy.DISABLED
            bundlePolicy = PeerConnection.BundlePolicy.MAXBUNDLE
            rtcpMuxPolicy = PeerConnection.RtcpMuxPolicy.REQUIRE
            continualGatheringPolicy = PeerConnection.ContinualGatheringPolicy.GATHER_CONTINUALLY
        }
        
        val observer = object : PeerConnection.Observer {
            override fun onIceCandidate(candidate: IceCandidate?) {
                candidate?.let { sendIceCandidate(peerId, it) }
            }
            
            override fun onAddStream(stream: MediaStream?) {
                stream?.let { handleRemoteStream(peerId, it) }
            }
            
            override fun onConnectionChange(newState: PeerConnection.PeerConnectionState?) {
                Log.d("WebRTC", "Connection state: $newState")
            }
            
            // ... other observer methods
        }
        
        return peerConnectionFactory?.createPeerConnection(rtcConfig, observer)
    }
    
    fun startCamera(surfaceView: SurfaceViewRenderer) {
        val videoCapturer = createCameraCapturer()
        val videoSource = peerConnectionFactory?.createVideoSource(false)
        
        videoCapturer?.initialize(
            SurfaceTextureHelper.create("CaptureThread", EglBase.create().eglBaseContext),
            context,
            videoSource?.capturerObserver
        )
        
        localVideoTrack = peerConnectionFactory?.createVideoTrack("local_video", videoSource)
        localVideoTrack?.addSink(surfaceView)
        
        // Audio
        val audioConstraints = MediaConstraints()
        val audioSource = peerConnectionFactory?.createAudioSource(audioConstraints)
        localAudioTrack = peerConnectionFactory?.createAudioTrack("local_audio", audioSource)
        
        videoCapturer?.startCapture(1280, 720, 30)
    }
    
    private fun createCameraCapturer(): CameraVideoCapturer? {
        val enumerator = Camera2Enumerator(context)
        return enumerator.deviceNames.firstOrNull { enumerator.isFrontFacing(it) }
            ?.let { enumerator.createCapturer(it, null) }
    }
    
    private fun createOfferToPeer(peerId: String) {
        val peerConnection = createPeerConnection(peerId) ?: return
        
        // Add local tracks
        localVideoTrack?.let { peerConnection.addTrack(it, listOf("local_stream")) }
        localAudioTrack?.let { peerConnection.addTrack(it, listOf("local_stream")) }
        
        val constraints = MediaConstraints().apply {
            mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveVideo", "true"))
            mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveAudio", "true"))
        }
        
        peerConnection.createOffer(object : SdpObserver {
            override fun onCreateSuccess(sessionDescription: SessionDescription?) {
                sessionDescription?.let {
                    peerConnection.setLocalDescription(object : SdpObserver {
                        override fun onSetSuccess() {
                            sendOffer(peerId, it)
                        }
                        override fun onSetFailure(error: String?) {}
                        override fun onCreateSuccess(p0: SessionDescription?) {}
                        override fun onCreateFailure(p0: String?) {}
                    }, it)
                }
            }
            override fun onCreateFailure(error: String?) {}
            override fun onSetSuccess() {}
            override fun onSetFailure(error: String?) {}
        }, constraints)
    }
    
    private fun sendOffer(peerId: String, offer: SessionDescription) {
        val data = JSONObject().apply {
            put("to", peerId)
            put("from", "android-${System.currentTimeMillis()}")
            put("type", offer.type.canonicalForm())
            put("sdp", offer.description)
        }
        socket?.emit("webrtc-offer", data)
    }
    
    private fun sendAnswer(peerId: String, answer: SessionDescription) {
        val data = JSONObject().apply {
            put("to", peerId)
            put("from", "android-${System.currentTimeMillis()}")
            put("type", answer.type.canonicalForm())
            put("sdp", answer.description)
        }
        socket?.emit("webrtc-answer", data)
    }
    
    private fun sendIceCandidate(peerId: String, candidate: IceCandidate) {
        val data = JSONObject().apply {
            put("to", peerId)
            put("from", "android-${System.currentTimeMillis()}")
            put("candidate", candidate.sdp)
            put("sdpMLineIndex", candidate.sdpMLineIndex)
            put("sdpMid", candidate.sdpMid)
        }
        socket?.emit("webrtc-ice", data)
    }
    
    private fun handleRemoteStream(peerId: String, stream: MediaStream) {
        // Display remote video stream
        stream.videoTracks.firstOrNull()?.let { videoTrack ->
            // Add to your remote video view
            Log.d("WebRTC", "Received video stream from $peerId")
        }
    }
}
```

### 3. Update Server for Mixed Clients

```typescript
// Add to server/src/index.ts
socket.on('webrtc-offer', (data: any) => {
  const { to, from, type, sdp } = data;
  io.to(to).emit('webrtc-offer', { from, type, sdp });
});

socket.on('webrtc-answer', (data: any) => {
  const { to, from, type, sdp } = data;
  io.to(to).emit('webrtc-answer', { from, type, sdp });
});

socket.on('webrtc-ice', (data: any) => {
  const { to, from, candidate, sdpMLineIndex, sdpMid } = data;
  io.to(to).emit('webrtc-ice', { from, candidate, sdpMLineIndex, sdpMid });
});
```

### 4. Activity Implementation

```kotlin
class MainActivity : AppCompatActivity() {
    private lateinit var webRTCManager: WebRTCManager
    private lateinit var localSurfaceView: SurfaceViewRenderer
    private lateinit var remoteSurfaceView: SurfaceViewRenderer
    
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        
        localSurfaceView = findViewById(R.id.local_surface_view)
        remoteSurfaceView = findViewById(R.id.remote_surface_view)
        
        // Initialize surface views
        localSurfaceView.init(EglBase.create().eglBaseContext, null)
        remoteSurfaceView.init(EglBase.create().eglBaseContext, null)
        
        webRTCManager = WebRTCManager(this)
        webRTCManager.initialize()
        
        // Request camera permissions
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) 
            != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, 
                arrayOf(Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO), 
                100)
        } else {
            webRTCManager.startCamera(localSurfaceView)
        }
    }
}
```

## Benefits of This Approach

1. **Native Performance**: Better than WebView for video processing
2. **Full Control**: Access to all WebRTC features
3. **Cross-Platform**: Works with your existing PeerJS web clients
4. **Production Ready**: Uses Google's official WebRTC library

## Next Steps

1. Implement the WebRTC manager
2. Update your server to handle both PeerJS and native clients
3. Test cross-platform video calls (Android ↔ Web)
