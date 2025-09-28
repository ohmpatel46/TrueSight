package com.truesight.android

import com.truesight.android.managers.ImageStreamManager
import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import android.util.Log
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.truesight.android.managers.SocketManager
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {

    private lateinit var socketManager: SocketManager
    private var currentRoom = ""
    private lateinit var imageStreamManager: ImageStreamManager


    // Permission launcher
    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        val allGranted = permissions.values.all { it }
        if (allGranted) {
            Toast.makeText(this, "Permissions granted! Ready to connect.", Toast.LENGTH_SHORT).show()
        } else {
            Toast.makeText(this, "Camera and audio permissions are required", Toast.LENGTH_LONG).show()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Initialize socket manager
        socketManager = SocketManager()
        imageStreamManager = ImageStreamManager(this, this)

        setContent {
            TrueSightApp()
        }

        // Check permissions
        checkPermissions()

        // Observe socket events
        observeSocketEvents()
    }

    private fun checkPermissions() {
        val requiredPermissions = arrayOf(
            Manifest.permission.CAMERA,
            Manifest.permission.RECORD_AUDIO
        )

        val missingPermissions = requiredPermissions.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }

        if (missingPermissions.isNotEmpty()) {
            permissionLauncher.launch(missingPermissions.toTypedArray())
        }
    }

    private fun observeSocketEvents() {
        // In observeSocketEvents method, update the existing peer handling:
        lifecycleScope.launch {
            socketManager.existingPeers.collect { peers ->
                if (peers.isNotEmpty()) {
                    Log.d("MainActivity", "Found existing peers: $peers")
                    Toast.makeText(this@MainActivity, "Found ${peers.size} existing peers", Toast.LENGTH_SHORT).show()
                }
            }
        }

        lifecycleScope.launch {
            // Observe new peers joining
            socketManager.peerJoined.collect { peerId ->
                peerId?.let {
                    Log.d("MainActivity", "New peer joined: $it")
                    Toast.makeText(this@MainActivity, "Peer joined: $it", Toast.LENGTH_SHORT).show()
                }
            }
        }

        lifecycleScope.launch {
            // Observe signaling messages
            socketManager.signalingMessage.collect { message ->
                message?.let {
                    Log.d("MainActivity", "Received signaling: ${it.type} from ${it.from}")
                    Toast.makeText(this@MainActivity, "Received ${it.type} from ${it.from}", Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    @Composable
    fun TrueSightApp() {
        var roomName by remember { mutableStateOf("ohm") }
        var serverUrl by remember { mutableStateOf("http://192.168.1.137:3001") } // Change this IP

        val isConnected by socketManager.isConnected.collectAsState()
        val connectionError by socketManager.connectionError.collectAsState()

        MaterialTheme {
            Surface(
                modifier = Modifier.fillMaxSize(),
                color = MaterialTheme.colorScheme.background
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(16.dp),
                    verticalArrangement = Arrangement.Center,
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {

                    // Title
                    Text(
                        text = "TrueSight Mobile",
                        fontSize = 32.sp,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.primary
                    )

                    Spacer(modifier = Modifier.height(32.dp))

                    // Status Card
                    StatusCard(
                        title = "Socket Connection",
                        status = when {
                            isConnected -> "Connected"
                            connectionError != null -> "Error: $connectionError"
                            else -> "Disconnected"
                        },
                        isGood = isConnected
                    )
                    // Add this after the existing status cards in MainActivity.kt
                    StatusCard(
                        title = "Room Status",
                        status = if (isConnected && currentRoom.isNotEmpty()) "Joined: $currentRoom" else "Not in room",
                        isGood = isConnected && currentRoom.isNotEmpty()
                    )

                    Spacer(modifier = Modifier.height(32.dp))

                    // Server URL Input
                    OutlinedTextField(
                        value = serverUrl,
                        onValueChange = { serverUrl = it },
                        label = { Text("Server URL") },
                        modifier = Modifier.fillMaxWidth(),
                        enabled = !isConnected
                    )

                    Spacer(modifier = Modifier.height(16.dp))

                    // Room Name Input
                    OutlinedTextField(
                        value = roomName,
                        onValueChange = { roomName = it },
                        label = { Text("Room Name") },
                        modifier = Modifier.fillMaxWidth(),
                        enabled = !isConnected
                    )

                    Spacer(modifier = Modifier.height(24.dp))

                    // Connect/Disconnect Button
                    Button(
                        onClick = {
                            if (isConnected) {
                                disconnect()
                            } else {
                                connect(serverUrl.trim(), roomName.trim())
                            }
                        },
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(56.dp),
                        enabled = roomName.isNotBlank() && serverUrl.isNotBlank(),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = if (isConnected)
                                MaterialTheme.colorScheme.error
                            else
                                MaterialTheme.colorScheme.primary
                        )
                    ) {
                        Text(
                            text = if (isConnected) "Disconnect" else "Connect to Room",
                            fontSize = 16.sp,
                            fontWeight = FontWeight.Medium
                        )
                    }

                    Spacer(modifier = Modifier.height(16.dp))

                    // Instructions
                    Card(
                        modifier = Modifier.fillMaxWidth(),
                        colors = CardDefaults.cardColors(
                            containerColor = MaterialTheme.colorScheme.surfaceVariant
                        )
                    ) {
                        Column(
                            modifier = Modifier.padding(16.dp)
                        ) {
                            Text(
                                text = "Instructions:",
                                fontWeight = FontWeight.Bold,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                            Spacer(modifier = Modifier.height(8.dp))
                            Text(
                                text = "1. Make sure your TrueSight server is running on port 3001\n" +
                                        "2. Update the server URL to your laptop's IP address\n" +
                                        "3. Enter the same room name as your web client\n" +
                                        "4. Tap Connect to join the room\n" +
                                        "5. Check the logs to see connection status",
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                fontSize = 14.sp
                            )
                        }
                    }
                }
            }
        }
    }

    @Composable
    fun StatusCard(title: String, status: String, isGood: Boolean) {
        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(
                containerColor = if (isGood)
                    Color(0xFF4CAF50).copy(alpha = 0.1f)
                else
                    Color(0xFFF44336).copy(alpha = 0.1f)
            )
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(16.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = title,
                    fontWeight = FontWeight.Medium
                )
                Text(
                    text = status,
                    color = if (isGood) Color(0xFF4CAF50) else Color(0xFFF44336),
                    fontWeight = FontWeight.Medium
                )
            }
        }
    }

    private fun startCameraStreaming() {
        imageStreamManager.startCamera(
            onSuccess = {
                Log.d("MainActivity", "Camera started successfully")
                Toast.makeText(this, "Camera ready", Toast.LENGTH_SHORT).show()

                // Set up frame capture callback
                imageStreamManager.onFrameCaptured = { base64Frame ->
                    if (currentRoom.isNotEmpty()) {
                        socketManager.sendVideoFrame(base64Frame, currentRoom)
                    }
                }

                // Start streaming at 2fps
                imageStreamManager.startStreaming(2)
            },
            onError = { exception ->
                Log.e("MainActivity", "Camera failed", exception)
                Toast.makeText(this, "Camera error: ${exception.message}", Toast.LENGTH_LONG).show()
            }
        )
    }

    private fun stopCameraStreaming() {
        imageStreamManager.stopStreaming()
    }
    private fun connect(serverUrl: String, roomName: String) {
        if (roomName.isBlank()) {
            Toast.makeText(this, "Please enter a room name", Toast.LENGTH_SHORT).show()
            return
        }

        currentRoom = roomName
        socketManager.connect(serverUrl)

        // Start camera when connecting
        startCameraStreaming()

        // Wait for connection then join room
        lifecycleScope.launch {
            socketManager.isConnected.collect { isConnected ->
                if (isConnected && currentRoom.isNotEmpty()) {
                    Log.d("MainActivity", "Connected! Joining room: $currentRoom")
                    socketManager.joinRoom(currentRoom)
                }
            }
        }
    }

    private fun disconnect() {
        Log.d("MainActivity", "Disconnecting...")
        stopCameraStreaming()
        socketManager.disconnect()
        currentRoom = ""
    }

    override fun onDestroy() {
        super.onDestroy()
        imageStreamManager.cleanup()
        socketManager.disconnect()
    }
}