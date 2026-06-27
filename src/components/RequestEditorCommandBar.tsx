import { useState } from 'react';
import { Send, Save, FolderPlus, Plug, Unplug } from 'lucide-react';
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

  return (
    <div className="p-4 border-b border-border">
      <div className="flex items-stretch gap-2 bg-muted p-1 rounded-xl ring-1 ring-border shadow-sm">
        <select
          value={protocol}
          onChange={e => onProtocolChange(e.target.value as EditorProtocol)}
          className="px-3 bg-transparent font-bold text-xs uppercase tracking-wider text-violet-500 outline-none border-r border-border"
        >
          <option value="http">HTTP</option>
          <option value="ws">WS</option>
        </select>

        {protocol === 'http' && (
          <select
            value={method}
            onChange={e => onMethodChange(e.target.value)}
            className="px-3 bg-transparent font-bold text-xs uppercase tracking-wider text-primary outline-none border-r border-border"
          >
            <option>GET</option>
            <option>POST</option>
            <option>PUT</option>
            <option>DELETE</option>
            <option>PATCH</option>
          </select>
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
                isRunning ? 'bg-destructive hover:bg-destructive/90 shadow-destructive/30' : 'bg-primary hover:bg-primary/90 shadow-primary/30'
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
                isWsConnected ? 'bg-destructive hover:bg-destructive/90 shadow-destructive/30' : 'bg-primary hover:bg-primary/90 shadow-primary/30'
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
