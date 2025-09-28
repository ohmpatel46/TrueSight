#!/usr/bin/env python3
"""
Calibration script for overlay detection
Run this to train the detector with your demo images
"""

import os
import sys
from overlay_calibration import OverlayCalibrator, calibrate_from_files

def main():
    print("🎯 Overlay Detection Calibration Tool")
    print("=" * 50)
    
    calibrator = OverlayCalibrator()
    
    print("\n📝 Instructions:")
    print("1. Place normal app screenshots in 'samples/normal/' folder")
    print("2. Place overlay/cheat screenshots in 'samples/cheat/' folder")
    print("3. This script will analyze them and set optimal threshold")
    
    # Create sample directories if they don't exist
    os.makedirs("samples/normal", exist_ok=True)
    os.makedirs("samples/cheat", exist_ok=True)
    
    # Check for sample images
    normal_dir = "samples/normal"
    cheat_dir = "samples/cheat"
    
    normal_files = [f for f in os.listdir(normal_dir) if f.lower().endswith(('.png', '.jpg', '.jpeg'))]
    cheat_files = [f for f in os.listdir(cheat_dir) if f.lower().endswith(('.png', '.jpg', '.jpeg'))]
    
    print(f"\n📂 Found samples:")
    print(f"   Normal: {len(normal_files)} images in {normal_dir}/")
    print(f"   Cheat:  {len(cheat_files)} images in {cheat_dir}/")
    
    if len(normal_files) == 0:
        print("\n❌ No normal samples found!")
        print(f"   Please add normal app screenshots to {normal_dir}/")
        return
    
    if len(cheat_files) == 0:
        print("\n❌ No cheat samples found!")
        print(f"   Please add overlay/cheat screenshots to {cheat_dir}/")
        return
    
    # Build full paths
    normal_paths = [os.path.join(normal_dir, f) for f in normal_files]
    cheat_paths = [os.path.join(cheat_dir, f) for f in cheat_files]
    
    print(f"\n🔄 Processing samples...")
    
    # Run calibration
    threshold = calibrate_from_files(normal_paths, cheat_paths)
    
    if threshold:
        print(f"\n✅ Calibration successful!")
        print(f"🎯 Optimal threshold: {threshold:.3f}")
        print(f"💾 Calibration data saved")
        print(f"\n🔄 Restart the ML service to use new calibration")
    else:
        print(f"\n❌ Calibration failed!")
        print(f"   The samples overlap too much - need clearer distinction")
        print(f"   Try adding more diverse samples")

if __name__ == "__main__":
    main()
