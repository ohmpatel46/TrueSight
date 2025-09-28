package com.truesight.android.managers

import org.json.JSONObject
import android.util.Log
import com.google.gson.Gson
import com.truesight.android.models.*
import io.socket.client.IO
import io.socket.client.Socket
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import java.net.URISyntaxException

class SocketManager {
    private var socket: Socket? = null
    private val gson = Gson()

    private val _isConnected = MutableStateFlow(false)
    val isConnected: StateFlow<Boolean> = _isConnected

    private val _connectionError = MutableStateFlow<String?>(null)
    val connectionError: StateFlow<String?> = _connectionError

    // Event flows
    private val _existingPeers = MutableStateFlow<List<String>>(emptyList())
    val existingPeers: StateFlow<List<String>> = _existingPeers

    private val _peerJoined = MutableStateFlow<String?>(null)
    val peerJoined: StateFlow<String?> = _peerJoined

    private val _peerLeft = MutableStateFlow<String?>(null)
    val peerLeft: StateFlow<String?> = _peerLeft

    private val _signalingMessage = MutableStateFlow<SignalingMessage?>(null)
    val signalingMessage: StateFlow<SignalingMessage?> = _signalingMessage

    fun connect(serverUrl: String) {
        try {
            Log.d("SocketManager", "Attempting to connect to: $serverUrl")

            val options = IO.Options().apply {
                transports = arrayOf("polling") // Force HTTP polling only
                timeout = 20000
                reconnection = true
                reconnectionDelay = 1000
                reconnectionAttempts = 5
                forceNew = true
            }

            socket = IO.socket(serverUrl, options)
            Log.d("SocketManager", "Socket.IO client version: ${io.socket.client.Socket::class.java.`package`?.implementationVersion}")
            Log.d("SocketManager", "Attempting connection with options: polling=${options.transports.contains("polling")}, websocket=${options.transports.contains("websocket")}")

            socket?.apply {
                on(Socket.EVENT_CONNECT) {
                    Log.d("SocketManager", "Connected to signaling server")
                    _isConnected.value = true
                    _connectionError.value = null
                }

                on(Socket.EVENT_DISCONNECT) { args ->
                    val reason = args.getOrNull(0)?.toString() ?: "Unknown"
                    Log.d("SocketManager", "Disconnected: $reason")
                    _isConnected.value = false
                }

                on(Socket.EVENT_CONNECT_ERROR) { args ->
                    val error = args.getOrNull(0)?.toString() ?: "Connection failed"
                    Log.e("SocketManager", "Connection error: $error")
                    _connectionError.value = error
                    _isConnected.value = false
                }

                on("existing-peers") { args ->
                    try {
                        val data = args[0].toString()
                        val response = gson.fromJson(data, ExistingPeersResponse::class.java)
                        Log.d("SocketManager", "Existing peers: ${response.peers}")
                        _existingPeers.value = response.peers
                    } catch (e: Exception) {
                        Log.e("SocketManager", "Error parsing existing-peers", e)
                    }
                }

                on("peer-joined") { args ->
                    try {
                        val data = args[0].toString()
                        val response = gson.fromJson(data, PeerJoinedResponse::class.java)
                        Log.d("SocketManager", "Peer joined: ${response.peerId}")
                        _peerJoined.value = response.peerId
                    } catch (e: Exception) {
                        Log.e("SocketManager", "Error parsing peer-joined", e)
                    }
                }

                on("peer-left") { args ->
                    try {
                        val data = args[0].toString()
                        val response = gson.fromJson(data, PeerLeftResponse::class.java)
                        Log.d("SocketManager", "Peer left: ${response.peerId}")
                        _peerLeft.value = response.peerId
                    } catch (e: Exception) {
                        Log.e("SocketManager", "Error parsing peer-left", e)
                    }
                }

                on("signaling") { args ->
                    try {
                        val data = args[0].toString()
                        val message = gson.fromJson(data, SignalingMessage::class.java)
                        Log.d("SocketManager", "Received signaling: ${message.type} from ${message.from}")
                        _signalingMessage.value = message
                    } catch (e: Exception) {
                        Log.e("SocketManager", "Error parsing signaling message", e)
                    }
                }

                connect()
            }

        } catch (e: URISyntaxException) {
            Log.e("SocketManager", "Invalid server URL", e)
            _connectionError.value = "Invalid server URL: $serverUrl"
        }
    }

    fun joinRoom(roomName: String) {
        socket?.let { socket ->
            if (socket.connected()) {
                Log.d("SocketManager", "Joining room: $roomName")
                Log.d("SocketManager", "Socket ID: ${socket.id()}")

                // Generate a fake peerId for now
                val peerId = "android-${socket.id()}"

                // Try different approaches to see what works
                val roomData = JSONObject().apply {
                    put("room", roomName)
                    put("peerId", peerId)
                }

                Log.d("SocketManager", "Sending join-room with JSONObject: $roomData")
                socket.emit("join-room", roomData)
            } else {
                Log.e("SocketManager", "Cannot join room - not connected")
            }
        }
    }

    // Simplified signaling without WebRTC types
    fun sendMessage(type: String, data: String, roomName: String, targetPeerId: String? = null) {
        socket?.let { socket ->
            if (socket.connected()) {
                val message = SignalingMessage(
                    type = type,
                    room = roomName,
                    from = socket.id(),
                    to = targetPeerId,
                    data = data
                )

                Log.d("SocketManager", "Sending $type to ${targetPeerId ?: "room"}")
                socket.emit("signaling", gson.toJson(message))
            } else {
                Log.e("SocketManager", "Cannot send signaling message - not connected")
            }
        }
    }

    fun sendVideoFrame(frameData: String, roomName: String) {
        socket?.let { socket ->
            if (socket.connected()) {
                val message = JSONObject().apply {
                    put("type", "video-frame")
                    put("room", roomName)
                    put("from", socket.id())
                    put("data", frameData)
                    put("timestamp", System.currentTimeMillis())
                }

                socket.emit("video-frame", message)
                Log.d("SocketManager", "Sent video frame as JSONObject (${frameData.length} chars)")
            }
        }
    }
    fun disconnect() {
        socket?.apply {
            disconnect()
            off()
        }
        socket = null
        _isConnected.value = false
        _connectionError.value = null
    }

    fun getSocketId(): String? = socket?.id()
}