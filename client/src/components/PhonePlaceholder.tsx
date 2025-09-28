import React from 'react';

interface PhonePlaceholderProps {
  isConnected: boolean;
  latestFrame?: string;
  role: 'interviewer' | 'interviewee-laptop' | null;
}

const PhonePlaceholder: React.FC<PhonePlaceholderProps> = ({ 
  isConnected, 
  latestFrame, 
  role 
}) => {
  return (
    <div className="bg-gray-100 rounded-lg p-4 border-2 border-dashed border-gray-300 min-h-[200px] flex flex-col items-center justify-center">
      <div className="text-center">
        <div className="text-4xl mb-2">📱</div>
        
        {isConnected ? (
          <div>
            <div className="text-green-600 font-medium mb-2">
              ✅ Phone Connected
            </div>
            
            {latestFrame ? (
              <div className="space-y-2">
                <div className="text-sm text-gray-600">
                  Latest Frame (2 FPS)
                </div>
                <img 
                  src={`data:image/jpeg;base64,${latestFrame}`}
                  alt="Phone camera feed"
                  className="max-w-full max-h-32 rounded border mx-auto"
                  onError={(e) => {
                    console.error('Failed to load phone frame');
                    e.currentTarget.style.display = 'none';
                  }}
                />
                <div className="text-xs text-gray-500">
                  {role === 'interviewer' ? 
                    'Monitoring for malpractice...' : 
                    'Frame processing active'
                  }
                </div>
              </div>
            ) : (
              <div className="text-sm text-gray-600">
                Waiting for frames...
              </div>
            )}
          </div>
        ) : (
          <div>
            <div className="text-gray-500 font-medium mb-2">
              📱 Phone Not Connected
            </div>
            <div className="text-sm text-gray-400">
              {role === 'interviewer' ? 
                'Waiting for interviewee phone...' :
                'Connect your phone to start monitoring'
              }
            </div>
          </div>
        )}
        
        {role === 'interviewer' && (
          <div className="mt-3 text-xs text-blue-600 bg-blue-50 p-2 rounded">
            💡 2D room projection will appear here later
          </div>
        )}
      </div>
    </div>
  );
};

export default PhonePlaceholder;
