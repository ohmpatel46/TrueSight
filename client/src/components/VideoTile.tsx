import React, { useRef, useEffect } from 'react';

interface VideoTileProps {
  stream?: MediaStream;
  peerId: string;
  isLocal: boolean;
  isEnabled: boolean;
}

const VideoTile: React.FC<VideoTileProps> = ({ stream, peerId, isLocal, isEnabled }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const DEBUG_ENABLED = true;

  const debug = (...args: unknown[]) => {
    if (DEBUG_ENABLED) {
      // eslint-disable-next-line no-console
      console.log(`[VideoTile:${peerId}]`, ...args);
    }
  };

  useEffect(() => {
    const videoEl = videoRef.current;

    if (!videoEl) {
      return;
    }

    videoEl.setAttribute('playsinline', 'true');
    debug('useEffect triggered', {
      hasStream: !!stream,
      readyState: videoEl.readyState,
      muted: videoEl.muted,
      currentSrc: videoEl.currentSrc
    });

    if (stream) {
      debug('attach stream', {
        streamId: stream.id,
        videoTracks: stream.getVideoTracks().map(t => ({ id: t.id, readyState: t.readyState, enabled: t.enabled })),
        audioTracks: stream.getAudioTracks().map(t => ({ id: t.id, readyState: t.readyState, enabled: t.enabled }))
      });

      if (videoEl.srcObject !== stream) {
        videoEl.srcObject = stream;
        debug('srcObject set');
      }

      // Add event listeners to debug
      videoEl.onloadedmetadata = () => {
        debug('onloadedmetadata', { readyState: videoEl.readyState });
      };
      videoEl.oncanplay = () => {
        debug('oncanplay', { readyState: videoEl.readyState });
      };
      videoEl.onerror = (e) => {
        debug('onerror', e);
      };
      videoEl.onloadstart = () => {
        debug('onloadstart');
      };

      const playPromise = videoEl.play();
      if (playPromise && typeof playPromise.then === 'function') {
        playPromise.catch((err) => {
          debug('play() blocked', err);
          if (!isLocal && videoEl.muted === false) {
            videoEl.muted = true;
            debug('retry play with muted=true');
            videoEl.play().catch((retryErr) => {
              debug('retry play blocked', retryErr);
            });
          }
        });
      }
    } else {
      debug('detach stream');
      videoEl.srcObject = null;
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
      
      {/* Stream info */}
      {stream && (
        <div className="absolute top-2 right-2 bg-blue-500 text-white px-2 py-1 rounded text-xs">
          {stream.getVideoTracks().length}V {stream.getAudioTracks().length}A
        </div>
      )}
      
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
