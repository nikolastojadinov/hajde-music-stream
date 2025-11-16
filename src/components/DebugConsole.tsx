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

  const extractEmoji = (text: string): { emoji: string; rest: string } => {
    // Extract emoji from common patterns like "🎵 [Context]" or "📦 Message"
    const emojiMatch = text.match(/^([\u{1F300}-\u{1F9FF}])\s*/u);
    if (emojiMatch) {
      return {
        emoji: emojiMatch[1],
        rest: text.slice(emojiMatch[0].length)
      };
    }
    return { emoji: '', rest: text };
  };

  const formatArgs = (args: any[]): { emoji: string; text: string; objects: any[] } => {
    const objects: any[] = [];
    const textParts: string[] = [];
    
    args.forEach(arg => {
      if (typeof arg === 'object' && arg !== null) {
        objects.push(arg);
      } else {
        textParts.push(String(arg));
      }
    });
    
    const fullText = textParts.join(' ');
    const { emoji, rest } = extractEmoji(fullText);
    
    return { emoji, text: rest, objects };
  };

  const getLogStyle = (type: 'log' | 'warn' | 'error'): { icon: string; color: string; bgColor: string } => {
    switch (type) {
      case 'warn':
        return { icon: '⚠️', color: 'text-yellow-300', bgColor: 'bg-yellow-900/20' };
      case 'error':
        return { icon: '❌', color: 'text-red-300', bgColor: 'bg-red-900/20' };
      default:
        return { icon: 'ℹ️', color: 'text-blue-300', bgColor: 'bg-blue-900/20' };
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
      className="fixed inset-0 bg-gradient-to-br from-gray-950 via-gray-900 to-black text-white p-4 overflow-y-auto font-mono text-xs"
      style={{ zIndex: 99999 }}
      ref={scrollRef}
    >
      <div className="flex justify-between items-center mb-4 sticky top-0 bg-gradient-to-r from-gray-950 to-gray-900 pb-3 pt-1 border-b border-gray-700/50">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🐛</span>
          <h2 className="text-lg font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
            Debug Console
          </h2>
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-white hover:bg-gray-800 rounded-full w-8 h-8 flex items-center justify-center transition-all"
          aria-label="Close"
        >
          ✕
        </button>
      </div>
      <div className="space-y-2">
        {logs.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            <div className="text-4xl mb-2">📭</div>
            <div>No logs yet...</div>
          </div>
        )}
        {logs.map((log, index) => {
          const style = getLogStyle(log.type);
          const formatted = formatArgs(log.args);
          return (
            <div 
              key={index} 
              className={`${style.bgColor} ${style.color} rounded-lg p-3 border border-gray-700/30 hover:border-gray-600/50 transition-colors`}
            >
              <div className="flex items-start gap-2">
                <span className="text-lg flex-shrink-0">{formatted.emoji || style.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-gray-500 text-[10px] font-semibold">{formatTime(log.timestamp)}</span>
                    <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${style.bgColor} border border-gray-700/30`}>
                      {log.type}
                    </span>
                  </div>
                  <div className="text-sm leading-relaxed whitespace-pre-wrap break-words">
                    {formatted.text}
                  </div>
                  {formatted.objects.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {formatted.objects.map((obj, i) => (
                        <details key={i} className="bg-black/30 rounded p-2 text-xs">
                          <summary className="cursor-pointer text-gray-400 hover:text-white select-none">
                            {Array.isArray(obj) ? `Array(${obj.length})` : 'Object'} ▼
                          </summary>
                          <pre className="mt-2 text-gray-300 overflow-x-auto">
                            {JSON.stringify(obj, null, 2)}
                          </pre>
                        </details>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
