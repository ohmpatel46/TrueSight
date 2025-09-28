#!/usr/bin/env python3
"""
FastAPI service for DETR-ResNet50 human detection
Processes phone camera frames for malpractice detection
"""

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import onnxruntime as ort
import cv2
import numpy as np
import base64
from typing import List, Dict, Any, Optional
import time
import os
import json
from overlay_detection import OverlayDetector, DetectionResult

app = FastAPI(title="TrueSight ML Detection Service")

# Global model sessions
session = None  # DETR model for human/phone detection
depth_session = None  # MiDaS model for depth estimation
overlay_detector = None  # Overlay detection instance

# Frame history for persistent detection
frame_history = {}
alert_sent = {}  # Track which alerts have been sent to prevent duplicates
HUMAN_HISTORY_LENGTH = 4  # Number of frames to track for humans
PHONE_HISTORY_LENGTH = 2  # Number of frames to track for phones
HUMAN_MALPRACTICE_THRESHOLD = 1  # 1+ people = malpractice (any non-zero)
PHONE_MALPRACTICE_THRESHOLD = 1  # 1+ additional phone = malpractice

class FrameRequest(BaseModel):
    data: str  # base64 encoded image
    timestamp: int
    room: str = "default"

class Detection(BaseModel):
    class_name: str
    confidence: float
    bbox: List[float]  # [x1, y1, x2, y2]

class MalpracticeResult(BaseModel):
    humans_detected: int
    human_detections: List[Detection]
    other_objects: List[Detection]
    malpractice_detected: bool
    alerts: List[str]
    confidence: float
    processing_time_ms: float

class DepthAnalysisResult(BaseModel):
    depth_map_available: bool
    laptop_screen_detected: bool
    phone_to_laptop_distance: float  # in meters (estimated)
    wall_boundaries: List[List[float]]  # List of wall boundary points
    room_dimensions: Dict[str, float]  # width, height, depth estimates
    device_positions: Dict[str, Dict[str, float]]  # laptop, phone positions in room
    processing_time_ms: float

class OverlayDetectionResult(BaseModel):
    has_overlay: bool
    confidence: float
    overlay_type: Optional[str]
    suspicious_regions: List[List[int]]  # x, y, w, h for each region
    analysis_details: Dict[str, Any]
    processing_time_ms: float
    timestamp: str

# COCO class names (DETR is typically trained on COCO)
COCO_CLASSES = [
    "N/A", "person", "bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck", "boat",
    "traffic light", "fire hydrant", "N/A", "stop sign", "parking meter", "bench", "bird", "cat", "dog", "horse",
    "sheep", "cow", "elephant", "bear", "zebra", "giraffe", "N/A", "backpack", "umbrella", "N/A", "N/A",
    "handbag", "tie", "suitcase", "frisbee", "skis", "snowboard", "sports ball", "kite", "baseball bat",
    "baseball glove", "skateboard", "surfboard", "tennis racket", "bottle", "N/A", "wine glass", "cup",
    "fork", "knife", "spoon", "bowl", "banana", "apple", "sandwich", "orange", "broccoli", "carrot",
    "hot dog", "pizza", "donut", "cake", "chair", "couch", "potted plant", "bed", "N/A", "dining table",
    "N/A", "N/A", "toilet", "N/A", "tv", "laptop", "mouse", "remote", "keyboard", "cell phone",
    "microwave", "oven", "toaster", "sink", "refrigerator", "N/A", "book", "clock", "vase", "scissors",
    "teddy bear", "hair drier", "toothbrush"
]

def load_model():
    """Load the DETR ONNX model"""
    global session
    
    model_path = os.path.join("models", "human+phone", "model.onnx")
    
    if not os.path.exists(model_path):
        raise Exception(f"Model file not found: {model_path}")
    
    try:
        session = ort.InferenceSession(model_path)
        print(f"✅ DETR model loaded from {model_path}")
        
        # Print model info
        inputs = session.get_inputs()
        outputs = session.get_outputs()
        print(f"📊 Model: {len(inputs)} inputs, {len(outputs)} outputs")
        print(f"  Input: {inputs[0].name} {inputs[0].shape}")
        
        return True
    except Exception as e:
        print(f"❌ Failed to load model: {e}")
        return False

def load_depth_model():
    """Load the MiDaS depth estimation ONNX model"""
    global depth_session
    
    # Assuming MiDaS model is placed in models/depth/
    depth_model_path = os.path.join("models", "depth", "model.onnx")
    
    if not os.path.exists(depth_model_path):
        print(f"⚠️ MiDaS depth model not found: {depth_model_path}")
        print("📝 Note: Place MiDaS ONNX model in models/depth/model.onnx for depth analysis")
        return False
    
    try:
        depth_session = ort.InferenceSession(depth_model_path)
        print(f"✅ MiDaS depth model loaded from {depth_model_path}")
        
        # Print model info
        inputs = depth_session.get_inputs()
        outputs = depth_session.get_outputs()
        print(f"📊 Depth Model: {len(inputs)} inputs, {len(outputs)} outputs")
        print(f"  Input: {inputs[0].name} {inputs[0].shape}")
        
        return True
    except Exception as e:
        print(f"❌ Failed to load depth model: {e}")
        return False

def mask_laptop_screens(image: np.ndarray) -> np.ndarray:
    """
    Detect and mask laptop screen areas to prevent false human detection
    """
    # Convert to grayscale for screen detection
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    
    # Find bright rectangular areas (typical screens)
    _, thresh = cv2.threshold(gray, 120, 255, cv2.THRESH_BINARY)
    
    # Morphological operations to clean up
    kernel = np.ones((5,5), np.uint8)
    thresh = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel)
    thresh = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, kernel)
    
    # Find contours
    contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    for contour in contours:
        area = cv2.contourArea(contour)
        
        # Screen should be reasonably large
        if 5000 < area < 100000:  # Adjust based on typical laptop screen size in frame
            # Check if rectangular
            epsilon = 0.02 * cv2.arcLength(contour, True)
            approx = cv2.approxPolyDP(contour, epsilon, True)
            
            if len(approx) >= 4:  # Roughly rectangular
                # Get bounding rectangle
                x, y, w, h = cv2.boundingRect(contour)
                
                # Check aspect ratio (screens are typically 16:9 or 4:3)
                aspect_ratio = w / h
                if 1.2 < aspect_ratio < 2.0:  # Reasonable screen aspect ratio
                    # Mask this area (gray it out)
                    cv2.rectangle(image, (x, y), (x + w, y + h), (128, 128, 128), -1)
                    print(f"🖥️ Masked screen area: {x},{y} {w}x{h} (aspect: {aspect_ratio:.2f})")
    
    return image

def preprocess_depth_image(image: np.ndarray) -> np.ndarray:
    """
    Preprocess image for MiDaS depth estimation
    MiDaS typically expects RGB input of specific size (384x384 for MiDaS v2)
    """
    # Resize image to MiDaS input size (assuming 384x384)
    target_size = (384, 384)
    resized = cv2.resize(image, target_size)
    
    # Convert BGR to RGB (OpenCV uses BGR, MiDaS expects RGB)
    rgb_image = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)
    
    # Normalize to [0, 1] range
    normalized = rgb_image.astype(np.float32) / 255.0
    
    # MiDaS expects CHW format (channels first) and batch dimension
    chw_image = np.transpose(normalized, (2, 0, 1))  # HWC to CHW
    batch_image = np.expand_dims(chw_image, axis=0)  # Add batch dimension
    
    return batch_image

def analyze_depth_map(depth_map: np.ndarray, original_image: np.ndarray) -> Dict[str, Any]:
    """
    Analyze depth map to extract room information and device positions
    """
    # Normalize depth map for analysis
    depth_normalized = (depth_map - depth_map.min()) / (depth_map.max() - depth_map.min())
    
    # Convert to 8-bit for OpenCV operations
    depth_8bit = (depth_normalized * 255).astype(np.uint8)
    
    # Detect laptop screen (typically a rectangular bright area in the center)
    laptop_screen_detected = detect_laptop_screen(depth_8bit, original_image)
    
    # Estimate phone to laptop distance
    phone_to_laptop_distance = estimate_phone_to_laptop_distance(depth_map, laptop_screen_detected)
    
    # Detect wall boundaries (areas with maximum depth)
    wall_boundaries = detect_wall_boundaries(depth_8bit)
    
    # Estimate room dimensions
    room_dimensions = estimate_room_dimensions(depth_map)
    
    # Estimate device positions
    device_positions = estimate_device_positions(depth_map, laptop_screen_detected)
    
    return {
        "laptop_screen_detected": laptop_screen_detected,
        "phone_to_laptop_distance": phone_to_laptop_distance,
        "wall_boundaries": wall_boundaries,
        "room_dimensions": room_dimensions,
        "device_positions": device_positions
    }

def detect_laptop_screen(depth_map: np.ndarray, original_image: np.ndarray) -> bool:
    """
    Detect laptop screen in the image using depth and brightness cues
    """
    h, w = depth_map.shape
    center_region = depth_map[h//4:3*h//4, w//4:3*w//4]
    
    # Look for rectangular regions with consistent depth (screen surface)
    # This is a simplified detection - in practice, you'd use more sophisticated methods
    mean_depth = np.mean(center_region)
    std_depth = np.std(center_region)
    
    # If center region has low depth variance, likely a flat surface (screen)
    return std_depth < 0.1 and mean_depth < 0.7  # Thresholds to be tuned

def estimate_phone_to_laptop_distance(depth_map: np.ndarray, laptop_detected: bool) -> float:
    """
    Estimate distance from phone to laptop screen
    """
    if not laptop_detected:
        return -1.0  # Unable to determine
    
    h, w = depth_map.shape
    center_region = depth_map[h//4:3*h//4, w//4:3*w//4]
    
    # Average depth in center region (where laptop screen likely is)
    avg_depth = np.mean(center_region)
    
    # Convert normalized depth to approximate real-world distance
    # This is a rough approximation - would need calibration in practice
    estimated_distance = avg_depth * 3.0  # Assuming max depth represents ~3 meters
    
    return float(estimated_distance)

def detect_wall_boundaries(depth_map: np.ndarray) -> List[List[float]]:
    """
    Detect wall boundaries from depth map
    """
    # Find contours of areas with maximum depth (walls/background)
    threshold = int(np.max(depth_map) * 0.8)  # Areas with depth > 80% of max
    _, binary = cv2.threshold(depth_map, threshold, 255, cv2.THRESH_BINARY)
    
    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    # Convert contours to simplified boundary points
    boundaries = []
    for contour in contours:
        if cv2.contourArea(contour) > 1000:  # Filter small contours
            epsilon = 0.02 * cv2.arcLength(contour, True)
            approx = cv2.approxPolyDP(contour, epsilon, True)
            boundary_points = [[float(pt[0][0]), float(pt[0][1])] for pt in approx]
            boundaries.append(boundary_points)
    
    return boundaries

def estimate_room_dimensions(depth_map: np.ndarray) -> Dict[str, float]:
    """
    Estimate room dimensions from depth map
    """
    h, w = depth_map.shape
    
    # Simple estimation based on depth map analysis
    max_depth = float(np.max(depth_map))
    avg_depth = float(np.mean(depth_map))
    
    # These are rough estimates - would need proper calibration
    estimated_width = max_depth * 1.5  # Rough approximation
    estimated_height = max_depth * 1.2  # Assuming standard ceiling height
    estimated_depth = max_depth
    
    return {
        "width": estimated_width,
        "height": estimated_height, 
        "depth": estimated_depth
    }

def estimate_device_positions(depth_map: np.ndarray, laptop_detected: bool) -> Dict[str, Dict[str, float]]:
    """
    Estimate positions of laptop and phone in the room
    """
    h, w = depth_map.shape
    
    positions = {
        "phone": {"x": 0.0, "y": 0.0, "z": 0.0},  # Phone is at origin (camera position)
        "laptop": {"x": 0.0, "y": 0.0, "z": 0.0}
    }
    
    if laptop_detected:
        # Estimate laptop position based on center of screen in image
        center_x = w // 2
        center_y = h // 2
        
        # Convert image coordinates to room coordinates (simplified)
        laptop_depth = float(np.mean(depth_map[h//4:3*h//4, w//4:3*w//4]))
        
        positions["laptop"] = {
            "x": (center_x - w//2) / w * 2.0,  # Normalized x position
            "y": (center_y - h//2) / h * 1.5,  # Normalized y position  
            "z": laptop_depth * 3.0  # Estimated z distance
        }
    
    return positions

def preprocess_image(image: np.ndarray) -> np.ndarray:
    """
    Preprocess image for DETR model
    Input: OpenCV image (BGR, any size)
    Output: Tensor [1, 3, 640, 640] (RGB, normalized)
    """
    # Apply screen masking to prevent false detections
    image = mask_laptop_screens(image.copy())
    
    # Resize to model input size
    image = cv2.resize(image, (640, 640))
    
    # BGR to RGB
    image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    
    # Normalize to [0, 1]
    image = image.astype(np.float32) / 255.0
    
    # HWC to CHW (Height-Width-Channel to Channel-Height-Width)
    image = np.transpose(image, (2, 0, 1))
    
    # Add batch dimension
    image = np.expand_dims(image, axis=0)
    
    return image

def filter_real_humans(humans: List[Detection], image_shape: tuple) -> List[Detection]:
    """
    Filter out humans that are likely on screens based on size and position
    """
    real_humans = []
    image_area = image_shape[0] * image_shape[1]
    
    for human in humans:
        x1, y1, x2, y2 = human.bbox
        
        # Calculate human properties
        width = x2 - x1
        height = y2 - y1
        area = width * height
        relative_size = area / image_area
        
        # Real humans should be:
        # 1. Reasonably large (not tiny like people on screens)
        # 2. Have proper aspect ratio (height > width for standing people)
        aspect_ratio = height / width if width > 0 else 0
        
        # Filter criteria (more lenient for phone cameras)
        is_large_enough = relative_size > 0.02  # At least 2% of image (was 5%)
        is_proper_aspect = 0.5 < aspect_ratio < 4.0  # More flexible proportions
        
        if is_large_enough and is_proper_aspect:
            real_humans.append(human)
            print(f"✅ Real human detected: size={relative_size:.1%}, aspect={aspect_ratio:.2f}")
        else:
            print(f"🔍 Filtered out screen human: size={relative_size:.1%}, aspect={aspect_ratio:.2f}")
    
    return real_humans

def postprocess_detections(boxes: np.ndarray, logits: np.ndarray, classes: np.ndarray, 
                          confidence_threshold: float = 0.3, image_shape: tuple = (640, 640)) -> tuple:
    """
    Process DETR model outputs - focus only on humans and cell phones
    """
    humans = []
    cell_phones = []
    
    for i in range(len(boxes[0])):  # 100 detections
        bbox = boxes[0][i]
        confidence = float(logits[0][i])
        class_id = int(classes[0][i])
        
        # Filter by confidence
        if confidence < confidence_threshold:
            continue
        
        # Only process humans and cell phones
        if class_id == 1:  # Person class
            class_name = "person"
            detection = Detection(
                class_name=class_name,
                confidence=confidence,
                bbox=bbox.tolist()
            )
            humans.append(detection)
            
        elif class_id == 77:  # Cell phone class in COCO
            class_name = "cell phone"
            detection = Detection(
                class_name=class_name,
                confidence=confidence,
                bbox=bbox.tolist()
            )
            cell_phones.append(detection)
    
    # For demo: no filtering, just return all detected humans
    print(f"🔍 Raw detection: {len(humans)} humans, {len(cell_phones)} phones")
    
    return humans, cell_phones

def update_detection_history(room: str, human_count: int, phone_count: int) -> tuple:
    """
    Update detection history and check for NEW persistent malpractice
    Returns (new_human_malpractice, new_phone_malpractice) - only True when first detected
    """
    if room not in frame_history:
        frame_history[room] = {
            'humans': [],
            'phones': []
        }
    
    if room not in alert_sent:
        alert_sent[room] = {
            'human_alert_sent': False,
            'phone_alert_sent': False
        }
    
    # Add current counts to history
    frame_history[room]['humans'].append(human_count >= HUMAN_MALPRACTICE_THRESHOLD)
    frame_history[room]['phones'].append(phone_count >= PHONE_MALPRACTICE_THRESHOLD)
    
    # Keep only recent frames
    if len(frame_history[room]['humans']) > HUMAN_HISTORY_LENGTH:
        frame_history[room]['humans'] = frame_history[room]['humans'][-HUMAN_HISTORY_LENGTH:]
    
    if len(frame_history[room]['phones']) > PHONE_HISTORY_LENGTH:
        frame_history[room]['phones'] = frame_history[room]['phones'][-PHONE_HISTORY_LENGTH:]
    
    # Check for persistent human malpractice (need 4 consecutive frames)
    human_malpractice_active = (
        len(frame_history[room]['humans']) >= HUMAN_HISTORY_LENGTH and
        all(frame_history[room]['humans'][-HUMAN_HISTORY_LENGTH:])
    )
    
    # Check for persistent phone malpractice (need 2 consecutive frames)  
    phone_malpractice_active = (
        len(frame_history[room]['phones']) >= PHONE_HISTORY_LENGTH and
        all(frame_history[room]['phones'][-PHONE_HISTORY_LENGTH:])
    )
    
    # Only return True if this is a NEW detection (not already alerted)
    new_human_malpractice = human_malpractice_active and not alert_sent[room]['human_alert_sent']
    new_phone_malpractice = phone_malpractice_active and not alert_sent[room]['phone_alert_sent']
    
    # Update alert status
    if new_human_malpractice:
        alert_sent[room]['human_alert_sent'] = True
        print(f"🚨 NEW HUMAN MALPRACTICE DETECTED in room {room}")
    
    if new_phone_malpractice:
        alert_sent[room]['phone_alert_sent'] = True
        print(f"📱 NEW PHONE MALPRACTICE DETECTED in room {room}")
    
    # Reset alert status if malpractice is no longer active (for future detections)
    if not human_malpractice_active:
        alert_sent[room]['human_alert_sent'] = False
    
    if not phone_malpractice_active:
        alert_sent[room]['phone_alert_sent'] = False
    
    print(f"📊 Detection history for {room}:")
    print(f"  Humans: {frame_history[room]['humans'][-4:]} (active: {human_malpractice_active}, new: {new_human_malpractice})")
    print(f"  Phones: {frame_history[room]['phones'][-2:]} (active: {phone_malpractice_active}, new: {new_phone_malpractice})")
    
    return new_human_malpractice, new_phone_malpractice

def analyze_malpractice(humans: List[Detection], cell_phones: List[Detection], room: str) -> tuple:
    """
    Analyze detections for malpractice - only generate alerts for NEW detections
    """
    alerts = []
    current_human_count = len(humans)
    current_phone_count = len(cell_phones)
    
    # Update detection history and check for NEW persistent malpractice
    new_human_malpractice, new_phone_malpractice = update_detection_history(room, current_human_count, current_phone_count)
    
    # Only generate alerts for NEW malpractice detections
    malpractice_detected = False
    
    if new_human_malpractice:
        alerts.append("🚨 Human detected")
        malpractice_detected = True
        print(f"🚨 SENDING HUMAN MALPRACTICE ALERT for room {room}")
    
    if new_phone_malpractice:
        alerts.append("📱 Smartphone detected")
        malpractice_detected = True
        print(f"📱 SENDING PHONE MALPRACTICE ALERT for room {room}")
    
    # If no NEW malpractice, return empty alerts (don't spam)
    if not malpractice_detected:
        alerts = []  # Empty - no alert to send
        print(f"✅ No new malpractice detected for room {room}")
    
    # Calculate overall confidence
    if humans:
        confidence = max([h.confidence for h in humans])
    else:
        confidence = 0.0
    
    return alerts, malpractice_detected, confidence

@app.post("/detect-humans", response_model=MalpracticeResult)
async def detect_humans(request: FrameRequest):
    """
    Detect humans and malpractice in phone camera frame
    """
    if session is None:
        raise HTTPException(status_code=503, detail="Model not loaded")
    
    start_time = time.time()
    
    try:
        # Validate and decode base64 image
        print(f"📥 Received frame request: {len(request.data)} chars")
        print(f"📥 Base64 validation: starts_with_jpeg={request.data.startswith('/9j/')}")
        
        try:
            image_data = base64.b64decode(request.data)
            print(f"📥 Decoded to {len(image_data)} bytes")
        except Exception as e:
            print(f"❌ Base64 decode error: {e}")
            raise HTTPException(status_code=400, detail=f"Invalid base64 data: {str(e)}")
        
        try:
            nparr = np.frombuffer(image_data, np.uint8)
            image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        except Exception as e:
            print(f"❌ Image decode error: {e}")
            raise HTTPException(status_code=400, detail=f"Failed to decode image: {str(e)}")
        
        if image is None:
            raise HTTPException(status_code=400, detail="Failed to decode image - invalid JPEG data")
        
        print(f"📥 Successfully decoded image: {image.shape[1]}x{image.shape[0]} pixels")
        
        # Preprocess for DETR
        try:
            input_tensor = preprocess_image(image)
            print(f"📥 Preprocessed to tensor shape: {input_tensor.shape}")
        except Exception as e:
            print(f"❌ Preprocessing error: {e}")
            raise HTTPException(status_code=500, detail=f"Image preprocessing failed: {str(e)}")
        
        # Run inference
        try:
            print(f"🤖 Running DETR inference...")
            outputs = session.run(None, {"image": input_tensor})
            boxes, logits, classes = outputs
            print(f"🤖 Inference complete. Outputs: {len(outputs)} tensors")
        except Exception as e:
            print(f"❌ DETR inference error: {e}")
            raise HTTPException(status_code=500, detail=f"Model inference failed: {str(e)}")
        
        # Process detections (only humans and cell phones)
        try:
            humans, cell_phones = postprocess_detections(boxes, logits, classes, image_shape=image.shape[:2])
            print(f"🔍 Detection results: {len(humans)} humans, {len(cell_phones)} phones")
        except Exception as e:
            print(f"❌ Postprocessing error: {e}")
            raise HTTPException(status_code=500, detail=f"Detection processing failed: {str(e)}")
        
        # Analyze for malpractice with frame history
        alerts, malpractice_detected, confidence = analyze_malpractice(humans, cell_phones, request.room)
        
        processing_time = (time.time() - start_time) * 1000  # Convert to ms
        
        return MalpracticeResult(
            humans_detected=len(humans),
            human_detections=humans,
            other_objects=cell_phones,  # Only cell phones now
            malpractice_detected=malpractice_detected,
            alerts=alerts,
            confidence=confidence,
            processing_time_ms=processing_time
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Detection failed: {str(e)}")

@app.post("/analyze-depth", response_model=DepthAnalysisResult)
async def analyze_depth(request: FrameRequest):
    """
    Analyze depth information from phone camera frame
    Returns room dimensions, wall boundaries, and device positions
    """
    start_time = time.time()
    
    if depth_session is None:
        raise HTTPException(status_code=503, detail="MiDaS depth model not loaded")
    
    try:
        # Decode base64 image
        try:
            image_data = base64.b64decode(request.data)
            image_array = np.frombuffer(image_data, np.uint8)
            image = cv2.imdecode(image_array, cv2.IMREAD_COLOR)
            
            if image is None:
                raise ValueError("Failed to decode image")
                
            print(f"🖼️ Depth analysis - Image shape: {image.shape}")
            
        except Exception as e:
            print(f"❌ Image decoding error: {e}")
            raise HTTPException(status_code=400, detail=f"Invalid image data: {str(e)}")
        
        # Preprocess image for MiDaS
        try:
            processed_image = preprocess_depth_image(image)
            print(f"📐 Preprocessed for depth: {processed_image.shape}")
        except Exception as e:
            print(f"❌ Depth preprocessing error: {e}")
            raise HTTPException(status_code=500, detail=f"Image preprocessing failed: {str(e)}")
        
        # Run MiDaS depth estimation
        try:
            input_name = depth_session.get_inputs()[0].name
            outputs = depth_session.run(None, {input_name: processed_image})
            depth_map = outputs[0][0]  # Remove batch dimension
            
            print(f"📊 Depth map shape: {depth_map.shape}")
            print(f"📊 Depth range: {depth_map.min():.3f} to {depth_map.max():.3f}")
            
        except Exception as e:
            print(f"❌ MiDaS inference error: {e}")
            raise HTTPException(status_code=500, detail=f"Depth estimation failed: {str(e)}")
        
        # Analyze depth map to extract room information
        try:
            analysis_results = analyze_depth_map(depth_map, image)
            print(f"🔍 Depth analysis complete: laptop detected = {analysis_results['laptop_screen_detected']}")
            print(f"📏 Phone to laptop distance: {analysis_results['phone_to_laptop_distance']:.2f}m")
            
        except Exception as e:
            print(f"❌ Depth analysis error: {e}")
            raise HTTPException(status_code=500, detail=f"Depth analysis failed: {str(e)}")
        
        processing_time = (time.time() - start_time) * 1000  # Convert to ms
        
        return DepthAnalysisResult(
            depth_map_available=True,
            laptop_screen_detected=analysis_results["laptop_screen_detected"],
            phone_to_laptop_distance=analysis_results["phone_to_laptop_distance"],
            wall_boundaries=analysis_results["wall_boundaries"],
            room_dimensions=analysis_results["room_dimensions"],
            device_positions=analysis_results["device_positions"],
            processing_time_ms=processing_time
        )
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Depth analysis failed: {str(e)}")

@app.post("/detect-overlays", response_model=OverlayDetectionResult)
async def detect_overlays(request: FrameRequest):
    """
    Detect overlay/cheat patterns in phone camera frame
    Returns overlay detection results with confidence scores
    """
    start_time = time.time()
    
    if overlay_detector is None:
        raise HTTPException(status_code=503, detail="Overlay detector not initialized")
    
    try:
        print(f"🔍 [DEBUG] Starting overlay detection for room {request.room}")
        print(f"🔍 [DEBUG] Input data length: {len(request.data) if request.data else 'None'}")
        print(f"🔍 [DEBUG] Overlay detector initialized: {overlay_detector is not None}")
        
        if not request.data:
            raise ValueError("No image data provided")
        
        # Run overlay detection
        print(f"🔍 [DEBUG] Calling overlay_detector.detect_overlay()...")
        detection_result = overlay_detector.detect_overlay(request.data)
        
        processing_time = (time.time() - start_time) * 1000  # Convert to ms
        
        print(f"🎯 [DEBUG] Overlay detection complete:")
        print(f"  - Has overlay: {detection_result.has_overlay}")
        print(f"  - Confidence: {detection_result.confidence:.3f}")
        print(f"  - Type: {detection_result.overlay_type}")
        print(f"  - Suspicious regions: {len(detection_result.suspicious_regions)}")
        print(f"  - Analysis details keys: {list(detection_result.analysis_details.keys()) if detection_result.analysis_details else 'None'}")
        print(f"  - Processing time: {processing_time:.1f}ms")
        
        # Debug specific analysis results
        if detection_result.analysis_details:
            if 'color_analysis' in detection_result.analysis_details:
                color_analysis = detection_result.analysis_details['color_analysis']
                print(f"  - Color analysis: {len(color_analysis)} overlay types checked")
                for overlay_type, data in color_analysis.items():
                    if data.get('regions'):
                        print(f"    * {overlay_type}: {len(data['regions'])} regions found")
            
            if 'text_analysis' in detection_result.analysis_details:
                text_analysis = detection_result.analysis_details['text_analysis']
                print(f"  - Text analysis: density={text_analysis.get('text_density', 0)}, score={text_analysis.get('suspicious_score', 0):.3f}")
            
            if 'video_specific' in detection_result.analysis_details:
                video_analysis = detection_result.analysis_details['video_specific']
                print(f"  - Video analysis: confidence={video_analysis.get('overlay_confidence', 0):.3f}")
        
        # Convert suspicious regions to the expected format
        suspicious_regions_list = [
            [region[0], region[1], region[2], region[3]] 
            for region in detection_result.suspicious_regions
        ]
        
        return OverlayDetectionResult(
            has_overlay=detection_result.has_overlay,
            confidence=detection_result.confidence,
            overlay_type=detection_result.overlay_type,
            suspicious_regions=suspicious_regions_list,
            analysis_details=detection_result.analysis_details,
            processing_time_ms=processing_time,
            timestamp=detection_result.timestamp
        )
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Overlay detection error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Overlay detection failed: {str(e)}")

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy" if session is not None else "model_not_loaded",
        "model_loaded": session is not None
    }

@app.on_event("startup")
async def startup_event():
    """Load models on startup"""
    global overlay_detector
    print("🚀 Starting TrueSight ML Detection Service...")
    
    # Load DETR model (required)
    detr_success = load_model()
    if not detr_success:
        print("❌ Failed to load DETR model on startup")
        return
    
    # Load MiDaS depth model (optional)
    depth_success = load_depth_model()
    if not depth_success:
        print("⚠️ MiDaS model not loaded - depth analysis will be unavailable")
        print("📝 To enable depth analysis, place MiDaS ONNX model in models/depth/model.onnx")
    
    # Initialize overlay detector
    try:
        overlay_detector = OverlayDetector(detection_threshold=0.6)
        print("✅ Overlay detector initialized")
        overlay_success = True
    except Exception as e:
        print(f"⚠️ Failed to initialize overlay detector: {e}")
        overlay_success = False
    
    print("✅ Service ready!")
    if detr_success and depth_success and overlay_success:
        print("🔥 All services loaded - full feature set available!")
    elif detr_success and overlay_success:
        print("👍 Human detection and overlay detection available - depth analysis disabled")
    elif detr_success:
        print("👍 Human detection available - depth and overlay analysis disabled")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=False)
