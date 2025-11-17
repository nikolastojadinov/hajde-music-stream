import { useState, useEffect, useRef } from 'react';

interface LogEntry {
  id: number;
  timestamp: string;
  level: 'log' | 'warn' | 'error' | 'info';
  message: string;
  data?: any;
}

export default function DebugFloatingLogger() {
  const [isOpen, setIsOpen] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const logIdCounter = useRef(0);

  useEffect(() => {
    // Store original console methods
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;
    const originalInfo = console.info;

    // Helper to create log entry
    const createLogEntry = (level: LogEntry['level'], args: any[]): LogEntry => {
      const timestamp = new Date().toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });

      let message = '';
      let data: any = undefined;

      try {
        if (args.length === 1) {
          if (typeof args[0] === 'string') {
            message = args[0];
          } else {
            message = JSON.stringify(args[0], null, 2);
            data = args[0];
          }
        } else {
          message = args
            .map((arg) => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg)))
            .join(' ');
          data = args.length > 1 ? args : args[0];
        }
      } catch (err) {
        message = String(args[0] || '');
      }

      return {
        id: logIdCounter.current++,
        timestamp,
        level,
        message,
        data,
      };
    };

    // Intercept console.log
    console.log = (...args: any[]) => {
      originalLog(...args);
      setLogs((prev) => [...prev, createLogEntry('log', args)]);
    };

    // Intercept console.warn
    console.warn = (...args: any[]) => {
      originalWarn(...args);
      setLogs((prev) => [...prev, createLogEntry('warn', args)]);
    };

    // Intercept console.error
    console.error = (...args: any[]) => {
      originalError(...args);
      setLogs((prev) => [...prev, createLogEntry('error', args)]);
    };

    // Intercept console.info
    console.info = (...args: any[]) => {
      originalInfo(...args);
      setLogs((prev) => [...prev, createLogEntry('info', args)]);
    };

    // Cleanup: restore original console methods
    return () => {
      console.log = originalLog;
      console.warn = originalWarn;
      console.error = originalError;
      console.info = originalInfo;
    };
  }, []);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (isOpen && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, isOpen]);

  const clearLogs = () => {
    setLogs([]);
  };

  const getLevelColor = (level: LogEntry['level']): string => {
    switch (level) {
      case 'error':
        return 'text-red-400';
      case 'warn':
        return 'text-yellow-400';
      case 'info':
        return 'text-blue-400';
      default:
        return 'text-gray-300';
    }
  };

  const getLevelBadge = (level: LogEntry['level']): string => {
    switch (level) {
      case 'error':
        return 'bg-red-500/20 text-red-300';
      case 'warn':
        return 'bg-yellow-500/20 text-yellow-300';
      case 'info':
        return 'bg-blue-500/20 text-blue-300';
      default:
        return 'bg-gray-500/20 text-gray-300';
    }
  };

  return (
    <>
      {/* Floating Debug Button (always visible) */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-6 right-6 w-14 h-14 rounded-full bg-gradient-to-br from-purple-600 to-blue-600 shadow-2xl flex items-center justify-center hover:scale-110 active:scale-95 transition-transform"
        style={{ zIndex: 999999 }}
        aria-label="Toggle Debug Logger"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-6 w-6 text-white"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
          />
        </svg>
        
        {/* Notification Badge */}
        {logs.length > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full w-6 h-6 flex items-center justify-center">
            {logs.length > 99 ? '99+' : logs.length}
          </span>
        )}
      </button>

      {/* Debug Panel */}
      {isOpen && (
        <div
          className="fixed inset-0 flex items-end justify-end p-4 pointer-events-none"
          style={{ zIndex: 999998 }}
        >
          <div className="w-full max-w-2xl h-[600px] bg-black/95 backdrop-blur-lg rounded-2xl shadow-2xl border border-white/10 flex flex-col pointer-events-auto overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-white/10 bg-gradient-to-r from-purple-900/50 to-blue-900/50">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full bg-green-500 animate-pulse" />
                <h2 className="text-white font-semibold text-lg">Debug Console</h2>
                <span className="text-xs text-gray-400 bg-white/5 px-2 py-1 rounded">
                  {logs.length} logs
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={clearLogs}
                  className="px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-300 text-sm rounded-lg transition-colors"
                >
                  Clear
                </button>
                <button
                  onClick={() => setIsOpen(false)}
                  className="w-8 h-8 flex items-center justify-center hover:bg-white/10 rounded-lg transition-colors"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-5 w-5 text-gray-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>
            </div>

            {/* Logs Container */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2 scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent">
              {logs.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-gray-500">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-16 w-16 mb-4 opacity-30"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1}
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>
                  <p className="text-sm">No logs yet. Start using the app to see console output.</p>
                </div>
              ) : (
                logs.map((log) => (
                  <div
                    key={log.id}
                    className="bg-white/5 hover:bg-white/10 rounded-lg p-3 transition-colors border border-white/5"
                  >
                    <div className="flex items-start gap-3">
                      {/* Timestamp & Level Badge */}
                      <div className="flex flex-col gap-1 flex-shrink-0">
                        <span className="text-xs text-gray-500 font-mono">{log.timestamp}</span>
                        <span
                          className={`text-xs font-semibold px-2 py-0.5 rounded ${getLevelBadge(
                            log.level
                          )}`}
                        >
                          {log.level.toUpperCase()}
                        </span>
                      </div>

                      {/* Log Message */}
                      <div className="flex-1 min-w-0">
                        <pre
                          className={`text-sm font-mono whitespace-pre-wrap break-words ${getLevelColor(
                            log.level
                          )}`}
                        >
                          {log.message}
                        </pre>
                      </div>
                    </div>
                  </div>
                ))
              )}
              <div ref={logsEndRef} />
            </div>

            {/* Footer */}
            <div className="p-3 border-t border-white/10 bg-black/50">
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>Real-time console monitoring</span>
                <span>
                  {logs.filter((l) => l.level === 'error').length} errors •{' '}
                  {logs.filter((l) => l.level === 'warn').length} warnings
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
