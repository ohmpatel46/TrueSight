@file:OptIn(ExperimentalAnimationApi::class)


package com.truesight.android

import androidx.compose.ui.graphics.graphicsLayer
import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import android.util.Log
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.animation.ExperimentalAnimationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.truesight.android.managers.ImageStreamManager
import com.truesight.android.managers.SocketManager
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {

    private lateinit var socketManager: SocketManager
    private lateinit var imageStreamManager: ImageStreamManager

    private var currentRoom = ""
    private var isStreaming = false

    // Permission launcher
    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        val allGranted = permissions.values.all { it }
        if (allGranted) {
            initializeCamera()
        } else {
            Toast.makeText(this, "Camera and audio permissions are required", Toast.LENGTH_LONG).show()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Initialize managers
        socketManager = SocketManager()
        imageStreamManager = ImageStreamManager(this, this)

        setContent {
            TrueSightApp()
        }

        // Check permissions
        checkPermissions()

        // Set up streaming callback
        setupStreamingCallbacks()

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
        } else {
            initializeCamera()
        }
    }

    private fun initializeCamera() {
        imageStreamManager.startCamera(
            useBackCamera = true, // Always use back camera
            onSuccess = {
                Log.d("MainActivity", "Camera initialized successfully")
                Toast.makeText(this, "Camera ready", Toast.LENGTH_SHORT).show()
            },
            onError = { exception ->
                Log.e("MainActivity", "Camera failed", exception)
                Toast.makeText(this, "Camera error: ${exception.message}", Toast.LENGTH_LONG).show()
            }
        )
    }

    private fun setupStreamingCallbacks() {
        imageStreamManager.onFrameCaptured = { base64Frame ->
            if (currentRoom.isNotEmpty() && isStreaming) {
                socketManager.sendVideoFrame(base64Frame, currentRoom)
                Log.d("MainActivity", "Frame sent (${base64Frame.length} chars)")
            }
        }
    }

    private fun observeSocketEvents() {
        lifecycleScope.launch {
            socketManager.existingPeers.collect { peers ->
                if (peers.isNotEmpty()) {
                    Log.d("MainActivity", "Found existing peers: $peers")
                    Toast.makeText(this@MainActivity, "Found ${peers.size} existing peers", Toast.LENGTH_SHORT).show()
                }
            }
        }

        lifecycleScope.launch {
            socketManager.peerJoined.collect { peerId ->
                peerId?.let {
                    Log.d("MainActivity", "New peer joined: $it")
                    Toast.makeText(this@MainActivity, "Peer joined: $it", Toast.LENGTH_SHORT).show()
                }
            }
        }

        lifecycleScope.launch {
            socketManager.signalingMessage.collect { message ->
                message?.let {
                    Log.d("MainActivity", "Received signaling: ${it.type} from ${it.from}")
                }
            }
        }
    }

    @Composable
    fun TrueSightApp() {
        var roomName by remember { mutableStateOf("") }
        var serverUrl by remember { mutableStateOf("http://10.29.154.225:3001") }

        val isConnected by socketManager.isConnected.collectAsState()
        val connectionError by socketManager.connectionError.collectAsState()

        // Dark cybersecurity theme
        val darkBackground = Color(0xFF0A0A0A)
        val primaryCyan = Color(0xFF00FFFF)
        val secondaryPurple = Color(0xFF9C27B0)
        val errorRed = Color(0xFFFF3366)
        val successGreen = Color(0xFF00FF88)

        Surface(
            modifier = Modifier.fillMaxSize(),
            color = darkBackground
        ) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(
                        Brush.radialGradient(
                            colors = listOf(
                                Color(0xFF1A1A2E),
                                Color(0xFF16213E),
                                Color(0xFF0F0F23)
                            )
                        )
                    )
            ) {
                AnimatedContent(
                    targetState = isConnected && currentRoom.isNotEmpty(),
                    transitionSpec = {
                        slideInHorizontally(
                            initialOffsetX = { it },
                            animationSpec = tween(800, easing = FastOutSlowInEasing)
                        ) + fadeIn() with slideOutHorizontally(
                            targetOffsetX = { -it },
                            animationSpec = tween(800, easing = FastOutSlowInEasing)
                        ) + fadeOut()
                    }
                ) { showMonitoring ->
                    if (showMonitoring) {
                        StreamingInterface(
                            roomName = currentRoom,
                            primaryColor = primaryCyan,
                            errorColor = errorRed,
                            onDisconnect = { disconnect() }
                        )
                    } else {
                        ConnectionInterface(
                            roomName = roomName,
                            serverUrl = serverUrl,
                            isConnected = isConnected,
                            connectionError = connectionError,
                            primaryColor = primaryCyan,
                            errorColor = errorRed,
                            onRoomNameChange = { roomName = it },
                            onServerUrlChange = { serverUrl = it },
                            onConnect = { connect(serverUrl.trim(), roomName.trim()) }
                        )
                    }
                }
            }
        }
    }

    @Composable
    fun ConnectionInterface(
        roomName: String,
        serverUrl: String,
        isConnected: Boolean,
        connectionError: String?,
        primaryColor: Color,
        errorColor: Color,
        onRoomNameChange: (String) -> Unit,
        onServerUrlChange: (String) -> Unit,
        onConnect: () -> Unit
    ) {
        val infiniteTransition = rememberInfiniteTransition()

        val glowAnimation by infiniteTransition.animateFloat(
            initialValue = 0.3f,
            targetValue = 1f,
            animationSpec = infiniteRepeatable(
                animation = tween(2000, easing = LinearEasing),
                repeatMode = RepeatMode.Reverse
            )
        )

        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(24.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally
        ) {

            // Animated title
            Text(
                text = "CheatGPT 4o-4™",
                fontSize = 36.sp,
                fontWeight = FontWeight.Black,
                color = primaryColor,
                letterSpacing = 4.sp,
                modifier = Modifier
                    .shadow(
                        elevation = 20.dp,
                        shape = RoundedCornerShape(8.dp),
                        spotColor = primaryColor.copy(alpha = glowAnimation)
                    )
            )

            Text(
                text = "ANTI-CHEAT SURVEILLANCE",
                fontSize = 14.sp,
                fontWeight = FontWeight.Medium,
                color = primaryColor.copy(alpha = 0.8f),
                letterSpacing = 2.sp,
                modifier = Modifier.padding(top = 8.dp)
            )

            Spacer(modifier = Modifier.height(48.dp))

            // Animated status indicator
            AnimatedStatusCard(
                title = "SYSTEM STATUS",
                status = when {
                    isConnected -> "CONNECTED"
                    connectionError != null -> "ERROR: ${connectionError.uppercase()}"
                    else -> "DISCONNECTED"
                },
                isGood = isConnected,
                primaryColor = primaryColor,
                errorColor = errorColor
            )

            Spacer(modifier = Modifier.height(40.dp))

            // Futuristic input fields
            CyberTextField(
                value = serverUrl,
                onValueChange = onServerUrlChange,
                label = "SERVER ENDPOINT",
                enabled = !isConnected,
                primaryColor = primaryColor
            )

            Spacer(modifier = Modifier.height(20.dp))

            CyberTextField(
                value = roomName,
                onValueChange = onRoomNameChange,
                label = "ROOM IDENTIFIER",
                enabled = !isConnected,
                primaryColor = primaryColor
            )

            Spacer(modifier = Modifier.height(40.dp))

            // Animated connect button
            AnimatedConnectButton(
                onClick = onConnect,
                enabled = roomName.isNotBlank() && serverUrl.isNotBlank() && !isConnected,
                isConnected = isConnected,
                primaryColor = primaryColor
            )

            Spacer(modifier = Modifier.height(32.dp))

            // Info panel
            CyberInfoPanel(primaryColor = primaryColor)
        }
    }

    @Composable
    fun StreamingInterface(
        roomName: String,
        primaryColor: Color,
        errorColor: Color,
        onDisconnect: () -> Unit
    ) {
        val infiniteTransition = rememberInfiniteTransition()

        val scanlineAnimation by infiniteTransition.animateFloat(
            initialValue = 0f,
            targetValue = 1f,
            animationSpec = infiniteRepeatable(
                animation = tween(3000, easing = LinearEasing),
                repeatMode = RepeatMode.Restart
            )
        )

        val pulseAnimation by infiniteTransition.animateFloat(
            initialValue = 0.8f,
            targetValue = 1.2f,
            animationSpec = infiniteRepeatable(
                animation = tween(1500, easing = LinearEasing),
                repeatMode = RepeatMode.Reverse
            )
        )

        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(24.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally
        ) {

            // Animated monitoring status
            Text(
                text = "SURVEILLANCE ACTIVE",
                fontSize = 28.sp,
                fontWeight = FontWeight.Black,
                color = primaryColor,
                letterSpacing = 3.sp,
                modifier = Modifier
                    .shadow(
                        elevation = 15.dp,
                        shape = RoundedCornerShape(4.dp),
                        spotColor = primaryColor.copy(alpha = pulseAnimation * 0.5f)
                    )
            )

            Spacer(modifier = Modifier.height(12.dp))

            Text(
                text = "ROOM: ${roomName.uppercase()}",
                fontSize = 16.sp,
                fontWeight = FontWeight.Medium,
                color = primaryColor.copy(alpha = 0.7f),
                letterSpacing = 1.5.sp
            )

            Spacer(modifier = Modifier.height(48.dp))

            // Futuristic monitoring panel
            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .shadow(
                        elevation = 25.dp,
                        shape = RoundedCornerShape(16.dp),
                        spotColor = primaryColor.copy(alpha = 0.3f)
                    )
                    .border(
                        width = 2.dp,
                        brush = Brush.horizontalGradient(
                            colors = listOf(
                                primaryColor.copy(alpha = 0.5f),
                                primaryColor,
                                primaryColor.copy(alpha = 0.5f)
                            )
                        ),
                        shape = RoundedCornerShape(16.dp)
                    ),
                colors = CardDefaults.cardColors(
                    containerColor = Color(0xFF1A1A2E).copy(alpha = 0.9f)
                ),
                shape = RoundedCornerShape(16.dp)
            ) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(32.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        // Animated camera icon
                        Text(
                            text = "🎯",
                            fontSize = 64.sp,
                            modifier = Modifier
                                .graphicsLayer(
                                    scaleX = pulseAnimation,
                                    scaleY = pulseAnimation
                                )
                        )

                        Spacer(modifier = Modifier.height(24.dp))

                        Text(
                            text = "NEURAL FEED ACTIVE",
                            fontSize = 18.sp,
                            fontWeight = FontWeight.Bold,
                            color = primaryColor,
                            letterSpacing = 1.sp
                        )

                        Spacer(modifier = Modifier.height(12.dp))

                        Text(
                            text = "BACK CAMERA • ULTRA-HD STREAMING",
                            fontSize = 14.sp,
                            color = primaryColor.copy(alpha = 0.7f),
                            letterSpacing = 0.5.sp
                        )

                        Spacer(modifier = Modifier.height(20.dp))

                        // Animated progress bar
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(4.dp)
                                .background(
                                    Color.Gray.copy(alpha = 0.3f),
                                    RoundedCornerShape(2.dp)
                                )
                        ) {
                            Box(
                                modifier = Modifier
                                    .fillMaxWidth(scanlineAnimation)
                                    .height(4.dp)
                                    .background(
                                        primaryColor,
                                        RoundedCornerShape(2.dp)
                                    )
                            )
                        }
                    }
                }
            }

            Spacer(modifier = Modifier.height(40.dp))

            // Status indicator
            AnimatedStatusCard(
                title = "MONITORING PROTOCOL",
                status = "ACTIVE",
                isGood = true,
                primaryColor = primaryColor,
                errorColor = errorColor
            )

            Spacer(modifier = Modifier.height(60.dp))

            // Disconnect button
            Button(
                onClick = onDisconnect,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(60.dp)
                    .shadow(
                        elevation = 15.dp,
                        shape = RoundedCornerShape(30.dp),
                        spotColor = errorColor.copy(alpha = 0.4f)
                    )
                    .border(
                        width = 2.dp,
                        color = errorColor,
                        shape = RoundedCornerShape(30.dp)
                    ),
                colors = ButtonDefaults.buttonColors(
                    containerColor = Color.Transparent
                ),
                shape = RoundedCornerShape(30.dp)
            ) {
                Text(
                    text = "TERMINATE SESSION",
                    fontSize = 16.sp,
                    fontWeight = FontWeight.Bold,
                    color = errorColor,
                    letterSpacing = 1.sp
                )
            }
        }
    }

    @Composable
    fun AnimatedStatusCard(
        title: String,
        status: String,
        isGood: Boolean,
        primaryColor: Color,
        errorColor: Color
    ) {
        val statusColor = if (isGood) primaryColor else errorColor

        val infiniteTransition = rememberInfiniteTransition()
        val blinkAnimation by infiniteTransition.animateFloat(
            initialValue = 0.3f,
            targetValue = 1f,
            animationSpec = infiniteRepeatable(
                animation = tween(1000, easing = LinearEasing),
                repeatMode = RepeatMode.Reverse
            )
        )

        Card(
            modifier = Modifier
                .fillMaxWidth()
                .shadow(
                    elevation = 12.dp,
                    shape = RoundedCornerShape(12.dp),
                    spotColor = statusColor.copy(alpha = 0.3f)
                )
                .border(
                    width = 1.dp,
                    color = statusColor.copy(alpha = blinkAnimation),
                    shape = RoundedCornerShape(12.dp)
                ),
            colors = CardDefaults.cardColors(
                containerColor = Color(0xFF1A1A2E).copy(alpha = 0.8f)
            ),
            shape = RoundedCornerShape(12.dp)
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(20.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = title,
                    fontWeight = FontWeight.Bold,
                    color = Color.White,
                    fontSize = 14.sp,
                    letterSpacing = 1.sp
                )
                Text(
                    text = status,
                    color = statusColor,
                    fontWeight = FontWeight.Bold,
                    fontSize = 14.sp,
                    letterSpacing = 0.5.sp
                )
            }
        }
    }

    @Composable
    fun CyberTextField(
        value: String,
        onValueChange: (String) -> Unit,
        label: String,
        enabled: Boolean,
        primaryColor: Color
    ) {
        OutlinedTextField(
            value = value,
            onValueChange = onValueChange,
            label = {
                Text(
                    label,
                    color = primaryColor.copy(alpha = 0.7f),
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Medium,
                    letterSpacing = 1.sp
                )
            },
            modifier = Modifier
                .fillMaxWidth()
                .shadow(
                    elevation = 8.dp,
                    shape = RoundedCornerShape(12.dp),
                    spotColor = primaryColor.copy(alpha = 0.2f)
                ),
            enabled = enabled,
            shape = RoundedCornerShape(12.dp),
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = primaryColor,
                unfocusedBorderColor = primaryColor.copy(alpha = 0.5f),
                focusedTextColor = Color.White,
                unfocusedTextColor = Color.White.copy(alpha = 0.8f),
                disabledBorderColor = Color.Gray,
                disabledTextColor = Color.Gray,
                cursorColor = primaryColor,
                unfocusedContainerColor = Color(0xFF1A1A2E).copy(alpha = 0.7f),
                focusedContainerColor = Color(0xFF1A1A2E).copy(alpha = 0.7f)
            )
        )
    }

    @Composable
    fun AnimatedConnectButton(
        onClick: () -> Unit,
        enabled: Boolean,
        isConnected: Boolean,
        primaryColor: Color
    ) {
        val infiniteTransition = rememberInfiniteTransition()
        val pulseAnimation by infiniteTransition.animateFloat(
            initialValue = 1f,
            targetValue = 1.1f,
            animationSpec = infiniteRepeatable(
                animation = tween(1000, easing = LinearEasing),
                repeatMode = RepeatMode.Reverse
            )
        )

        Button(
            onClick = onClick,
            modifier = Modifier
                .fillMaxWidth()
                .height(60.dp)
                .shadow(
                    elevation = if (enabled) 20.dp else 5.dp,
                    shape = RoundedCornerShape(30.dp),
                    spotColor = primaryColor.copy(alpha = if (enabled) 0.5f else 0.1f)
                )
                .graphicsLayer(
                    scaleX = if (enabled) pulseAnimation else 1f,
                    scaleY = if (enabled) pulseAnimation else 1f
                )
                .border(
                    width = 2.dp,
                    color = if (enabled) primaryColor else Color.Gray,
                    shape = RoundedCornerShape(30.dp)
                ),
            enabled = enabled,
            colors = ButtonDefaults.buttonColors(
                containerColor = if (enabled) primaryColor.copy(alpha = 0.2f) else Color.Transparent,
                disabledContainerColor = Color.Transparent
            ),
            shape = RoundedCornerShape(30.dp)
        ) {
            Text(
                text = if (isConnected) "CONNECTED" else "INITIATE CONNECTION",
                fontSize = 16.sp,
                fontWeight = FontWeight.Bold,
                color = if (enabled) primaryColor else Color.Gray,
                letterSpacing = 1.sp
            )
        }
    }

    @Composable
    fun CyberInfoPanel(primaryColor: Color) {
        Card(
            modifier = Modifier
                .fillMaxWidth()
                .shadow(
                    elevation = 8.dp,
                    shape = RoundedCornerShape(12.dp),
                    spotColor = primaryColor.copy(alpha = 0.2f)
                ),
            colors = CardDefaults.cardColors(
                containerColor = Color(0xFF1A1A2E).copy(alpha = 0.6f)
            ),
            shape = RoundedCornerShape(12.dp)
        ) {
            Column(
                modifier = Modifier.padding(20.dp)
            ) {
                Text(
                    text = "PROTOCOL BRIEFING",
                    fontWeight = FontWeight.Bold,
                    color = primaryColor,
                    fontSize = 14.sp,
                    letterSpacing = 1.sp
                )
                Spacer(modifier = Modifier.height(12.dp))
                Text(
                    text = "Position device to monitor examination area. Neural surveillance algorithms will analyze behavioral patterns in real-time.",
                    color = Color.White.copy(alpha = 0.8f),
                    fontSize = 12.sp,
                    lineHeight = 16.sp
                )
            }
        }
    }

    private fun connect(serverUrl: String, roomName: String) {
        if (roomName.isBlank()) {
            Toast.makeText(this, "Please enter a room name", Toast.LENGTH_SHORT).show()
            return
        }

        currentRoom = roomName
        socketManager.connect(serverUrl)

        // Wait for connection then join room and start streaming
        lifecycleScope.launch {
            socketManager.isConnected.collect { isConnected ->
                if (isConnected && currentRoom.isNotEmpty()) {
                    Log.d("MainActivity", "Connected! Joining room: $currentRoom")
                    socketManager.joinRoom(currentRoom)
                    startStreaming()
                }
            }
        }
    }

    private fun startStreaming() {
        if (!isStreaming) {
            imageStreamManager.startStreaming(2) // 2 FPS
            isStreaming = true
            Log.d("MainActivity", "Started video streaming")
        }
    }

    private fun disconnect() {
        Log.d("MainActivity", "Disconnecting...")
        imageStreamManager.stopStreaming()
        socketManager.disconnect()
        isStreaming = false
        currentRoom = ""
    }

    override fun onDestroy() {
        super.onDestroy()
        imageStreamManager.cleanup()
        socketManager.disconnect()
    }
}