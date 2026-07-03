import { useState, useRef, useEffect } from 'react';
import { Send, Save, FolderPlus, Plug, Unplug, ChevronDown } from 'lucide-react';
import { twMerge } from 'tailwind-merge';
import { getVariableHoverTitleAtPoint, type VariableLookup } from '../lib/variableHover';

export type EditorProtocol = 'http' | 'ws';

interface RequestEditorCommandBarProps {
  protocol: EditorProtocol;
  onProtocolChange: (protocol: EditorProtocol) => void;
  method: string;
  url: string;
  onMethodChange: (method: string) => void;
  onUrlChange: (url: string) => void;
  onSave: () => void;
  onRun: () => void;
  isRunning: boolean;
  isDirty: boolean;
  projectPath: string;
  validationError: string | null;
  isScratchpadRequest: boolean;
  workspaceGlobals: VariableLookup;
  isWsConnected?: boolean;
}

export function RequestEditorCommandBar({
  protocol,
  onProtocolChange,
  method,
  url,
  onMethodChange,
  onUrlChange,
  onSave,
  onRun,
  isRunning,
  isDirty,
  projectPath,
  validationError,
  isScratchpadRequest,
  workspaceGlobals,
  isWsConnected = false,
}: RequestEditorCommandBarProps) {
  const showMoveToWorkspace = isScratchpadRequest;
  const [urlHover, setUrlHover] = useState<{ title: string; left: number } | null>(null);
  const [protocolOpen, setProtocolOpen] = useState(false);
  const protocolRef = useRef<HTMLDivElement>(null);
  const [methodOpen, setMethodOpen] = useState(false);
  const methodRef = useRef<HTMLDivElement>(null);

  const handleUrlMouseMove = (e: React.MouseEvent<HTMLInputElement>) => {
    const title = getVariableHoverTitleAtPoint(url, workspaceGlobals, e.currentTarget, e.clientX, e.clientY);
    if (!title) {
      setUrlHover(null);
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    setUrlHover({
      title,
      left: e.clientX - rect.left,
    });
  };

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (protocolRef.current && !protocolRef.current.contains(e.target as Node)) {
        setProtocolOpen(false);
      }
      if (methodRef.current && !methodRef.current.contains(e.target as Node)) {
        setMethodOpen(false);
      }
    }
    if (protocolOpen || methodOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [protocolOpen, methodOpen]);

  const protocolOptions: { value: EditorProtocol; label: string; helper: string; color: string }[] = [
    { value: 'http', label: 'HTTP', helper: 'REST, GraphQL, Webhooks', color: 'text-method-post' },
    { value: 'ws', label: 'WS', helper: 'Persistent bidirectional streaming', color: 'text-violet-500' },
    // { value: 'grpc', label: 'gRPC', helper: 'Protocol Buffers/RPC', color: 'text-orange-500' },
  ];

  return (
    <div className="p-4 border-b border-border">
      <div className="flex items-stretch gap-2 bg-muted p-1 rounded-xl ring-1 ring-border shadow-sm">
        <div ref={protocolRef} className="relative flex flex-col justify-center border-r border-border">
          <button
            onClick={() => setProtocolOpen(v => !v)}
            className={twMerge(
              'flex items-center gap-1 px-3 bg-transparent font-bold text-xs uppercase tracking-wider outline-none',
              protocol === 'http' ? 'text-method-post' : 'text-violet-500'
            )}
          >
            {protocol.toUpperCase()}
            <ChevronDown size={14} className={twMerge('transition-transform', protocolOpen && 'rotate-180')} />
          </button>
          {protocolOpen && (
            <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded-md border border-border bg-popover shadow-md overflow-hidden py-1">
              {protocolOptions.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => { onProtocolChange(opt.value); setProtocolOpen(false); }}
                  className={twMerge(
                    'flex w-full items-center justify-between px-3 py-2 text-left text-xs transition-colors hover:bg-primary/15 hover:text-primary border-l-2 border-transparent',
                    opt.value === protocol ? 'bg-primary/10' : '',
                    opt.value === protocol ? (opt.value === 'http' ? 'border-method-post' : 'border-violet-500') : ''
                  )}
                >
                  <span className={twMerge('font-bold uppercase tracking-wider', opt.color)}>{opt.label}</span>
                  <span className="text-[10px] text-muted-foreground">{opt.helper}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {protocol === 'http' && (
          <div ref={methodRef} className="relative flex flex-col justify-center border-r border-border">
            <button
              onClick={() => setMethodOpen(v => !v)}
              className="flex items-center gap-1 px-3 bg-transparent font-bold text-xs uppercase tracking-wider outline-none text-method-post"
            >
              {method}
              <ChevronDown size={14} className={twMerge('transition-transform', methodOpen && 'rotate-180')} />
            </button>
            {methodOpen && (
              <div className="absolute left-0 top-full z-50 mt-1 min-w-[5.5rem] rounded-md border border-border bg-popover shadow-md overflow-hidden py-1">
                {['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].map(m => (
                  <button
                    key={m}
                    onClick={() => { onMethodChange(m); setMethodOpen(false); }}
                    className={twMerge(
                      'flex w-full items-center justify-between px-3 py-2 text-left text-xs font-bold uppercase tracking-wider transition-colors hover:bg-primary/15 hover:text-primary text-method-post border-l-2 border-transparent',
                      m === method ? 'bg-primary/10 border-method-post' : ''
                    )}
                  >
                    {m}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="relative flex-1 min-w-0">
          <input
            type="text"
            value={url}
            onChange={e => onUrlChange(e.target.value)}
            placeholder={protocol === 'ws' ? 'wss://example.com/socket' : 'Enter URL or paste request...'}
            className="w-full px-3 py-2 bg-transparent text-sm outline-none text-foreground placeholder:text-muted-foreground"
            onMouseMove={handleUrlMouseMove}
            onMouseLeave={() => setUrlHover(null)}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) onRun();
            }}
          />
          {urlHover && (
            <div
              role="tooltip"
              className="pointer-events-none absolute top-full z-50 mt-2 rounded-md bg-neutral-900 px-2 py-1 text-xs text-white shadow-lg whitespace-pre-wrap"
              style={{ left: Math.max(8, urlHover.left) }}
            >
              {urlHover.title}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 pr-1">
          <button
            onClick={onSave}
            className={twMerge(
              'flex items-center gap-2 px-4 py-1.5 rounded-lg text-primary-foreground font-bold text-sm transition-all shadow-md active:scale-95',
              showMoveToWorkspace
                ? 'bg-primary hover:bg-primary/90 shadow-primary/30'
                : projectPath
                  ? (isDirty ? 'bg-primary hover:bg-primary/90 shadow-primary/30' : 'bg-muted-foreground cursor-default')
                  : 'bg-primary hover:bg-primary/90 shadow-primary/30'
            )}
            title={showMoveToWorkspace ? 'Move to Workspace' : (projectPath ? 'Save to Workspace (Ctrl+S)' : 'Move to Workspace')}
          >
            {showMoveToWorkspace ? (
              <>
                <FolderPlus size={18} />
                <span className="text-[10px] font-bold uppercase tracking-wider">Move to Workspace</span>
              </>
            ) : !projectPath ? (
              <>
                <FolderPlus size={18} />
                <span className="text-[10px] font-bold uppercase tracking-wider">Move to Workspace</span>
              </>
            ) : (
              <>
                <Save size={18} />
                <span className="text-[10px] font-bold uppercase tracking-wider">Save</span>
              </>
            )}
          </button>
          {protocol === 'http' && (
            <button
              onClick={onRun}
              className={twMerge(
                'flex items-center gap-2 px-4 py-1.5 rounded-lg text-primary-foreground font-bold text-sm transition-all shadow-md active:scale-95',
                'bg-primary hover:bg-primary/90 shadow-primary/30'
              )}
              title={isRunning ? 'Cancel request' : 'Send request (Ctrl+Enter)'}
            >
              <Send size={16} className={isRunning ? 'animate-pulse' : ''} />
              {isRunning ? 'Cancel' : 'Send'}
            </button>
          )}
          {protocol === 'ws' && (
            <button
              onClick={onRun}
              disabled={isRunning}
              className={twMerge(
                'flex items-center gap-2 px-4 py-1.5 rounded-lg text-primary-foreground font-bold text-sm transition-all shadow-md active:scale-95 disabled:opacity-60',
                'bg-primary hover:bg-primary/90 shadow-primary/30'
              )}
              title={isWsConnected ? 'Disconnect' : 'Connect'}
            >
              {isWsConnected ? <Unplug size={16} /> : <Plug size={16} className={isRunning ? 'animate-pulse' : ''} />}
              {isRunning ? 'Connecting…' : isWsConnected ? 'Disconnect' : 'Connect'}
            </button>
          )}
        </div>
      </div>
      {validationError && (
        <div className="mt-3 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400">
          {validationError}
        </div>
      )}
    </div>
  );
}
