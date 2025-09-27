import React from 'react';

interface ControlsProps {
  roomName: string;
  setRoomName: (name: string) => void;
  signalingUrl: string;
  setSignalingUrl: (url: string) => void;
  isConnected: boolean;
  isLocalVideoEnabled: boolean;
  onJoinRoom: () => void;
  onLeaveRoom: () => void;
  onToggleLocalVideo: () => void;
}

const Controls: React.FC<ControlsProps> = ({
  roomName,
  setRoomName,
  signalingUrl,
  setSignalingUrl,
  isConnected,
  isLocalVideoEnabled,
  onJoinRoom,
  onLeaveRoom,
  onToggleLocalVideo
}) => {
  return (
    <div className="bg-white rounded-lg shadow-lg p-6">
      <h2 className="text-xl font-semibold mb-4">Controls</h2>
      
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Room Name
          </label>
          <input
            type="text"
            value={roomName}
            onChange={(e) => setRoomName(e.target.value)}
            placeholder="Enter room name"
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={isConnected}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Signaling URL
          </label>
          <input
            type="text"
            value={signalingUrl}
            onChange={(e) => setSignalingUrl(e.target.value)}
            placeholder="http://localhost:3001"
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={isConnected}
          />
        </div>

        <div className="flex space-x-2">
          {!isConnected ? (
            <button
              onClick={onJoinRoom}
              className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              Join Room
            </button>
          ) : (
            <button
              onClick={onLeaveRoom}
              className="flex-1 bg-red-600 text-white px-4 py-2 rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500"
            >
              Leave Room
            </button>
          )}
        </div>


        {isConnected && (
          <div>
            <button
              onClick={onToggleLocalVideo}
              className={`w-full px-4 py-2 rounded-md focus:outline-none focus:ring-2 ${
                isLocalVideoEnabled
                  ? 'bg-green-600 text-white hover:bg-green-700 focus:ring-green-500'
                  : 'bg-gray-600 text-white hover:bg-gray-700 focus:ring-gray-500'
              }`}
            >
              {isLocalVideoEnabled ? 'Disable Camera' : 'Enable Camera'}
            </button>
          </div>
        )}

        <div className="text-sm text-gray-600">
          <p>Status: {isConnected ? 'Connected' : 'Disconnected'}</p>
          {isConnected && (
            <p>Room: {roomName}</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default Controls;
