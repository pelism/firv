import { Loader2, Sparkles } from 'lucide-react';
import { twMerge } from 'tailwind-merge';

interface UpdatePromptProps {
  version?: string;
  isInstalling: boolean;
  error: string | null;
  onInstall: () => void;
  onDismiss: () => void;
}

export function UpdatePrompt({ version, isInstalling, error, onInstall, onDismiss }: UpdatePromptProps) {
  return (
    <div className="fixed bottom-6 right-6 z-50 w-80 rounded-2xl border border-border bg-card/95 shadow-2xl shadow-primary/20 backdrop-blur">
      <div className="p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary">
            <Sparkles size={16} />
          </div>
          Update available
        </div>
        <div className="text-xs text-muted-foreground leading-relaxed">
          {version ? (
            <p>
              Firv <span className="font-semibold text-foreground">v{version}</span> is ready to install. Would you like to update now?
            </p>
          ) : (
            <p>A new Firv update is ready to install. Would you like to update now?</p>
          )}
        </div>
        {error && <p className="text-[11px] text-destructive">{error}</p>}
        <div className="flex items-center justify-end gap-2 text-xs font-semibold">
          <button
            type="button"
            onClick={onDismiss}
            disabled={isInstalling}
            className={twMerge(
              'px-3 py-1.5 rounded-xl border border-transparent text-muted-foreground transition-colors',
              isInstalling ? 'opacity-60 cursor-not-allowed' : 'hover:text-foreground'
            )}
          >
            Later
          </button>
          <button
            type="button"
            onClick={onInstall}
            disabled={isInstalling}
            className={twMerge(
              'px-4 py-1.5 rounded-xl bg-primary text-primary-foreground flex items-center gap-2 transition-colors',
              isInstalling ? 'opacity-70 cursor-wait' : 'hover:bg-primary/90'
            )}
          >
            {isInstalling && <Loader2 size={14} className="animate-spin" />}
            Update now
          </button>
        </div>
      </div>
    </div>
  );
}
