import React, { useState } from 'react';

interface LogEntry {
  timestamp: Date;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
}

interface EventLogProps {
  logs: LogEntry[];
}

const EventLog: React.FC<EventLogProps> = ({ logs }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const getLogColor = (type: LogEntry['type']) => {
    switch (type) {
      case 'success':
        return 'text-green-600';
      case 'warning':
        return 'text-yellow-600';
      case 'error':
        return 'text-red-600';
      default:
        return 'text-gray-600';
    }
  };

  const getLogIcon = (type: LogEntry['type']) => {
    switch (type) {
      case 'success':
        return '✅';
      case 'warning':
        return '⚠️';
      case 'error':
        return '❌';
      default:
        return 'ℹ️';
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-lg p-4">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-semibold">Event Log</h2>
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="lg:hidden text-gray-500 hover:text-gray-700"
        >
          {isExpanded ? '▼' : '▶'} {logs.length} events
        </button>
      </div>
      
      <div className={`${isExpanded ? 'block' : 'hidden lg:block'} h-64 overflow-y-auto border border-gray-200 rounded-md p-3 bg-gray-50`}>
        {logs.length === 0 ? (
          <p className="text-gray-500 text-center">No events yet...</p>
        ) : (
          <div className="space-y-2">
            {logs.map((log, index) => (
              <div key={index} className="flex items-start space-x-2 text-sm">
                <span className="flex-shrink-0">{getLogIcon(log.type)}</span>
                <span className="text-gray-500 flex-shrink-0">
                  {log.timestamp.toLocaleTimeString()}
                </span>
                <span className={`flex-1 ${getLogColor(log.type)}`}>
                  {log.message}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      
      {logs.length > 0 && (
        <div className="mt-2 text-xs text-gray-500 text-center lg:block hidden">
          Showing {logs.length} events
        </div>
      )}
    </div>
  );
};

export default EventLog;
