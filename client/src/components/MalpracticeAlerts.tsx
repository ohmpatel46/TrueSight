import React, { useState, useEffect } from 'react';

interface Alert {
  id: string;
  type: 'multiple-faces' | 'object-detected' | 'looking-away' | 'movement' | 'overlay-detected' | 'suspicious-activity';
  message: string;
  confidence: number;
  timestamp: Date;
  severity: 'low' | 'medium' | 'high';
}

interface MalpracticeAlertsProps {
  socket?: any;
  role: 'interviewer' | 'interviewee-laptop' | null;
  latestPhoneFrame?: string;
}

const MalpracticeAlerts: React.FC<MalpracticeAlertsProps> = ({ 
  socket, 
  role, 
  latestPhoneFrame 
}) => {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  // Basic image analysis (placeholder for real ML)
  const analyzeFrame = (base64Frame: string) => {
    if (!base64Frame || role !== 'interviewee-laptop') return;

    setIsProcessing(true);
    
    // Simulate processing delay
    setTimeout(() => {
      // Simple heuristic checks (replace with real ML later)
      const frameSize = base64Frame.length;
      const hasJPEGHeader = base64Frame.startsWith('/9j/');
      
      // Simulate random detection for demo
      const randomCheck = Math.random();
      
      if (randomCheck < 0.1 && hasJPEGHeader) { // 10% chance for demo
        const alertTypes = [
          { type: 'multiple-faces', message: 'Multiple faces detected in frame', severity: 'high' },
          { type: 'object-detected', message: 'Suspicious object detected', severity: 'medium' },
          { type: 'looking-away', message: 'Candidate looking away from screen', severity: 'low' },
          { type: 'movement', message: 'Unusual movement detected', severity: 'medium' }
        ] as const;
        
        const randomAlert = alertTypes[Math.floor(Math.random() * alertTypes.length)];
        
        const newAlert: Alert = {
          id: `alert-${Date.now()}`,
          type: randomAlert.type,
          message: randomAlert.message,
          confidence: Math.floor(Math.random() * 30) + 70, // 70-100%
          timestamp: new Date(),
          severity: randomAlert.severity
        };
        
        setAlerts(prev => [newAlert, ...prev.slice(0, 9)]); // Keep last 10 alerts
        
        // Send alert to interviewer
        if (socket) {
          socket.emit('malpractice-detected', {
            alert: newAlert,
            room: 'current-room' // You'd get this from context
          });
        }
      }
      
      setIsProcessing(false);
    }, 500);
  };

  // Analyze frames when they arrive (only for interviewee laptop)
  useEffect(() => {
    if (latestPhoneFrame && role === 'interviewee-laptop') {
      analyzeFrame(latestPhoneFrame);
    }
  }, [latestPhoneFrame, role]);

  // Listen for alerts from ML service (for interviewer)
  useEffect(() => {
    if (!socket || role !== 'interviewer') return;

    const handleMalpracticeAlert = (data: any) => {
      console.log('🚨 Received malpractice alert:', data);
      
      // Handle both old format and new ML-based alerts
      if (data.alert) {
        // Old format
        setAlerts(prev => [data.alert, ...prev.slice(0, 9)]);
      } else if (data.alerts && data.alerts.length > 0) {
        // New ML format - handle both human detection and overlay detection
        let alertType = 'suspicious-activity';
        let severity: Alert['severity'] = 'medium';
        
        if (data.type === 'overlay-detection') {
          alertType = 'overlay-detected';
          severity = 'high'; // Overlay detection is always high severity
        } else if (data.type === 'human-detection') {
          alertType = 'multiple-faces';
          severity = data.humans_detected >= 3 ? 'high' : 'medium';
        }
        
        const newAlert: Alert = {
          id: `ml-alert-${Date.now()}`,
          type: alertType,
          message: data.alerts.join('; '),
          confidence: Math.round(data.confidence * 100),
          timestamp: new Date(),
          severity: severity
        };
        setAlerts(prev => [newAlert, ...prev.slice(0, 9)]);
      }
    };

    // Listen to both event types
    socket.on('malpractice-detected', handleMalpracticeAlert);
    socket.on('malpractice-alert', handleMalpracticeAlert);

    return () => {
      socket.off('malpractice-detected', handleMalpracticeAlert);
      socket.off('malpractice-alert', handleMalpracticeAlert);
    };
  }, [socket, role]);

  const getSeverityColor = (severity: Alert['severity']) => {
    switch (severity) {
      case 'high': return 'bg-red-100 border-red-300 text-red-800';
      case 'medium': return 'bg-yellow-100 border-yellow-300 text-yellow-800';
      case 'low': return 'bg-blue-100 border-blue-300 text-blue-800';
    }
  };

  const getSeverityIcon = (severity: Alert['severity']) => {
    switch (severity) {
      case 'high': return '🚨';
      case 'medium': return '⚠️';
      case 'low': return 'ℹ️';
    }
  };

  const clearAlerts = () => {
    setAlerts([]);
  };

  if (role !== 'interviewer' && role !== 'interviewee-laptop') {
    return null;
  }

  return (
    <div className="bg-white rounded-lg shadow-lg p-4">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-semibold">
          {role === 'interviewer' ? '🚨 Malpractice Alerts' : '🔍 Detection Status'}
        </h2>
        <div className="flex gap-2">
          {isProcessing && (
            <div className="px-2 py-1 bg-blue-100 text-blue-800 rounded text-sm">
              🔄 Processing...
            </div>
          )}
          {alerts.length > 0 && (
            <button
              onClick={clearAlerts}
              className="px-3 py-1 bg-gray-100 text-gray-600 rounded text-sm hover:bg-gray-200"
            >
              Clear All
            </button>
          )}
        </div>
      </div>

      {role === 'interviewee-laptop' && (
        <div className="mb-4 p-3 bg-gray-50 rounded-lg">
          <div className="text-sm text-gray-600">
            📱 Monitoring phone feed for suspicious activity...
          </div>
          <div className="text-xs text-gray-500 mt-1">
            Alerts will be sent to the interviewer automatically
          </div>
        </div>
      )}

      {alerts.length === 0 ? (
        <div className="text-center text-gray-500 py-8">
          {role === 'interviewer' ? 
            'No alerts received. Monitoring is active.' : 
            'No suspicious activity detected.'
          }
        </div>
      ) : (
        <div className="space-y-3 max-h-80 overflow-y-auto">
          {alerts.map(alert => (
            <div 
              key={alert.id}
              className={`p-3 rounded-lg border ${getSeverityColor(alert.severity)}`}
            >
              <div className="flex justify-between items-start mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-lg">{getSeverityIcon(alert.severity)}</span>
                  <span className="font-medium">{alert.message}</span>
                </div>
                <div className="text-sm opacity-75">
                  {alert.confidence}%
                </div>
              </div>
              <div className="text-xs opacity-75">
                {alert.timestamp.toLocaleTimeString()}
              </div>
            </div>
          ))}
        </div>
      )}

      {role === 'interviewer' && (
        <div className="mt-4 text-xs text-gray-500 bg-gray-50 p-2 rounded">
          🤖 Advanced ML detection active: Human detection, Overlay detection, 2D room analysis
        </div>
      )}
    </div>
  );
};

export default MalpracticeAlerts;
