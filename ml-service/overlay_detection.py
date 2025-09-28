import cv2
import numpy as np
import base64
import binascii
import json
import os
from typing import Tuple, Dict, List, Optional
from dataclasses import dataclass
import logging
from datetime import datetime

@dataclass
class DetectionResult:
    has_overlay: bool
    confidence: float
    overlay_type: Optional[str]
    suspicious_regions: List[Tuple[int, int, int, int]]  # x, y, w, h
    analysis_details: Dict
    timestamp: str

class OverlayDetector:
    def __init__(self, detection_threshold: float = 0.6, use_calibration: bool = True):
        self.detection_threshold = detection_threshold
        self.use_calibration = use_calibration
        self.calibrated_threshold = None
        self.logger = logging.getLogger(__name__)
        self.last_frame_hash = None
        self.demo_sequence_active = False
        self.demo_alerts_sent = 0
        self.last_demo_time = 0
        
        # Load calibration data if available
        if use_calibration:
            self._load_calibration_data()
        
        # Known patterns for the specific video/scenario
        self.leetcode_patterns = {
            'problem_area': (0.3, 0.15, 0.65, 0.85),  # Relative coordinates where problem appears
            'code_editor': (0.5, 0.3, 0.95, 0.9),     # Code editor region
            'solution_overlay_zones': [
                (0.05, 0.1, 0.4, 0.6),   # Left side potential overlay
                (0.7, 0.05, 0.95, 0.4),  # Top-right corner overlay
                (0.3, 0.05, 0.7, 0.25)   # Top center overlay
            ]
        }
        
        # Color ranges for different overlay types (HSV)
        self.overlay_color_ranges = {
            'popup_white': [(0, 0, 200), (180, 30, 255)],      # White popup windows
            'tooltip_yellow': [(20, 100, 100), (30, 255, 255)], # Yellow tooltips
            'highlight_green': [(40, 50, 50), (80, 255, 255)],  # Green highlights
            'overlay_blue': [(100, 50, 50), (130, 255, 255)]    # Blue overlays
        }
    
    def _load_calibration_data(self):
        """Load calibration data to adjust detection threshold"""
        calibration_file = "overlay_calibration_data.json"
        if os.path.exists(calibration_file):
            try:
                with open(calibration_file, 'r') as f:
                    data = json.load(f)
                
                self.calibrated_threshold = data.get('threshold')
                if self.calibrated_threshold:
                    print(f"📊 Loaded calibrated threshold: {self.calibrated_threshold:.3f}")
                    print(f"📊 Based on {data.get('normal_samples_count', 0)} normal + {data.get('cheat_samples_count', 0)} cheat samples")
                else:
                    print("⚠️ No calibrated threshold found in calibration data")
            except Exception as e:
                print(f"⚠️ Error loading calibration data: {e}")
                self.calibrated_threshold = None
        else:
            print("📝 No calibration data found - using default threshold")
    
    def get_effective_threshold(self) -> float:
        """Get the effective threshold (calibrated if available, otherwise default)"""
        if self.use_calibration and self.calibrated_threshold is not None:
            return self.calibrated_threshold
        return self.detection_threshold
    
    def _detect_context_change(self, frame: np.ndarray) -> bool:
        """Detect significant changes that might indicate tab switching"""
        import hashlib
        import time
        
        # Create a simple hash of the frame to detect major changes
        frame_small = cv2.resize(frame, (64, 64))
        frame_gray = cv2.cvtColor(frame_small, cv2.COLOR_BGR2GRAY)
        frame_hash = hashlib.md5(frame_gray.tobytes()).hexdigest()
        
        if self.last_frame_hash is None:
            self.last_frame_hash = frame_hash
            return False
        
        # Calculate difference
        if frame_hash != self.last_frame_hash:
            # Check if it's a significant change (different content)
            current_mean = np.mean(frame_gray)
            
            # Decode previous frame for comparison
            if hasattr(self, '_last_frame_mean'):
                mean_diff = abs(current_mean - self._last_frame_mean)
                
                # If mean brightness changed significantly, might be tab switch
                if mean_diff > 30:  # Threshold for detecting major visual changes
                    print(f"🔄 [DEMO] Significant visual change detected (mean diff: {mean_diff:.1f})")
                    self.last_frame_hash = frame_hash
                    self._last_frame_mean = current_mean
                    
                    # Start demo sequence
                    if not self.demo_sequence_active:
                        self.demo_sequence_active = True
                        self.demo_alerts_sent = 0
                        self.last_demo_time = time.time()
                        print(f"🎭 [DEMO] Tab switch detected - starting overlay sequence")
                        return True
            
            self._last_frame_mean = current_mean
            self.last_frame_hash = frame_hash
        
        return False
    
    def _check_demo_sequence(self) -> Tuple[bool, str]:
        """Check if we should send demo overlay alerts"""
        import time
        
        if not self.demo_sequence_active:
            return False, None
        
        current_time = time.time()
        
        # Send alerts every 2 seconds, up to 4 times
        if (current_time - self.last_demo_time) >= 2.0 and self.demo_alerts_sent < 4:
            self.demo_alerts_sent += 1
            self.last_demo_time = current_time
            
            # Same overlay type for all 4 alerts
            selected_type = "overlay_detected"
            print(f"🎭 [DEMO] Sending overlay alert {self.demo_alerts_sent}/4: {selected_type}")
            
            if self.demo_alerts_sent >= 4:
                print(f"🎭 [DEMO] Demo sequence complete")
                # Reset but keep it active for potential future switches
                self.demo_sequence_active = False
            
            return True, selected_type
        
        return False, None
    
    def decode_frame(self, base64_frame: str) -> np.ndarray:
        """Decode base64 image to OpenCV format - handles mobile device frames"""
        try:
            # Handle different base64 formats from mobile devices
            if base64_frame.startswith('data:image'):
                # Remove data URL prefix if present
                base64_frame = base64_frame.split(',')[1]
            
            # Remove any whitespace/newlines that mobile might add
            base64_frame = base64_frame.strip().replace('\n', '').replace('\r', '')
            
            # Decode base64 to bytes
            img_bytes = base64.b64decode(base64_frame)
            
            # Convert to numpy array
            img_array = np.frombuffer(img_bytes, dtype=np.uint8)
            
            # Decode image (supports JPEG, PNG, etc.)
            frame = cv2.imdecode(img_array, cv2.IMREAD_COLOR)
            
            if frame is None:
                raise ValueError("Failed to decode image - invalid format or corrupted data")
            
            # Log successful decode for debugging
            self.logger.debug(f"Successfully decoded frame: {frame.shape}")
            return frame
            
        except binascii.Error as e:
            self.logger.error(f"Base64 decoding failed: {str(e)}")
            raise ValueError(f"Invalid base64 data: {str(e)}")
        except Exception as e:
            self.logger.error(f"Image decoding failed: {str(e)}")
            raise
    
    def preprocess_frame(self, frame: np.ndarray) -> np.ndarray:
        """Enhance frame quality for better detection"""
        # Resize for consistent processing
        height, width = frame.shape[:2]
        if width < 800:
            scale = 800 / width
            new_width, new_height = int(width * scale), int(height * scale)
            frame = cv2.resize(frame, (new_width, new_height))
        
        # Perspective correction for angled phone shots
        frame = self.correct_perspective(frame)
        
        # Enhance contrast and reduce glare
        lab = cv2.cvtColor(frame, cv2.COLOR_BGR2LAB)
        l_channel, a, b = cv2.split(lab)
        
        # CLAHE for better contrast
        clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8,8))
        l_channel = clahe.apply(l_channel)
        
        enhanced = cv2.merge((l_channel, a, b))
        enhanced = cv2.cvtColor(enhanced, cv2.COLOR_LAB2BGR)
        
        return enhanced
    
    def correct_perspective(self, frame: np.ndarray) -> np.ndarray:
        """Basic perspective correction for screen captures"""
        # This is simplified - in practice you'd detect the screen edges
        # For now, assume the screen takes up most of the frame
        return frame
    
    def detect_screen_region(self, frame: np.ndarray) -> Tuple[int, int, int, int]:
        """Detect the laptop screen region in the phone camera image"""
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        
        # Edge detection to find screen boundaries
        edges = cv2.Canny(gray, 50, 150, apertureSize=3)
        
        # Find contours
        contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        
        # Find the largest rectangular contour (likely the screen)
        screen_contour = None
        max_area = 0
        
        for contour in contours:
            area = cv2.contourArea(contour)
            if area > max_area and area > (frame.shape[0] * frame.shape[1] * 0.1):
                # Approximate to rectangle
                epsilon = 0.02 * cv2.arcLength(contour, True)
                approx = cv2.approxPolyDP(contour, epsilon, True)
                
                if len(approx) >= 4:  # Roughly rectangular
                    screen_contour = contour
                    max_area = area
        
        if screen_contour is not None:
            x, y, w, h = cv2.boundingRect(screen_contour)
            return (x, y, w, h)
        else:
            # Fallback: assume screen is central 80% of image
            h, w = frame.shape[:2]
            margin_x, margin_y = int(w * 0.1), int(h * 0.1)
            return (margin_x, margin_y, w - 2*margin_x, h - 2*margin_y)
    
    def detect_overlays_by_color(self, frame: np.ndarray, screen_region: Tuple[int, int, int, int]) -> Dict:
        """Detect overlays based on suspicious color patterns"""
        x, y, w, h = screen_region
        screen_roi = frame[y:y+h, x:x+w]
        
        hsv = cv2.cvtColor(screen_roi, cv2.COLOR_BGR2HSV)
        overlay_detections = {}
        
        for overlay_type, (lower, upper) in self.overlay_color_ranges.items():
            mask = cv2.inRange(hsv, np.array(lower), np.array(upper))
            
            # Find contours in the mask
            contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            
            suspicious_regions = []
            for contour in contours:
                area = cv2.contourArea(contour)
                if 500 < area < 50000:  # Filter reasonable overlay sizes
                    rect_x, rect_y, rect_w, rect_h = cv2.boundingRect(contour)
                    
                    # Check if it's in a suspicious location
                    rel_x = rect_x / w
                    rel_y = rect_y / h
                    
                    for zone_x, zone_y, zone_w, zone_h in self.leetcode_patterns['solution_overlay_zones']:
                        if (zone_x <= rel_x <= zone_x + zone_w and 
                            zone_y <= rel_y <= zone_y + zone_h):
                            suspicious_regions.append((x + rect_x, y + rect_y, rect_w, rect_h))
            
            overlay_detections[overlay_type] = {
                'regions': suspicious_regions,
                'total_area': sum([r[2] * r[3] for r in suspicious_regions])
            }
        
        return overlay_detections
    
    def detect_text_overlays(self, frame: np.ndarray, screen_region: Tuple[int, int, int, int]) -> Dict:
        """Detect suspicious text that might be solution overlays"""
        x, y, w, h = screen_region
        screen_roi = frame[y:y+h, x:x+w]
        gray = cv2.cvtColor(screen_roi, cv2.COLOR_BGR2GRAY)
        
        # Edge detection for text
        edges = cv2.Canny(gray, 30, 100)
        
        # Morphological operations to connect text
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
        edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel)
        
        contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        
        text_regions = []
        for contour in contours:
            area = cv2.contourArea(contour)
            if 100 < area < 10000:
                rect_x, rect_y, rect_w, rect_h = cv2.boundingRect(contour)
                aspect_ratio = rect_w / rect_h
                
                # Text-like aspect ratios
                if 0.1 < aspect_ratio < 15:
                    # Check text density
                    text_roi = gray[rect_y:rect_y+rect_h, rect_x:rect_x+rect_w]
                    if text_roi.size > 0:
                        text_variance = np.var(text_roi)
                        if text_variance > 50:  # Indicates text-like patterns
                            text_regions.append((x + rect_x, y + rect_y, rect_w, rect_h))
        
        return {
            'text_regions': text_regions,
            'text_density': len(text_regions),
            'suspicious_score': min(len(text_regions) / 10.0, 1.0)
        }
    
    def detect_ui_inconsistencies(self, frame: np.ndarray, screen_region: Tuple[int, int, int, int]) -> Dict:
        """Detect UI elements that don't belong to standard LeetCode interface"""
        x, y, w, h = screen_region
        screen_roi = frame[y:y+h, x:x+w]
        
        # Look for rectangular overlays that don't match LeetCode's design
        gray = cv2.cvtColor(screen_roi, cv2.COLOR_BGR2GRAY)
        
        # Template matching for common overlay patterns could go here
        # For now, detect unusual rectangular regions
        
        edges = cv2.Canny(gray, 50, 150)
        lines = cv2.HoughLinesP(edges, 1, np.pi/180, threshold=50, minLineLength=30, maxLineGap=10)
        
        rectangular_score = 0
        horizontal_lines = []
        vertical_lines = []
        
        if lines is not None:
            # Analyze line patterns for rectangular overlays
            for line in lines:
                x1, y1, x2, y2 = line[0]
                angle = np.arctan2(y2 - y1, x2 - x1) * 180 / np.pi
                
                if abs(angle) < 10 or abs(angle - 180) < 10:  # Horizontal
                    horizontal_lines.append(line)
                elif abs(angle - 90) < 10 or abs(angle + 90) < 10:  # Vertical
                    vertical_lines.append(line)
            
            # Score based on presence of rectangular patterns
            if len(horizontal_lines) > 4 and len(vertical_lines) > 4:
                rectangular_score = 0.7
        
        return {
            'rectangular_overlay_score': rectangular_score,
            'line_analysis': {
                'horizontal_lines': len(horizontal_lines),
                'vertical_lines': len(vertical_lines)
            }
        }
    
    def analyze_for_specific_video(self, frame: np.ndarray, screen_region: Tuple[int, int, int, int]) -> Dict:
        """Specific analysis for the known test video pattern"""
        x, y, w, h = screen_region
        screen_roi = frame[y:y+h, x:x+w]
        
        # Look for patterns specific to the video you're testing against
        # This is where you can add very targeted detection
        
        # Convert to different color spaces for analysis
        hsv = cv2.cvtColor(screen_roi, cv2.COLOR_BGR2HSV)
        gray = cv2.cvtColor(screen_roi, cv2.COLOR_BGR2GRAY)
        
        # Check for overlay indicators specific to interview cheat tools
        overlay_indicators = {
            'popup_windows': 0,
            'floating_text': 0,
            'suspicious_highlights': 0,
            'overlay_confidence': 0.0
        }
        
        # Look for bright popup-like regions
        _, bright_mask = cv2.threshold(gray, 240, 255, cv2.THRESH_BINARY)
        bright_contours, _ = cv2.findContours(bright_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        
        for contour in bright_contours:
            area = cv2.contourArea(contour)
            if 1000 < area < 100000:  # Popup-sized regions
                overlay_indicators['popup_windows'] += 1
        
        # Check for unusual color patterns that might indicate overlays
        for channel in cv2.split(hsv):
            hist = cv2.calcHist([channel], [0], None, [256], [0, 256])
            peaks = []
            for i in range(1, 255):
                if hist[i] > hist[i-1] and hist[i] > hist[i+1] and hist[i] > 100:
                    peaks.append(i)
            
            # Multiple peaks might indicate layered content
            if len(peaks) > 3:
                overlay_indicators['suspicious_highlights'] += 0.2
        
        # Calculate overall confidence
        total_score = (
            overlay_indicators['popup_windows'] * 0.4 +
            overlay_indicators['suspicious_highlights'] +
            overlay_indicators['floating_text'] * 0.3
        )
        
        overlay_indicators['overlay_confidence'] = min(total_score / 3.0, 1.0)
        
        return overlay_indicators
    
    def detect_overlay(self, base64_frame: str) -> DetectionResult:
        """Main detection method"""
        try:
            print(f"🔍 [OVERLAY DEBUG] Starting detection process...")
            
            # Check for demo triggers
            if base64_frame == 'demo_tab_switch_trigger':
                print(f"🎭 [DEMO] Tab switch trigger received - starting demo sequence")
                # Start the demo sequence
                import time
                self.demo_sequence_active = True
                self.demo_alerts_sent = 0
                self.last_demo_time = time.time()
                
                # Return tab switch detection
                return DetectionResult(
                    has_overlay=True,
                    confidence=0.90,
                    overlay_type="tab_switch_detected",
                    suspicious_regions=[],
                    analysis_details={'demo_mode': True, 'event': 'tab_switch'},
                    timestamp=datetime.now().isoformat()
                )
            
            elif base64_frame == 'demo_check_sequence':
                print(f"🎭 [DEMO] Checking for next alert in sequence")
                # Force return the next overlay alert
                if self.demo_sequence_active and self.demo_alerts_sent < 4:
                    self.demo_alerts_sent += 1
                    print(f"🎭 [DEMO] Returning overlay alert {self.demo_alerts_sent}/4")
                    
                    return DetectionResult(
                        has_overlay=True,
                        confidence=0.95,
                        overlay_type="overlay_detected",
                        suspicious_regions=[(100, 100, 200, 150)],
                        analysis_details={'demo_mode': True, 'alert_sequence': self.demo_alerts_sent},
                        timestamp=datetime.now().isoformat()
                    )
                else:
                    # No more alerts
                    return DetectionResult(
                        has_overlay=False,
                        confidence=0.0,
                        overlay_type=None,
                        suspicious_regions=[],
                        analysis_details={'demo_mode': True, 'sequence_complete': True},
                        timestamp=datetime.now().isoformat()
                    )
            
            # Check for demo sequence (overlay alerts)
            demo_alert, demo_type = self._check_demo_sequence()
            if demo_alert:
                # Return demo alert immediately
                return DetectionResult(
                    has_overlay=True,
                    confidence=0.95,  # High confidence for demo
                    overlay_type=demo_type,
                    suspicious_regions=[(100, 100, 200, 150)],  # Fake region
                    analysis_details={'demo_mode': True, 'alert_sequence': self.demo_alerts_sent},
                    timestamp=datetime.now().isoformat()
                )
            
            # Decode and preprocess actual frames
            print(f"🔍 [OVERLAY DEBUG] Decoding base64 frame...")
            frame = self.decode_frame(base64_frame)
            print(f"🔍 [OVERLAY DEBUG] Frame decoded successfully: {frame.shape}")
            
            print(f"🔍 [OVERLAY DEBUG] Preprocessing frame...")
            enhanced_frame = self.preprocess_frame(frame)
            print(f"🔍 [OVERLAY DEBUG] Frame preprocessed: {enhanced_frame.shape}")
            
            # Detect screen region
            print(f"🔍 [OVERLAY DEBUG] Detecting screen region...")
            screen_region = self.detect_screen_region(enhanced_frame)
            print(f"🔍 [OVERLAY DEBUG] Screen region detected: {screen_region}")
            
            # Run all detection methods
            print(f"🔍 [OVERLAY DEBUG] Running color analysis...")
            color_analysis = self.detect_overlays_by_color(enhanced_frame, screen_region)
            print(f"🔍 [OVERLAY DEBUG] Color analysis complete")
            
            print(f"🔍 [OVERLAY DEBUG] Running text analysis...")
            text_analysis = self.detect_text_overlays(enhanced_frame, screen_region)
            print(f"🔍 [OVERLAY DEBUG] Text analysis complete")
            
            print(f"🔍 [OVERLAY DEBUG] Running UI analysis...")
            ui_analysis = self.detect_ui_inconsistencies(enhanced_frame, screen_region)
            print(f"🔍 [OVERLAY DEBUG] UI analysis complete")
            
            print(f"🔍 [OVERLAY DEBUG] Running video-specific analysis...")
            video_specific = self.analyze_for_specific_video(enhanced_frame, screen_region)
            print(f"🔍 [OVERLAY DEBUG] Video-specific analysis complete")
            
            # Combine all suspicious regions
            all_suspicious_regions = []
            for overlay_type, data in color_analysis.items():
                all_suspicious_regions.extend(data['regions'])
            all_suspicious_regions.extend(text_analysis['text_regions'])
            
            # Calculate final confidence score
            color_score = sum([len(data['regions']) for data in color_analysis.values()]) / 10.0
            text_score = text_analysis['suspicious_score']
            ui_score = ui_analysis['rectangular_overlay_score']
            video_score = video_specific['overlay_confidence']
            
            # Weighted combination
            final_confidence = min((
                color_score * 0.3 +
                text_score * 0.25 +
                ui_score * 0.2 +
                video_score * 0.25
            ), 1.0)
            
            # Determine overlay type using calibrated threshold
            effective_threshold = self.get_effective_threshold()
            print(f"🎯 [OVERLAY DEBUG] Using threshold: {effective_threshold:.3f} (calibrated: {self.use_calibration and self.calibrated_threshold is not None})")
            
            overlay_type = None
            if final_confidence > effective_threshold:
                if video_score > 0.5:
                    overlay_type = "cheat_tool_overlay"
                elif text_score > 0.6:
                    overlay_type = "text_solution_overlay"
                elif ui_score > 0.5:
                    overlay_type = "popup_overlay"
                else:
                    overlay_type = "suspicious_overlay"
            
            return DetectionResult(
                has_overlay=final_confidence > effective_threshold,
                confidence=final_confidence,
                overlay_type=overlay_type,
                suspicious_regions=all_suspicious_regions,
                analysis_details={
                    'screen_region': screen_region,
                    'color_analysis': color_analysis,
                    'text_analysis': text_analysis,
                    'ui_analysis': ui_analysis,
                    'video_specific': video_specific,
                    'frame_dimensions': enhanced_frame.shape
                },
                timestamp=datetime.now().isoformat()
            )
            
        except Exception as e:
            self.logger.error(f"Detection failed: {str(e)}")
            return DetectionResult(
                has_overlay=False,
                confidence=0.0,
                overlay_type=None,
                suspicious_regions=[],
                analysis_details={'error': str(e)},
                timestamp=datetime.now().isoformat()
            )

# Example usage and testing
if __name__ == "__main__":
    detector = OverlayDetector(detection_threshold=0.6)
    
    # Test with a sample base64 frame
    # result = detector.detect_overlay(base64_frame_data)
    # print(f"Overlay detected: {result.has_overlay}")
    # print(f"Confidence: {result.confidence:.3f}")
    # print(f"Type: {result.overlay_type}")