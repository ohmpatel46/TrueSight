/*
package com.truesight.android.managers

import android.content.Context
import android.util.Log
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import org.webrtc.*
import org.webrtc.PeerConnection.IceServer
import org.webrtc.PeerConnection.RTCConfiguration


class WebRTCManager(private val context: Context) {

    private var peerConnectionFactory: PeerConnectionFactory? = null
    private var peerConnection: RTCPeerConnection? = null
    private var localVideoTrack: VideoTrack? = null
    private var localAudioTrack: AudioTrack? = null
    private var videoCapturer: CameraVideoCapturer? = null

    private val _isInitialized = MutableStateFlow(false)
    val isInitialized: StateFlow<Boolean> = _isInitialized

    private val _connectionState = MutableStateFlow<PeerConnection.PeerConnectionState?>(null)
    val connectionState: StateFlow<PeerConnection.PeerConnectionState?> = _connectionState

    // Callbacks for signaling
    var onIceCandidateGenerated: ((IceCandidate, String) -> Unit)? = null
    var onOfferCreated: ((SessionDescription, String) -> Unit)? = null
    var onAnswerCreated: ((SessionDescription, String) -> Unit)? = null

    private var currentRoomName: String = ""
    private var targetPeerId: String = ""

    fun initialize() {
        Log.d("WebRTCManager", "Initializing WebRTC")

        // Initialize PeerConnectionFactory
        val initializationOptions = PeerConnectionFactory.InitializationOptions.builder(context)
            .setEnableInternalTracer(false)
            .createInitializationOptions()

        PeerConnectionFactory.initialize(initializationOptions)

        val options = PeerConnectionFactory.Options()
        val encoderFactory = DefaultVideoEncoderFactory(
            EglBase.create().eglBaseContext,
            true,
            true
        )
        val decoderFactory = DefaultVideoDecoderFactory(EglBase.create().eglBaseContext)

        peerConnectionFactory = PeerConnectionFactory.builder()
            .setOptions(options)
            .setVideoEncoderFactory(encoderFactory)
            .setVideoDecoderFactory(decoderFactory)
            .createPeerConnectionFactory()

        _isInitialized.value = true
        Log.d("WebRTCManager", "WebRTC initialized successfully")
    }

    fun createPeerConnection(roomName: String, peerId: String) {
        currentRoomName = roomName
        targetPeerId = peerId

        val iceServers = listOf(
            PeerConnection.IceServer.builder("stun:stun.l.google.com:19302").createIceServer()
        )

        val rtcConfig = PeerConnection.RTCConfiguration(iceServers).apply {
            bundlePolicy = PeerConnection.BundlePolicy.MAXBUNDLE
            rtcpMuxPolicy = PeerConnection.RtcpMuxPolicy.REQUIRE
            tcpCandidatePolicy = PeerConnection.TcpCandidatePolicy.DISABLED
            candidateNetworkPolicy = PeerConnection.CandidateNetworkPolicy.ALL
        }

        val observer = object : PeerConnection.Observer {
            override fun onIceCandidate(candidate: IceCandidate) {
                Log.d("WebRTCManager", "ICE candidate generated")
                onIceCandidateGenerated?.invoke(candidate, targetPeerId)
            }

            override fun onConnectionChange(newState: PeerConnection.PeerConnectionState) {
                Log.d("WebRTCManager", "Connection state: $newState")
                _connectionState.value = newState
            }

            override fun onIceConnectionChange(newState: PeerConnection.IceConnectionState) {
                Log.d("WebRTCManager", "ICE connection state: $newState")
            }

            override fun onIceGatheringChange(newState: PeerConnection.IceGatheringState) {
                Log.d("WebRTCManager", "ICE gathering state: $newState")
            }

            override fun onSignalingChange(newState: PeerConnection.SignalingState) {
                Log.d("WebRTCManager", "Signaling state: $newState")
            }

            override fun onDataChannel(dataChannel: DataChannel) {
                Log.d("WebRTCManager", "Data channel received")
            }

            override fun onRenegotiationNeeded() {
                Log.d("WebRTCManager", "Renegotiation needed")
            }

            override fun onAddStream(stream: MediaStream) {
                Log.d("WebRTCManager", "Remote stream added")
            }

            override fun onRemoveStream(stream: MediaStream) {
                Log.d("WebRTCManager", "Remote stream removed")
            }

            override fun onAddTrack(receiver: RtpReceiver, streams: Array<MediaStream>) {
                Log.d("WebRTCManager", "Remote track added: ${receiver.track()?.kind()}")
            }

            override fun onIceCandidatesRemoved(candidates: Array<IceCandidate>) {
                Log.d("WebRTCManager", "ICE candidates removed")
            }
        }

        peerConnection = peerConnectionFactory?.createPeerConnection(rtcConfig, observer)
        Log.d("WebRTCManager", "Peer connection created")
    }

    fun startVideoCapture(): Boolean {
        return try {
            Log.d("WebRTCManager", "Starting video capture")

            // Create video capturer
            val cameraEnumerator = Camera2Enumerator(context)
            val deviceNames = cameraEnumerator.deviceNames

            val frontCameraName = deviceNames.find { cameraEnumerator.isFrontFacing(it) }
            val backCameraName = deviceNames.find { cameraEnumerator.isBackFacing(it) }

            val cameraName = frontCameraName ?: backCameraName
            if (cameraName == null) {
                Log.e("WebRTCManager", "No camera found")
                return false
            }

            videoCapturer = cameraEnumerator.createCapturer(cameraName, null) as? CameraVideoCapturer
            if (videoCapturer == null) {
                Log.e("WebRTCManager", "Failed to create camera capturer")
                return false
            }

            // Create video source and track
            val videoSource = peerConnectionFactory?.createVideoSource(videoCapturer?.isScreencast ?: false)
            localVideoTrack = peerConnectionFactory?.createVideoTrack("local_video", videoSource)

            // Create audio source and track
            val audioConstraints = MediaConstraints()
            val audioSource = peerConnectionFactory?.createAudioSource(audioConstraints)
            localAudioTrack = peerConnectionFactory?.createAudioTrack("local_audio", audioSource)

            // Add tracks to peer connection
            val stream = peerConnectionFactory?.createLocalMediaStream("local_stream")
            stream?.addTrack(localVideoTrack)
            stream?.addTrack(localAudioTrack)

            peerConnection?.addStream(stream)

            // Start capturing
            val surfaceTextureHelper = SurfaceTextureHelper.create("capture_thread", EglBase.create().eglBaseContext)
            videoCapturer?.initialize(surfaceTextureHelper, context, videoSource?.capturerObserver)
            videoCapturer?.startCapture(1280, 720, 30)

            Log.d("WebRTCManager", "Video capture started successfully")
            true
        } catch (e: Exception) {
            Log.e("WebRTCManager", "Error starting video capture", e)
            false
        }
    }

    fun createOffer() {
        Log.d("WebRTCManager", "Creating offer")
        val constraints = MediaConstraints().apply {
            mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveVideo", "false"))
            mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveAudio", "false"))
        }

        peerConnection?.createOffer(object : SdpObserver {
            override fun onCreateSuccess(sessionDescription: SessionDescription) {
                Log.d("WebRTCManager", "Offer created successfully")
                peerConnection?.setLocalDescription(object : SdpObserver {
                    override fun onSetSuccess() {
                        Log.d("WebRTCManager", "Local description set")
                        onOfferCreated?.invoke(sessionDescription, targetPeerId)
                    }
                    override fun onSetFailure(error: String) {
                        Log.e("WebRTCManager", "Failed to set local description: $error")
                    }
                    override fun onCreateSuccess(p0: SessionDescription?) {}
                    override fun onCreateFailure(p0: String?) {}
                }, sessionDescription)
            }

            override fun onCreateFailure(error: String) {
                Log.e("WebRTCManager", "Failed to create offer: $error")
            }

            override fun onSetSuccess() {}
            override fun onSetFailure(error: String?) {}
        }, constraints)
    }

    fun createAnswer() {
        Log.d("WebRTCManager", "Creating answer")
        val constraints = MediaConstraints()

        peerConnection?.createAnswer(object : SdpObserver {
            override fun onCreateSuccess(sessionDescription: SessionDescription) {
                Log.d("WebRTCManager", "Answer created successfully")
                peerConnection?.setLocalDescription(object : SdpObserver {
                    override fun onSetSuccess() {
                        Log.d("WebRTCManager", "Local description set")
                        onAnswerCreated?.invoke(sessionDescription, targetPeerId)
                    }
                    override fun onSetFailure(error: String) {
                        Log.e("WebRTCManager", "Failed to set local description: $error")
                    }
                    override fun onCreateSuccess(p0: SessionDescription?) {}
                    override fun onCreateFailure(p0: String?) {}
                }, sessionDescription)
            }

            override fun onCreateFailure(error: String) {
                Log.e("WebRTCManager", "Failed to create answer: $error")
            }

            override fun onSetSuccess() {}
            override fun onSetFailure(error: String?) {}
        }, constraints)
    }

    fun setRemoteDescription(sessionDescription: SessionDescription) {
        Log.d("WebRTCManager", "Setting remote description")
        peerConnection?.setRemoteDescription(object : SdpObserver {
            override fun onSetSuccess() {
                Log.d("WebRTCManager", "Remote description set successfully")
            }

            override fun onSetFailure(error: String) {
                Log.e("WebRTCManager", "Failed to set remote description: $error")
            }

            override fun onCreateSuccess(p0: SessionDescription?) {}
            override fun onCreateFailure(p0: String?) {}
        }, sessionDescription)
    }

    fun addIceCandidate(iceCandidate: IceCandidate) {
        Log.d("WebRTCManager", "Adding ICE candidate")
        peerConnection?.addIceCandidate(iceCandidate)
    }

    fun cleanup() {
        Log.d("WebRTCManager", "Cleaning up WebRTC resources")

        videoCapturer?.stopCapture()
        videoCapturer?.dispose()
        videoCapturer = null

        localVideoTrack?.dispose()
        localVideoTrack = null

        localAudioTrack?.dispose()
        localAudioTrack = null

        peerConnection?.close()
        peerConnection = null

        peerConnectionFactory?.dispose()
        peerConnectionFactory = null

        _isInitialized.value = false
    }
}*/
