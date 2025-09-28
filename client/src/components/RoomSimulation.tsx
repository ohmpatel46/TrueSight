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

// Dynamic FOV calculation based on phone frame analysis
const calculatePhoneFOV = (latestPhoneFrame?: string) => {
  // Simulate dynamic FOV based on phone movement/orientation
  // In real implementation, this would analyze the phone frame
  const baseAngle = 120; // Base 120 degrees
  const dynamicVariation = Math.sin(Date.now() / 2000) * 10; // ±10 degree variation
  return baseAngle + dynamicVariation;
};

// CSS-based room visualization with dynamic FOV
const CSSRoomView: React.FC<{ 
  isConnected: boolean;
  latestPhoneFrame?: string;
}> = ({ isConnected, latestPhoneFrame }) => {
  const [phoneFOV, setPhoneFOV] = useState(120);
  const [laptopFOV] = useState(90);

  // Update phone FOV dynamically
  useEffect(() => {
    if (!isConnected) return;
    
    const interval = setInterval(() => {
      const newFOV = calculatePhoneFOV(latestPhoneFrame);
      setPhoneFOV(newFOV);
      console.log('📱 [FOV UPDATE] Phone FOV:', newFOV.toFixed(1), '°');
    }, 500); // Update every 500ms

    return () => clearInterval(interval);
  }, [isConnected, latestPhoneFrame]);

  // Hardcoded positions (can be made dynamic later)
  const laptopPos = { x: 80, y: 50 }; // Far east, center north-south
  const phonePos = { x: 65, y: 65 }; // Southwest of laptop

  return (
    <div className="relative w-full h-full bg-gradient-to-br from-slate-800 to-slate-900">
      {/* Grid background */}
      <div className="absolute inset-0 opacity-20">
        <div className="w-full h-full" style={{
          backgroundImage: `
            linear-gradient(rgba(148, 163, 184, 0.1) 1px, transparent 1px),
            linear-gradient(90deg, rgba(148, 163, 184, 0.1) 1px, transparent 1px)
          `,
          backgroundSize: '20px 20px'
        }}></div>
      </div>

      {/* Room boundary */}
      <div className="absolute inset-4 border-2 border-slate-600 rounded-lg bg-slate-700/10">
        
        {/* Phone Field of Vision - 180° turn (now facing southeast) */}
        <div 
          className="absolute bg-emerald-400/20 border border-emerald-400/30 transition-all duration-500 ease-in-out"
          style={{
            left: `${phonePos.x - phoneFOV/12}%`,
            top: `${phonePos.y}%`,
            width: `${phoneFOV/4}%`,
            height: `${phoneFOV/4}%`,
            borderRadius: '50%',
            transform: 'rotate(60deg)', // 180° turn from northwest (-120° + 180° = 60°)
            clipPath: `polygon(50% 50%, 0% 0%, 100% 0%)` // Cone shape
          }}
        >
          <div className="absolute inset-0 animate-pulse bg-emerald-400/10 rounded-full"></div>
        </div>

        {/* Laptop Field of Vision - 180° turn (now facing eastward) */}
        <div 
          className="absolute bg-blue-400/15 border border-blue-400/30"
          style={{
            left: `${laptopPos.x}%`,
            top: `${laptopPos.y - laptopFOV/8}%`,
            width: `${laptopFOV/4}%`,
            height: `${laptopFOV/4}%`,
            borderRadius: '50%',
            transform: 'rotate(-90deg)', // 180° turn from west (90° + 180° = 270° = -90°)
            clipPath: `polygon(50% 50%, 0% 0%, 100% 0%)` // Cone shape facing east
          }}
        ></div>

        {/* Distance line */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none">
          <line
            x1={`${phonePos.x}%`}
            y1={`${phonePos.y}%`}
            x2={`${laptopPos.x}%`}
            y2={`${laptopPos.y}%`}
            stroke="#ef4444"
            strokeWidth="2"
            strokeDasharray="8,4"
            className="animate-pulse"
          />
          
          {/* Distance label */}
          <text
            x={`${(phonePos.x + laptopPos.x) / 2}%`}
            y={`${(phonePos.y + laptopPos.y) / 2 - 2}%`}
            fill="#ef4444"
            fontSize="12"
            textAnchor="middle"
            className="font-bold"
          >
            2.3m
          </text>
        </svg>

        {/* Phone position */}
        <div 
          className="absolute w-4 h-4 bg-emerald-400 rounded-full shadow-lg transform -translate-x-1/2 -translate-y-1/2 z-10"
          style={{ left: `${phonePos.x}%`, top: `${phonePos.y}%` }}
        >
          <div className="absolute inset-0 bg-emerald-400 rounded-full animate-ping opacity-75"></div>
          <div className="absolute -bottom-8 left-1/2 transform -translate-x-1/2 text-xs font-semibold text-emerald-300 whitespace-nowrap">
            📱 Phone
          </div>
          {/* FOV angle indicator */}
          <div className="absolute -top-6 left-1/2 transform -translate-x-1/2 text-xs text-emerald-300 font-mono">
            {phoneFOV.toFixed(0)}°
          </div>
        </div>

        {/* Laptop position */}
        <div 
          className="absolute w-4 h-4 bg-blue-400 rounded-full shadow-lg transform -translate-x-1/2 -translate-y-1/2 z-10"
          style={{ left: `${laptopPos.x}%`, top: `${laptopPos.y}%` }}
        >
          <div className="absolute inset-0 bg-blue-400 rounded-full animate-pulse opacity-75"></div>
          <div className="absolute -bottom-8 left-1/2 transform -translate-x-1/2 text-xs font-semibold text-blue-300 whitespace-nowrap">
            💻 Laptop
          </div>
          {/* FOV angle indicator */}
          <div className="absolute -top-6 left-1/2 transform -translate-x-1/2 text-xs text-blue-300 font-mono">
            {laptopFOV}°
          </div>
        </div>

        {/* Compass */}
        <div className="absolute top-2 left-1/2 transform -translate-x-1/2 text-xs text-slate-400 font-semibold">N</div>
        <div className="absolute bottom-2 left-1/2 transform -translate-x-1/2 text-xs text-slate-400 font-semibold">S</div>
        <div className="absolute left-2 top-1/2 transform -translate-y-1/2 text-xs text-slate-400 font-semibold">W</div>
        <div className="absolute right-2 top-1/2 transform -translate-y-1/2 text-xs text-slate-400 font-semibold">E</div>
      </div>
    </div>
  );
};

const RoomSimulation: React.FC<RoomSimulationProps & { latestPhoneFrame?: string }> = ({ 
  depthData, 
  isConnected, 
  latestPhoneFrame 
}) => {
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  // Debug logging
  console.log('🏠 [ROOM SIMULATION DEBUG]', {
    isConnected,
    depthData,
    latestPhoneFrame: latestPhoneFrame ? `${latestPhoneFrame.length} chars` : 'none',
    lastUpdate
  });

  useEffect(() => {
    if (latestPhoneFrame) {
      setLastUpdate(new Date());
    }
  }, [latestPhoneFrame]);

  // Calculate distance from hardcoded positions
  const distance = Math.sqrt(
    Math.pow(-0.2 - 0.5, 2) + Math.pow(2.2 - 0, 2)
  );
  const hasLaptop = true; // Always true since we're hardcoding

  console.log('🏠 [ROOM SIMULATION] Rendering component...', {
    isConnected,
    hasLaptop,
    distance,
    phoneFOVActive: !!latestPhoneFrame
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

      {/* Room Visualization */}
      <div className="h-64 bg-slate-900/60 border border-slate-600/50 rounded-xl overflow-hidden relative">
        <CSSRoomView isConnected={isConnected} latestPhoneFrame={latestPhoneFrame} />
        
        {!isConnected && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-900/80 text-slate-400">
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
