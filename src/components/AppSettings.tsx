import { X, Settings, Moon, Sun, Monitor, Scissors } from 'lucide-react';
import { useSidebarStore } from '../store/sidebarStore';
import { useThemeStore, Theme } from '../store/themeStore';
import { twMerge } from 'tailwind-merge';
import { APP_VERSION } from '../version';
import { ClipboardInput } from './ClipboardInput';

export function AppSettings() {
  const { setAppSettingsOpen, setActiveMenu } = useSidebarStore();
  const { theme, setTheme } = useThemeStore();

  const handleClose = () => {
    setAppSettingsOpen(false);
    setActiveMenu('workspace');
  };

  return (
    <div className="fixed inset-0 z-[100] bg-background flex flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-300">
      {/* Header */}
      <header className="h-16 flex items-center justify-between px-6 border-b border-border bg-background/80 backdrop-blur-md sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-muted text-muted-foreground">
            <Settings size={20} />
          </div>
          <div>
            <h1 className="text-sm font-bold text-foreground">Application Settings</h1>
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Global Preferences</p>
          </div>
        </div>
        
        <button
          onClick={handleClose}
          className="p-2 hover:bg-muted rounded-xl text-muted-foreground transition-colors active:scale-90"
        >
          <X size={20} />
        </button>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto custom-scrollbar bg-muted/20">
        <div className="max-w-3xl mx-auto p-8 space-y-12">
          
          {/* Appearance Section */}
          <section className="space-y-4">
            <div>
              <h2 className="text-lg font-bold text-foreground">Appearance</h2>
              <p className="text-sm text-muted-foreground">Choose how Firv looks on your screen. This setting is global across all workspaces.</p>
            </div>
            <div className="p-6 rounded-2xl bg-card border border-border shadow-sm">
              <div className="space-y-4">
                <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Theme Mode</label>
                <div className="flex bg-muted p-1 rounded-xl border border-border max-w-md">
                  {(['light', 'dark', 'system'] as Theme[]).map((t) => (
                    <button
                      key={t}
                      onClick={() => setTheme(t)}
                      className={twMerge(
                        "flex-1 flex items-center justify-center gap-2 py-2 text-xs font-bold rounded-lg transition-all capitalize",
                        theme === t
                          ? "bg-background text-primary shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {t === 'light' && <Sun size={14} />}
                      {t === 'dark' && <Moon size={14} />}
                      {t === 'system' && <Monitor size={14} />}
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <div>
              <h2 className="text-lg font-bold text-foreground">About</h2>
              <p className="text-sm text-muted-foreground">Application details and build information.</p>
            </div>
            <div className="p-6 rounded-2xl bg-card border border-border shadow-sm flex items-center justify-between gap-4">
              <div>
                <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Version</div>
                <div className="text-sm font-medium text-foreground mt-1">v{APP_VERSION}</div>
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <div>
              <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
                <Scissors size={18} /> Clipboard Utilities
              </h2>
              <p className="text-sm text-muted-foreground">
                Use this sandbox to verify native cut/copy/paste behaviors and the system context menu integration.
              </p>
            </div>
            <ClipboardInput />
          </section>

          {/* More sections can be added here as needed (e.g., Font size, Keybindings, etc.) */}
          
        </div>
      </div>
    </div>
  );
}
