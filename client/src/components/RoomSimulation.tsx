import React, { useRef, useEffect, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrthographicCamera, Text } from '@react-three/drei';
import * as THREE from 'three';

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

// Room boundary component
const RoomBoundary: React.FC<{ dimensions: { width: number; height: number; depth: number } }> = ({ dimensions }) => {
  const meshRef = useRef<THREE.Mesh>(null);

  return (
    <group>
      {/* Room outline (top-down view) */}
      <mesh position={[0, 0, 0]}>
        <planeGeometry args={[dimensions.depth * 2, dimensions.width * 2]} />
        <meshBasicMaterial color="#f0f0f0" transparent opacity={0.3} />
      </mesh>
      
      {/* Room border */}
      <lineSegments>
        <edgesGeometry args={[new THREE.PlaneGeometry(dimensions.depth * 2, dimensions.width * 2)]} />
        <lineBasicMaterial color="#333333" linewidth={2} />
      </lineSegments>
    </group>
  );
};

// Device marker component
const DeviceMarker: React.FC<{ 
  position: { x: number; y: number; z: number };
  type: 'phone' | 'laptop';
  isDetected: boolean;
}> = ({ position, type, isDetected }) => {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    if (meshRef.current && isDetected) {
      // Gentle pulsing animation for detected devices
      meshRef.current.scale.setScalar(1 + Math.sin(state.clock.elapsedTime * 2) * 0.1);
    }
  });

  const color = type === 'phone' ? '#4ade80' : '#3b82f6'; // Green for phone, blue for laptop
  const size = type === 'phone' ? 0.3 : 0.5;

  return (
    <group position={[position.z, position.x, 0]}>
      {/* Device marker */}
      <mesh ref={meshRef}>
        <circleGeometry args={[size, 16]} />
        <meshBasicMaterial 
          color={color} 
          transparent 
          opacity={isDetected ? 0.8 : 0.3}
        />
      </mesh>
      
      {/* Device label */}
      <Text
        position={[0, -size - 0.3, 0.01]}
        fontSize={0.2}
        color={isDetected ? '#333' : '#666'}
        anchorX="center"
        anchorY="middle"
      >
        {type === 'phone' ? '📱' : '💻'}
      </Text>
      
      {/* Distance indicator line (from phone to laptop) */}
      {type === 'laptop' && isDetected && (
        <line>
          <bufferGeometry attach="geometry">
            <bufferAttribute
              attach="attributes-position"
              array={new Float32Array([
                0, 0, 0,  // Phone position (origin)
                position.z, position.x, 0  // Laptop position
              ])}
              count={2}
              itemSize={3}
            />
          </bufferGeometry>
          <lineBasicMaterial color="#ff6b6b" linewidth={1} />
        </line>
      )}
    </group>
  );
};

// Main room simulation component
const RoomScene: React.FC<{ depthData?: DepthData }> = ({ depthData }) => {
  const roomDimensions = depthData?.room_dimensions || { width: 3, height: 2.5, depth: 4 };
  const phonePosition = depthData?.device_positions.phone || { x: 0, y: 0, z: 0 };
  const laptopPosition = depthData?.device_positions.laptop || { x: 0, y: 0, z: 1.5 };

  return (
    <>
      {/* Lighting */}
      <ambientLight intensity={0.6} />
      <pointLight position={[10, 10, 10]} />

      {/* Room boundary */}
      <RoomBoundary dimensions={roomDimensions} />

      {/* Device markers */}
      <DeviceMarker 
        position={phonePosition} 
        type="phone" 
        isDetected={true} // Phone is always at origin
      />
      <DeviceMarker 
        position={laptopPosition} 
        type="laptop" 
        isDetected={depthData?.laptop_screen_detected || false}
      />

      {/* Grid helper for reference */}
      <gridHelper args={[8, 8, '#cccccc', '#eeeeee']} rotation={[Math.PI / 2, 0, 0]} />
    </>
  );
};

const RoomSimulation: React.FC<RoomSimulationProps> = ({ depthData, isConnected }) => {
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  useEffect(() => {
    if (depthData) {
      setLastUpdate(new Date());
    }
  }, [depthData]);

  const distance = depthData?.phone_to_laptop_distance || 0;
  const hasLaptop = depthData?.laptop_screen_detected || false;

  return (
    <div className="bg-white rounded-lg shadow-lg p-4">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-semibold">🏠 Room Simulation</h2>
        <div className="flex gap-2">
          <div className={`px-2 py-1 rounded-full text-xs font-medium ${
            isConnected ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
          }`}>
            {isConnected ? '🟢 Connected' : '🔴 Disconnected'}
          </div>
          {depthData?.depth_map_available && (
            <div className="px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
              📊 Depth Active
            </div>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 mb-4 text-sm">
        <div className="bg-gray-50 p-3 rounded-lg">
          <div className="font-medium text-gray-700">Distance</div>
          <div className="text-lg font-bold text-blue-600">
            {distance > 0 ? `${distance.toFixed(1)}m` : '--'}
          </div>
        </div>
        <div className="bg-gray-50 p-3 rounded-lg">
          <div className="font-medium text-gray-700">Laptop</div>
          <div className="text-lg font-bold">
            {hasLaptop ? '✅ Detected' : '❌ Not Found'}
          </div>
        </div>
      </div>

      {/* 3D Visualization */}
      <div className="h-64 bg-gray-100 rounded-lg overflow-hidden border">
        {isConnected ? (
          <Canvas>
            <OrthographicCamera makeDefault position={[0, 0, 10]} zoom={50} />
            <RoomScene depthData={depthData} />
          </Canvas>
        ) : (
          <div className="flex items-center justify-center h-full text-gray-500">
            <div className="text-center">
              <div className="text-4xl mb-2">🏠</div>
              <div>Waiting for connection...</div>
            </div>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex justify-between items-center mt-4 text-xs text-gray-600">
        <div className="flex gap-4">
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 bg-green-400 rounded-full"></div>
            <span>📱 Phone</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 bg-blue-400 rounded-full"></div>
            <span>💻 Laptop</span>
          </div>
        </div>
        {lastUpdate && (
          <div>Updated: {lastUpdate.toLocaleTimeString()}</div>
        )}
      </div>

      {/* Debug info (remove in production) */}
      {depthData && (
        <details className="mt-4">
          <summary className="text-xs text-gray-500 cursor-pointer">Debug Info</summary>
          <pre className="text-xs bg-gray-100 p-2 rounded mt-2 overflow-auto">
            {JSON.stringify(depthData, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
};

export default RoomSimulation;
