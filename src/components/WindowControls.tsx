import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X, Copy } from "lucide-react";
import { useEffect, useState } from "react";

export function WindowControls() {
  const [isMaximized, setIsMaximized] = useState(false);
  const appWindow = getCurrentWindow();

  useEffect(() => {
    const updateMaximized = async () => {
      const maximized = await appWindow.isMaximized();
      setIsMaximized(maximized);
    };

    updateMaximized();
    const unlisten = appWindow.onResized(() => {
      updateMaximized();
    });

    return () => {
      unlisten.then((f) => f());
    };
  }, [appWindow]);

  const handleMaximize = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const currentlyMaximized = await appWindow.isMaximized();
      if (currentlyMaximized) {
        await appWindow.unmaximize();
      } else {
        await appWindow.maximize();
      }
    } catch (err) {
      console.error("Failed to toggle maximize:", err);
    }
  };

  return (
    <div className="flex items-center h-full no-drag">
      <button
        onClick={(e) => {
          e.stopPropagation();
          appWindow.minimize().catch(console.error);
        }}
        className="h-12 w-12 flex items-center justify-center hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors"
        title="Minimize"
      >
        <Minus size={14} />
      </button>
      <button
        onClick={handleMaximize}
        className="h-12 w-12 flex items-center justify-center hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors"
        title={isMaximized ? "Restore" : "Maximize"}
      >
        {isMaximized ? <Copy size={12} className="rotate-180" /> : <Square size={12} />}
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          appWindow.close().catch(console.error);
        }}
        className="h-12 w-12 flex items-center justify-center hover:bg-red-500 hover:text-white transition-colors"
        title="Close"
      >
        <X size={14} />
      </button>
    </div>
  );
}
