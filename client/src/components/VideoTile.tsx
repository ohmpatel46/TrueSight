import React, { useRef, useEffect } from 'react';

interface VideoTileProps {
  stream?: MediaStream;
  peerId: string;
  isLocal: boolean;
  isEnabled: boolean;
}

const VideoTile: React.FC<VideoTileProps> = ({ stream, peerId, isLocal, isEnabled }) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      console.log(`Setting video stream for ${peerId}:`, stream);
      console.log(`Stream tracks:`, stream.getTracks());
      videoRef.current.srcObject = stream;
      
      // Add event listeners to debug
      videoRef.current.onloadedmetadata = () => {
        console.log(`Video metadata loaded for ${peerId}`);
      };
      videoRef.current.oncanplay = () => {
        console.log(`Video can play for ${peerId}`);
      };
      videoRef.current.onerror = (e) => {
        console.error(`Video error for ${peerId}:`, e);
      };
    } else if (videoRef.current) {
      console.log(`No stream for ${peerId}`);
      videoRef.current.srcObject = null;
    }
  }, [stream, peerId]);

  return (
    <div className="relative bg-gray-900 rounded-lg overflow-hidden">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isLocal}
        className={`w-full h-32 sm:h-40 md:h-48 object-cover ${!isEnabled ? 'opacity-50' : ''}`}
      />
      
      {/* Debug info */}
      <div className="absolute top-2 left-2 bg-red-500 text-white px-2 py-1 rounded text-xs">
        {stream ? 'HAS STREAM' : 'NO STREAM'}
      </div>
      
      {!isEnabled && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-800 bg-opacity-75">
          <div className="text-white text-center">
            <div className="text-4xl mb-2">📹</div>
            <div className="text-sm">Camera Disabled</div>
          </div>
        </div>
      )}

      <div className="absolute bottom-2 left-2 bg-black bg-opacity-50 text-white px-2 py-1 rounded text-sm">
        {isLocal ? 'You' : `Peer ${peerId.slice(0, 8)}`}
      </div>

      {stream && (
        <div className="absolute top-2 right-2 flex space-x-1">
          {stream.getAudioTracks().length > 0 && (
            <div className="bg-green-500 text-white px-2 py-1 rounded text-xs">
              🎤 Audio
            </div>
          )}
          {stream.getVideoTracks().length > 0 && (
            <div className="bg-blue-500 text-white px-2 py-1 rounded text-xs">
              📹 Video
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default VideoTile;
