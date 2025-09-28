"""
Overlay Detection Calibration System
Train the overlay detector to distinguish between normal app pages and actual cheating overlays
"""

import cv2
import numpy as np
import base64
import os
import json
from typing import List, Dict, Tuple
from overlay_detection import OverlayDetector, DetectionResult

class OverlayCalibrator:
    def __init__(self):
        self.normal_samples = []  # Screenshots of normal app pages
        self.cheat_samples = []   # Screenshots with actual overlays
        self.baseline_features = {}
        self.calibration_file = "overlay_calibration_data.json"
        
    def add_normal_sample(self, base64_image: str, description: str = ""):
        """Add a sample of normal app page (should NOT trigger alerts)"""
        try:
            detector = OverlayDetector(detection_threshold=0.1)  # Low threshold for analysis
            result = detector.detect_overlay(base64_image)
            
            sample = {
                "description": description,
                "confidence": result.confidence,
                "analysis_details": result.analysis_details,
                "suspicious_regions": len(result.suspicious_regions)
            }
            
            self.normal_samples.append(sample)
            print(f"✅ Added normal sample: {description}")
            print(f"   Confidence: {result.confidence:.3f}")
            print(f"   Suspicious regions: {len(result.suspicious_regions)}")
            
        except Exception as e:
            print(f"❌ Error processing normal sample: {e}")
    
    def add_cheat_sample(self, base64_image: str, description: str = ""):
        """Add a sample with actual cheating overlay (should trigger alerts)"""
        try:
            detector = OverlayDetector(detection_threshold=0.1)  # Low threshold for analysis
            result = detector.detect_overlay(base64_image)
            
            sample = {
                "description": description,
                "confidence": result.confidence,
                "analysis_details": result.analysis_details,
                "suspicious_regions": len(result.suspicious_regions)
            }
            
            self.cheat_samples.append(sample)
            print(f"🚨 Added cheat sample: {description}")
            print(f"   Confidence: {result.confidence:.3f}")
            print(f"   Suspicious regions: {len(result.suspicious_regions)}")
            
        except Exception as e:
            print(f"❌ Error processing cheat sample: {e}")
    
    def analyze_samples(self):
        """Analyze all samples to find distinguishing features"""
        if not self.normal_samples or not self.cheat_samples:
            print("❌ Need both normal and cheat samples to analyze")
            return
        
        print("\n📊 CALIBRATION ANALYSIS")
        print("=" * 50)
        
        # Analyze normal samples
        normal_confidences = [s['confidence'] for s in self.normal_samples]
        normal_regions = [s['suspicious_regions'] for s in self.normal_samples]
        
        print(f"\n✅ NORMAL SAMPLES ({len(self.normal_samples)}):")
        print(f"   Confidence range: {min(normal_confidences):.3f} - {max(normal_confidences):.3f}")
        print(f"   Average confidence: {np.mean(normal_confidences):.3f}")
        print(f"   Suspicious regions: {min(normal_regions)} - {max(normal_regions)}")
        
        # Analyze cheat samples
        cheat_confidences = [s['confidence'] for s in self.cheat_samples]
        cheat_regions = [s['suspicious_regions'] for s in self.cheat_samples]
        
        print(f"\n🚨 CHEAT SAMPLES ({len(self.cheat_samples)}):")
        print(f"   Confidence range: {min(cheat_confidences):.3f} - {max(cheat_confidences):.3f}")
        print(f"   Average confidence: {cheat_confidences:.3f}")
        print(f"   Suspicious regions: {min(cheat_regions)} - {max(cheat_regions)}")
        
        # Find optimal threshold
        max_normal = max(normal_confidences)
        min_cheat = min(cheat_confidences)
        
        if max_normal < min_cheat:
            optimal_threshold = (max_normal + min_cheat) / 2
            print(f"\n🎯 RECOMMENDED THRESHOLD: {optimal_threshold:.3f}")
            print(f"   This should separate normal ({max_normal:.3f}) from cheat ({min_cheat:.3f})")
        else:
            print(f"\n⚠️ OVERLAP DETECTED!")
            print(f"   Max normal confidence: {max_normal:.3f}")
            print(f"   Min cheat confidence: {min_cheat:.3f}")
            print(f"   Need better features or more samples")
        
        # Detailed feature analysis
        self._analyze_detailed_features()
        
        return optimal_threshold if max_normal < min_cheat else None
    
    def _analyze_detailed_features(self):
        """Analyze specific features that distinguish normal from cheat samples"""
        print(f"\n🔍 DETAILED FEATURE ANALYSIS")
        print("-" * 30)
        
        # Analyze color patterns
        normal_color_data = []
        cheat_color_data = []
        
        for sample in self.normal_samples:
            if 'color_analysis' in sample['analysis_details']:
                color_analysis = sample['analysis_details']['color_analysis']
                total_regions = sum(len(data.get('regions', [])) for data in color_analysis.values())
                normal_color_data.append(total_regions)
        
        for sample in self.cheat_samples:
            if 'color_analysis' in sample['analysis_details']:
                color_analysis = sample['analysis_details']['color_analysis']
                total_regions = sum(len(data.get('regions', [])) for data in color_analysis.values())
                cheat_color_data.append(total_regions)
        
        if normal_color_data and cheat_color_data:
            print(f"Color pattern regions:")
            print(f"  Normal: avg={np.mean(normal_color_data):.1f}, max={max(normal_color_data)}")
            print(f"  Cheat:  avg={np.mean(cheat_color_data):.1f}, max={max(cheat_color_data)}")
        
        # Analyze text patterns
        normal_text_data = []
        cheat_text_data = []
        
        for sample in self.normal_samples:
            if 'text_analysis' in sample['analysis_details']:
                text_score = sample['analysis_details']['text_analysis'].get('suspicious_score', 0)
                normal_text_data.append(text_score)
        
        for sample in self.cheat_samples:
            if 'text_analysis' in sample['analysis_details']:
                text_score = sample['analysis_details']['text_analysis'].get('suspicious_score', 0)
                cheat_text_data.append(text_score)
        
        if normal_text_data and cheat_text_data:
            print(f"Text analysis scores:")
            print(f"  Normal: avg={np.mean(normal_text_data):.3f}, max={max(normal_text_data):.3f}")
            print(f"  Cheat:  avg={np.mean(cheat_text_data):.3f}, max={max(cheat_text_data):.3f}")
    
    def save_calibration(self, threshold: float):
        """Save calibration data to file"""
        calibration_data = {
            "threshold": threshold,
            "normal_samples_count": len(self.normal_samples),
            "cheat_samples_count": len(self.cheat_samples),
            "normal_samples": self.normal_samples,
            "cheat_samples": self.cheat_samples,
            "timestamp": str(np.datetime64('now'))
        }
        
        with open(self.calibration_file, 'w') as f:
            json.dump(calibration_data, f, indent=2)
        
        print(f"💾 Calibration saved to {self.calibration_file}")
    
    def load_calibration(self):
        """Load calibration data from file"""
        if os.path.exists(self.calibration_file):
            with open(self.calibration_file, 'r') as f:
                data = json.load(f)
            
            self.normal_samples = data.get('normal_samples', [])
            self.cheat_samples = data.get('cheat_samples', [])
            
            print(f"📂 Loaded calibration: {len(self.normal_samples)} normal, {len(self.cheat_samples)} cheat samples")
            return data.get('threshold')
        
        return None

# Helper functions for easy testing
def calibrate_from_files(normal_image_paths: List[str], cheat_image_paths: List[str]):
    """Calibrate from image files"""
    calibrator = OverlayCalibrator()
    
    # Load normal samples
    for path in normal_image_paths:
        try:
            with open(path, 'rb') as f:
                image_data = base64.b64encode(f.read()).decode()
            calibrator.add_normal_sample(image_data, f"Normal: {os.path.basename(path)}")
        except Exception as e:
            print(f"❌ Error loading {path}: {e}")
    
    # Load cheat samples
    for path in cheat_image_paths:
        try:
            with open(path, 'rb') as f:
                image_data = base64.b64encode(f.read()).decode()
            calibrator.add_cheat_sample(image_data, f"Cheat: {os.path.basename(path)}")
        except Exception as e:
            print(f"❌ Error loading {path}: {e}")
    
    # Analyze and get threshold
    threshold = calibrator.analyze_samples()
    if threshold:
        calibrator.save_calibration(threshold)
        return threshold
    
    return None

if __name__ == "__main__":
    print("🎯 Overlay Detection Calibration System")
    print("Add your sample images and run analysis...")
