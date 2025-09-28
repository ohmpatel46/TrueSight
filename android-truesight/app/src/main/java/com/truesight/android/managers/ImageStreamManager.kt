package com.truesight.android.managers

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageFormat
import android.graphics.Matrix
import android.graphics.Rect
import android.graphics.YuvImage
import android.util.Base64
import android.util.Log
import androidx.camera.core.*
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import kotlinx.coroutines.*
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer

class ImageStreamManager(
    private val context: Context,
    private val lifecycleOwner: LifecycleOwner
) {
    private var imageCapture: ImageCapture? = null
    private var imageAnalyzer: ImageAnalysis? = null
    private var cameraProvider: ProcessCameraProvider? = null
    private var streamingJob: Job? = null

    var onFrameCaptured: ((String) -> Unit)? = null
    private var isStreaming = false

    fun startCamera(useBackCamera: Boolean = true, onSuccess: () -> Unit, onError: (Exception) -> Unit) {
        val cameraProviderFuture = ProcessCameraProvider.getInstance(context)

        cameraProviderFuture.addListener({
            try {
                cameraProvider = cameraProviderFuture.get()
                bindCameraUseCases(useBackCamera)
                onSuccess()
                Log.d("ImageStreamManager", "Camera started successfully")
            } catch (exc: Exception) {
                Log.e("ImageStreamManager", "Camera initialization failed", exc)
                onError(exc)
            }
        }, ContextCompat.getMainExecutor(context))
    }

    fun switchCamera(useBackCamera: Boolean) {
        stopStreaming()
        bindCameraUseCases(useBackCamera)
    }

    private fun bindCameraUseCases(useBackCamera: Boolean = true) {
        val cameraProvider = cameraProvider ?: return

        val cameraSelector = if (useBackCamera) {
            CameraSelector.DEFAULT_BACK_CAMERA
        } else {
            CameraSelector.DEFAULT_FRONT_CAMERA
        }

        // Image capture use case
        imageCapture = ImageCapture.Builder()
            .setTargetResolution(android.util.Size(640, 480))
            .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
            .build()

        // Image analysis use case for streaming
        imageAnalyzer = ImageAnalysis.Builder()
            .setTargetResolution(android.util.Size(320, 240))
            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
            .build()
            .also { analysis ->
                analysis.setAnalyzer(ContextCompat.getMainExecutor(context)) { imageProxy ->
                    if (isStreaming) {
                        processImage(imageProxy)
                    }
                    imageProxy.close()
                }
            }

        try {
            // Unbind use cases before rebinding
            cameraProvider.unbindAll()

            // Bind use cases to camera
            cameraProvider.bindToLifecycle(
                lifecycleOwner,
                cameraSelector,
                imageCapture,
                imageAnalyzer
            )
        } catch (exc: Exception) {
            Log.e("ImageStreamManager", "Use case binding failed", exc)
        }
    }

    fun startStreaming(frameRateHz: Int = 2) {
        if (isStreaming) return

        isStreaming = true
        val intervalMs = 1000L / frameRateHz

        streamingJob = CoroutineScope(Dispatchers.IO).launch {
            while (isStreaming) {
                captureStillImage()
                delay(intervalMs)
            }
        }

        Log.d("ImageStreamManager", "Started streaming at ${frameRateHz}fps")
    }

    fun stopStreaming() {
        isStreaming = false
        streamingJob?.cancel()
        streamingJob = null
        Log.d("ImageStreamManager", "Stopped streaming")
    }

    private fun captureStillImage() {
        val imageCapture = imageCapture ?: return

        val outputFileOptions = ImageCapture.OutputFileOptions.Builder(
            createTempFile("capture", ".jpg", context.cacheDir)
        ).build()

        imageCapture.takePicture(
            outputFileOptions,
            ContextCompat.getMainExecutor(context),
            object : ImageCapture.OnImageSavedCallback {
                override fun onImageSaved(output: ImageCapture.OutputFileResults) {
                    output.savedUri?.let { uri ->
                        try {
                            val inputStream = context.contentResolver.openInputStream(uri)
                            val bitmap = BitmapFactory.decodeStream(inputStream)
                            inputStream?.close()

                            val base64 = bitmapToBase64(bitmap, 80)
                            onFrameCaptured?.invoke(base64)
                        } catch (e: Exception) {
                            Log.e("ImageStreamManager", "Error processing captured image", e)
                        }
                    }
                }

                override fun onError(exception: ImageCaptureException) {
                    Log.e("ImageStreamManager", "Image capture failed", exception)
                }
            }
        )
    }

    private fun processImage(imageProxy: ImageProxy) {
        try {
            val bitmap = imageProxyToBitmap(imageProxy)
            bitmap?.let {
                val base64 = bitmapToBase64(it, 60) // Lower quality for real-time streaming
                onFrameCaptured?.invoke(base64)
            }
        } catch (e: Exception) {
            Log.e("ImageStreamManager", "Error processing image", e)
        }
    }

    private fun imageProxyToBitmap(imageProxy: ImageProxy): Bitmap? {
        return try {
            val buffer = imageProxy.planes[0].buffer
            val bytes = ByteArray(buffer.remaining())
            buffer.get(bytes)
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        } catch (e: Exception) {
            Log.e("ImageStreamManager", "Error converting ImageProxy to Bitmap", e)
            null
        }
    }

    private fun bitmapToBase64(bitmap: Bitmap, quality: Int): String {
        val outputStream = ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.JPEG, quality, outputStream)
        val byteArray = outputStream.toByteArray()
        return Base64.encodeToString(byteArray, Base64.NO_WRAP)
    }

    fun cleanup() {
        stopStreaming()
        cameraProvider?.unbindAll()
        cameraProvider = null
        imageCapture = null
        imageAnalyzer = null
        Log.d("ImageStreamManager", "Cleanup completed")
    }
}