import { useRef, useEffect, useState } from 'react';
import { twMerge } from 'tailwind-merge';
import { ArrowDown, ArrowUp, Send } from 'lucide-react';
import type { WsMessage, WsConnectionStatus } from '../lib/wsClient';

interface WsConsoleProps {
  requestId: string;
  messages: WsMessage[];
  status: WsConnectionStatus;
  onSend: (message: string) => void;
}

function formatTime(timestamp_ms: number): string {
  const d = new Date(timestamp_ms);
  return d.toLocaleTimeString(undefined, { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function WsConsole({ messages, status, onSend }: WsConsoleProps) {
  const [draft, setDraft] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const isConnected = status === 'connected';

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const handleSend = () => {
    if (!draft.trim() || !isConnected) return;
    onSend(draft);
    setDraft('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-background border-t border-border">
      <div className="px-4 py-1.5 border-b border-border bg-muted/30 flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Console</span>
        <span className={twMerge(
          'text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md',
          status === 'connected' && 'bg-green-500/15 text-green-600 dark:text-green-400',
          status === 'connecting' && 'bg-yellow-500/15 text-yellow-600 dark:text-yellow-400',
          status === 'error' && 'bg-destructive/15 text-destructive',
          status === 'disconnected' && 'bg-muted text-muted-foreground',
        )}>
          {status}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar px-3 py-2 font-mono text-xs">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground/50 italic">
            No messages yet
          </div>
        ) : (
          messages.map((msg, i) => (
            <div key={i} className={twMerge(
              'flex items-start gap-2 py-1 border-b border-border/40 last:border-0',
              msg.direction === 'out' && 'opacity-80'
            )}>
              {msg.direction === 'in'
                ? <ArrowDown size={12} className="mt-0.5 shrink-0 text-green-500" />
                : <ArrowUp size={12} className="mt-0.5 shrink-0 text-blue-500" />
              }
              <span className="text-muted-foreground/60 shrink-0">{formatTime(msg.timestamp_ms)}</span>
              <span className="break-all whitespace-pre-wrap text-foreground">{msg.data}</span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      <div className="p-3 border-t border-border">
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={!isConnected}
            placeholder={isConnected ? 'Type a message… (Enter to send, Shift+Enter for newline)' : 'Connect to send messages'}
            rows={2}
            className="flex-1 resize-none rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-primary/40 disabled:opacity-50 disabled:cursor-not-allowed placeholder:text-muted-foreground/50"
          />
          <button
            onClick={handleSend}
            disabled={!isConnected || !draft.trim()}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-primary/90 active:scale-95 transition-all"
          >
            <Send size={14} />
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
