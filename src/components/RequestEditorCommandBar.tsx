import { Send, Save, FolderPlus, Check } from 'lucide-react';
import { twMerge } from 'tailwind-merge';

interface RequestEditorCommandBarProps {
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
}

export function RequestEditorCommandBar({
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
}: RequestEditorCommandBarProps) {
  return (
    <div className="p-4 border-b border-border">
      <div className="flex items-stretch gap-2 bg-muted p-1 rounded-xl ring-1 ring-border shadow-sm">
        <select
          value={method}
          onChange={e => onMethodChange(e.target.value)}
          className="px-4 bg-transparent font-bold text-xs uppercase tracking-wider text-primary outline-none border-r border-border"
        >
          <option>GET</option>
          <option>POST</option>
          <option>PUT</option>
          <option>DELETE</option>
          <option>PATCH</option>
        </select>

        <input
          type="text"
          value={url}
          onChange={e => onUrlChange(e.target.value)}
          placeholder="Enter URL or paste request..."
          className="flex-1 px-3 py-2 bg-transparent text-sm outline-none text-foreground placeholder:text-muted-foreground"
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) onRun();
          }}
        />

        <div className="flex items-center gap-1 pr-1">
          <button
            onClick={onSave}
            className={twMerge(
              'flex items-center gap-2 px-4 py-1.5 rounded-lg text-primary-foreground font-bold text-sm transition-all shadow-md active:scale-95',
              projectPath
                ? (isDirty ? 'bg-primary hover:bg-primary/90 shadow-primary/30' : 'bg-muted-foreground cursor-default')
                : 'bg-primary hover:bg-primary/90 shadow-primary/30'
            )}
            title={projectPath ? 'Save to Workspace (Ctrl+S)' : 'Move to Workspace'}
          >
            {projectPath ? (
              isDirty ? <Save size={18} /> : <Check size={18} className="text-green-500" />
            ) : (
              <>
                <FolderPlus size={18} />
                <span className="text-[10px] font-bold uppercase tracking-wider">Move to Workspace</span>
              </>
            )}
          </button>
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
