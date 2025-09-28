import React, { useRef, useEffect, useState } from 'react';

interface DepthData {
  depth_map_available: boolean;
  laptop_screen_detected: boolean;
  phone_to_laptop_distance: number;
  wall_boundaries: number[][];
  room_dimensions: {
    width: number;
    height: number;
    depth: number;
  };
  device_positions: {
    phone: { x: number; y: number; z: number };
    laptop: { x: number; y: number; z: number };
  };
  processing_time_ms: number;
}

interface RoomSimulationProps {
  depthData?: DepthData;
  isConnected: boolean;
}

// Canvas-based 2D room visualization
const CanvasRoomView: React.FC<{ 
  depthData?: DepthData;
  canvasRef: React.RefObject<HTMLCanvasElement>;
}> = ({ depthData, canvasRef }) => {
  useEffect(() => {
    console.log('🎨 [CANVAS DEBUG] CanvasRoomView useEffect triggered', {
      canvas: canvasRef.current,
      depthData
    });

    const canvas = canvasRef.current;
    if (!canvas) {
      console.log('❌ [CANVAS DEBUG] No canvas element found');
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      console.log('❌ [CANVAS DEBUG] No 2D context available');
      return;
    }

    console.log('✅ [CANVAS DEBUG] Starting canvas drawing...');

    // Set canvas size
    const rect = canvas.getBoundingClientRect();
    console.log('📐 [CANVAS DEBUG] Canvas dimensions:', {
      rectWidth: rect.width,
      rectHeight: rect.height,
      canvasWidth: rect.width * 2,
      canvasHeight: rect.height * 2
    });
    
    canvas.width = rect.width * 2; // High DPI
    canvas.height = rect.height * 2;
    ctx.scale(2, 2);

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    console.log('🧹 [CANVAS DEBUG] Canvas cleared');

    // Hardcoded room dimensions and positions for demo
    const roomDimensions = { width: 4, height: 3, depth: 5 };
    const phonePosition = { x: 0.5, y: 0, z: 0 }; // Phone slightly to the right
    const laptopPosition = { x: -0.2, y: 0, z: 2.2 }; // Laptop in front of phone

    // Canvas dimensions
    const canvasWidth = rect.width;
    const canvasHeight = rect.height;
    const centerX = canvasWidth / 2;
    const centerY = canvasHeight / 2;

    // Scale factor for room
    const scale = Math.min(canvasWidth, canvasHeight) / Math.max(roomDimensions.depth, roomDimensions.width) * 0.6;

    // Draw grid
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 0.5;
    for (let i = -5; i <= 5; i++) {
      const x = centerX + i * scale * 0.5;
      const y = centerY + i * scale * 0.5;
      
      if (x >= 0 && x <= canvasWidth) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvasHeight);
        ctx.stroke();
      }
      
      if (y >= 0 && y <= canvasHeight) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvasWidth, y);
        ctx.stroke();
      }
    }

    // Draw room boundary
    const roomWidth = roomDimensions.width * scale;
    const roomDepth = roomDimensions.depth * scale;
    const roomX = centerX - roomDepth / 2;
    const roomY = centerY - roomWidth / 2;

    ctx.strokeStyle = '#374151';
    ctx.lineWidth = 2;
    ctx.fillStyle = 'rgba(243, 244, 246, 0.3)';
    ctx.fillRect(roomX, roomY, roomDepth, roomWidth);
    ctx.strokeRect(roomX, roomY, roomDepth, roomWidth);

    // Calculate device positions on canvas
    const phoneX = centerX + (phonePosition.x * scale);
    const phoneY = centerY + (phonePosition.z * scale);
    const laptopX = centerX + (laptopPosition.x * scale);
    const laptopY = centerY + (laptopPosition.z * scale);

    // Draw field of vision for phone camera (wider angle, facing forward)
    ctx.save();
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = '#10b981'; // Green tint for phone FOV
    ctx.beginPath();
    ctx.moveTo(phoneX, phoneY);
    // Phone camera FOV - 120 degree cone facing forward (negative Z direction)
    const phoneFovAngle = Math.PI * 2 / 3; // 120 degrees
    const phoneFovDistance = scale * 3; // 3 meters range
    ctx.arc(phoneX, phoneY, phoneFovDistance, -phoneFovAngle/2 - Math.PI/2, phoneFovAngle/2 - Math.PI/2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Draw field of vision for laptop camera (90 degrees, facing user)
    ctx.save();
    ctx.globalAlpha = 0.15;
    ctx.fillStyle = '#3b82f6'; // Blue tint for laptop FOV
    ctx.beginPath();
    ctx.moveTo(laptopX, laptopY);
    // Laptop camera FOV - 90 degree cone facing backward (positive Z direction)
    const laptopFovAngle = Math.PI / 2; // 90 degrees
    const laptopFovDistance = scale * 2; // 2 meters range
    ctx.arc(laptopX, laptopY, laptopFovDistance, laptopFovAngle/2 + Math.PI/2, -laptopFovAngle/2 + Math.PI/2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Draw phone position
    ctx.fillStyle = '#10b981'; // Green
    ctx.beginPath();
    ctx.arc(phoneX, phoneY, 8, 0, 2 * Math.PI);
    ctx.fill();
    
    // Phone label
    ctx.fillStyle = '#065f46';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('📱 Phone', phoneX, phoneY + 25);

    // Draw laptop position (always show since we're hardcoding)
    // Animate laptop marker with pulsing effect
    const pulseRadius = 12 + Math.sin(Date.now() / 500) * 2;
    
    ctx.fillStyle = '#3b82f6'; // Blue
    ctx.beginPath();
    ctx.arc(laptopX, laptopY, pulseRadius, 0, 2 * Math.PI);
    ctx.fill();
    
    // Laptop label
    ctx.fillStyle = '#1e40af';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('💻 Laptop', laptopX, laptopY + 30);

    // Draw distance line
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(phoneX, phoneY);
    ctx.lineTo(laptopX, laptopY);
    ctx.stroke();
    ctx.setLineDash([]); // Reset dash

    // Distance label (calculate distance between hardcoded positions)
    const midX = (phoneX + laptopX) / 2;
    const midY = (phoneY + laptopY) / 2;
    const distance = Math.sqrt(
      Math.pow(laptopPosition.x - phonePosition.x, 2) + 
      Math.pow(laptopPosition.z - phonePosition.z, 2)
    );
    
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(midX - 25, midY - 10, 50, 20);
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 1;
    ctx.strokeRect(midX - 25, midY - 10, 50, 20);
    
    ctx.fillStyle = '#ef4444';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${distance.toFixed(1)}m`, midX, midY + 3);

    // Draw compass
    ctx.fillStyle = '#6b7280';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('N', centerX, 15);
    ctx.fillText('S', centerX, canvasHeight - 5);
    ctx.textAlign = 'left';
    ctx.fillText('W', 5, centerY);
    ctx.textAlign = 'right';
    ctx.fillText('E', canvasWidth - 5, centerY);

    console.log('🎨 [CANVAS DEBUG] Drawing complete!', {
      roomDimensions,
      phonePosition,
      laptopPosition,
      distance: Math.sqrt(Math.pow(-0.2 - 0.5, 2) + Math.pow(2.2 - 0, 2))
    });

  }, []); // Remove depthData dependency since we're using hardcoded values

  return null;
};

const RoomSimulation: React.FC<RoomSimulationProps> = ({ depthData, isConnected }) => {
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Debug logging
  console.log('🏠 [ROOM SIMULATION DEBUG]', {
    isConnected,
    depthData,
    canvasRef: canvasRef.current,
    lastUpdate
  });

  useEffect(() => {
    if (depthData) {
      setLastUpdate(new Date());
    }
  }, [depthData]);

  // Animation loop for smooth updates
  useEffect(() => {
    let animationFrame: number;
    
    const animate = () => {
      // Trigger canvas redraw for animations
      if (canvasRef.current) {
        const canvas = canvasRef.current;
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * 2;
        canvas.height = rect.height * 2;
        
        // Re-render with animation
        const event = new CustomEvent('redraw');
        canvas.dispatchEvent(event);
      }
      
      animationFrame = requestAnimationFrame(animate);
    };

    if (isConnected) {
      animate();
    }

    return () => {
      if (animationFrame) {
        cancelAnimationFrame(animationFrame);
      }
    };
  }, [isConnected, depthData]);

  // Calculate distance from hardcoded positions
  const distance = Math.sqrt(
    Math.pow(-0.2 - 0.5, 2) + Math.pow(2.2 - 0, 2)
  );
  const hasLaptop = true; // Always true since we're hardcoding

  console.log('🏠 [ROOM SIMULATION] Rendering component...', {
    isConnected,
    hasLaptop,
    distance,
    canvasRef: canvasRef.current
  });

  return (
    <div className="bg-slate-800/40 backdrop-blur-xl border border-slate-700/50 rounded-2xl p-6 shadow-2xl shadow-slate-900/50">
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center">
            <span className="text-white text-lg">🏠</span>
          </div>
          <h2 className="text-xl font-bold text-slate-100">Room Analysis</h2>
        </div>
        <div className="flex gap-2">
          <div className={`px-3 py-1 rounded-xl text-xs font-semibold border ${
            isConnected 
              ? 'bg-emerald-500/10 border-emerald-400/30 text-emerald-300' 
              : 'bg-gray-500/10 border-gray-400/30 text-gray-400'
          }`}>
            {isConnected ? '🟢 Active' : '⭕ Inactive'}
          </div>
          <div className="px-3 py-1 rounded-xl text-xs font-semibold bg-purple-500/10 border border-purple-400/30 text-purple-300">
            🎯 Demo Mode
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-slate-700/40 border border-slate-600/50 p-4 rounded-xl">
          <div className="text-slate-400 text-sm font-medium mb-1">Distance</div>
          <div className="text-2xl font-bold text-slate-100">
            {distance > 0 ? `${distance.toFixed(1)}m` : '--'}
          </div>
        </div>
        <div className="bg-slate-700/40 border border-slate-600/50 p-4 rounded-xl">
          <div className="text-slate-400 text-sm font-medium mb-1">Laptop Status</div>
          <div className="text-lg font-bold">
            {hasLaptop ? (
              <span className="text-emerald-400">✅ Detected</span>
            ) : (
              <span className="text-amber-400">🔍 Searching</span>
            )}
          </div>
        </div>
      </div>

      {/* Canvas Visualization */}
      <div className="h-64 bg-slate-900/60 border border-slate-600/50 rounded-xl overflow-hidden relative">
        {isConnected ? (
          <>
            <canvas 
              ref={canvasRef}
              className="w-full h-full"
              style={{ imageRendering: 'pixelated' }}
            />
            <CanvasRoomView depthData={depthData} canvasRef={canvasRef} />
          </>
        ) : (
          <div className="flex items-center justify-center h-full text-slate-400">
            <div className="text-center">
              <div className="text-4xl mb-3 opacity-50">🏠</div>
              <div className="text-lg font-medium">Waiting for connection...</div>
              <div className="text-sm mt-1 opacity-70">Connect your phone to start room analysis</div>
            </div>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex justify-between items-center mt-6 pt-4 border-t border-slate-700/50">
        <div className="flex gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-emerald-400 rounded-full"></div>
            <span className="text-slate-300 text-sm">📱 Phone</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-blue-400 rounded-full"></div>
            <span className="text-slate-300 text-sm">💻 Laptop</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-1 bg-red-400 rounded-full"></div>
            <span className="text-slate-300 text-sm">Distance</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-emerald-400 rounded-full opacity-30"></div>
            <span className="text-slate-300 text-sm">📱 FOV</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-blue-400 rounded-full opacity-30"></div>
            <span className="text-slate-300 text-sm">💻 FOV</span>
          </div>
        </div>
        {lastUpdate && (
          <div className="text-slate-400 text-xs">
            Updated: {lastUpdate.toLocaleTimeString()}
          </div>
        )}
      </div>

      {/* Debug info (remove in production) */}
      {depthData && (
        <details className="mt-4">
          <summary className="text-xs text-slate-400 cursor-pointer hover:text-slate-300">
            Debug Information
          </summary>
          <pre className="text-xs bg-slate-900/60 border border-slate-600/50 p-3 rounded-lg mt-2 overflow-auto text-slate-300">
            {JSON.stringify(depthData, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
};

export default RoomSimulation;
