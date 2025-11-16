import React, { useState, useEffect, useRef } from 'react';

type LogEntry = {
  type: 'log' | 'warn' | 'error';
  timestamp: number;
  args: any[];
};

const debugLogs: LogEntry[] = [];
const maxLogs = 500;
const listeners = new Set<(logs: LogEntry[]) => void>();

// Override console methods
const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;

const addLog = (type: 'log' | 'warn' | 'error', args: any[]) => {
  debugLogs.push({ type, timestamp: Date.now(), args });
  if (debugLogs.length > maxLogs) {
    debugLogs.shift();
  }
  listeners.forEach(listener => listener([...debugLogs]));
};

console.log = (...args: any[]) => {
  originalLog(...args);
  addLog('log', args);
};

console.warn = (...args: any[]) => {
  originalWarn(...args);
  addLog('warn', args);
};

console.error = (...args: any[]) => {
  originalError(...args);
  addLog('error', args);
};

export function DebugWheel() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bg-primary/90 hover:bg-primary rounded-full p-4 shadow-2xl transition-all hover:scale-110 backdrop-blur-sm border-2 border-white/20"
        style={{ 
          zIndex: 99999,
          bottom: 'calc(5rem + 80px)', // Above player on mobile
          right: '16px'
        }}
        aria-label="Debug Console"
        title="Open Debug Console"
      >
        <span className="text-2xl">🐛</span>
      </button>
      {isOpen && <DebugConsoleOverlay onClose={() => setIsOpen(false)} />}
    </>
  );
}

export function DebugConsoleOverlay({ onClose }: { onClose: () => void }) {
  const [logs, setLogs] = useState<LogEntry[]>([...debugLogs]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const listener = (newLogs: LogEntry[]) => setLogs(newLogs);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  const formatArgs = (args: any[]): string => {
    return args
      .map(arg => {
        if (typeof arg === 'object') {
          try {
            return JSON.stringify(arg, null, 2);
          } catch {
            return String(arg);
          }
        }
        return String(arg);
      })
      .join(' ');
  };

  const getLogColor = (type: 'log' | 'warn' | 'error'): string => {
    switch (type) {
      case 'warn':
        return 'text-yellow-400';
      case 'error':
        return 'text-red-400';
      default:
        return 'text-white';
    }
  };

  const formatTime = (timestamp: number): string => {
    const date = new Date(timestamp);
    const time = date.toLocaleTimeString('en-US', { 
      hour12: false, 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit'
    });
    const ms = String(date.getMilliseconds()).padStart(3, '0');
    return `${time}.${ms}`;
  };

  return (
    <div
      className="fixed inset-0 bg-black text-white p-4 overflow-y-auto font-mono text-sm"
      style={{ zIndex: 99999 }}
      ref={scrollRef}
    >
      <div className="flex justify-between items-center mb-4 sticky top-0 bg-black pb-2">
        <h2 className="text-lg font-bold">Debug Console</h2>
        <button
          onClick={onClose}
          className="text-white hover:text-gray-400 text-2xl font-bold px-2"
          aria-label="Close"
        >
          ✕
        </button>
      </div>
      <div className="space-y-1">
        {logs.length === 0 && (
          <div className="text-gray-500">No logs yet...</div>
        )}
        {logs.map((log, index) => (
          <div key={index} className={`${getLogColor(log.type)} whitespace-pre-wrap break-words`}>
            <span className="text-gray-500 mr-2">[{formatTime(log.timestamp)}]</span>
            <span className="font-bold mr-2">[{log.type.toUpperCase()}]</span>
            {formatArgs(log.args)}
          </div>
        ))}
      </div>
    </div>
  );
}
