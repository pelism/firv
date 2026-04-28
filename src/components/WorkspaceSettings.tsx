import { useState, useEffect } from 'react';
import { X, Save, Settings2 } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { ScriptEditor } from './editors/ScriptEditor';
import { useSidebarStore } from '../store/sidebarStore';
import { useAppStore } from '../store/appStore';
import { VariablePlaceholder } from './VariablePlaceholder';

export function WorkspaceSettings() {
  const [preScript, setPreScript] = useState('');
  const [postScript, setPostScript] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const { projectPath, setWorkspaceSettingsOpen, ensureWorkspace } = useSidebarStore();
  const { addLog } = useAppStore();

  useEffect(() => {
    if (projectPath) {
      loadWorkspaceScripts();
    }
  }, [projectPath]);

  const loadWorkspaceScripts = async () => {
    try {
      const manifest: any = await invoke('get_manifest', { projectPath });
      if (manifest.workspace.scripts) {
        setPreScript(manifest.workspace.scripts.pre || '');
        setPostScript(manifest.workspace.scripts.post || '');
      }
    } catch (err) {
      console.error("Failed to load workspace scripts", err);
    }
  };

  const handleSave = async () => {
    const ok = await ensureWorkspace();
    if (!ok) return;

    const { projectPath: currentPath } = useSidebarStore.getState();
    setIsSaving(true);
    try {
      const manifest: any = await invoke('get_manifest', { projectPath: currentPath });
      manifest.workspace.scripts = {
        pre: preScript || null,
        post: postScript || null
      };
      
      await invoke('update_manifest_structure', {
        projectRoot: currentPath,
        workspace: manifest.workspace
      });
      
      addLog("Saved workspace settings");
      setWorkspaceSettingsOpen(false);
    } catch (err) {
      console.error("Failed to save workspace settings", err);
      addLog(`Error saving workspace settings: ${err}`);
    } finally {
      setIsSaving(false);
    }
  };

  const workspaceName = projectPath.split(/[/\\]/).pop() || 'Workspace';

  return (
    <div className="fixed inset-0 z-[100] bg-white dark:bg-zinc-950 flex flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-300">
      {/* Header */}
      <header className="h-16 flex items-center justify-between px-6 border-b border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-950/80 backdrop-blur-md sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-zinc-100 dark:bg-zinc-900 text-zinc-500">
            <Settings2 size={20} />
          </div>
          <div>
            <h1 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">Workspace Settings</h1>
            <p className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider">{workspaceName}</p>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-bold transition-all shadow-lg shadow-indigo-600/20 disabled:opacity-50 active:scale-95"
          >
            <Save size={16} />
            {isSaving ? 'Saving...' : 'Save Changes'}
          </button>
          <div className="w-px h-6 bg-zinc-200 dark:border-zinc-800 mx-1" />
          <button
            onClick={() => setWorkspaceSettingsOpen(false)}
            className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded-xl text-zinc-500 transition-colors active:scale-90"
          >
            <X size={20} />
          </button>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto custom-scrollbar bg-zinc-50/50 dark:bg-zinc-950/50">
        <div className="max-w-5xl mx-auto p-8 space-y-12">
          
          {/* Variables Section */}
          <section className="space-y-4">
            <div>
              <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">Variables</h2>
              <p className="text-sm text-zinc-500">Global environment variables accessible to all requests in this workspace.</p>
            </div>
            <VariablePlaceholder />
          </section>

          {/* Pre-request Script Section */}
          <section className="space-y-4">
            <div>
              <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">Pre-request Script</h2>
              <p className="text-sm text-zinc-500">This script runs before every request in the workspace. Use it to set dynamic headers or variables.</p>
            </div>
            <div className="h-[400px] rounded-2xl overflow-hidden border border-zinc-200 dark:border-zinc-800 shadow-sm ring-1 ring-black/5 dark:ring-white/5">
              <ScriptEditor 
                title="" 
                value={preScript} 
                onChange={setPreScript}
                placeholder="// Runs before every request in the workspace..."
              />
            </div>
          </section>

          {/* Post-request Script Section */}
          <section className="space-y-4 pb-12">
            <div>
              <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">Post-request</h2>
              <p className="text-sm text-zinc-500">This script runs after every request in the workspace. Use it for global testing or response processing.</p>
            </div>
            <div className="h-[400px] rounded-2xl overflow-hidden border border-zinc-200 dark:border-zinc-800 shadow-sm ring-1 ring-black/5 dark:ring-white/5">
              <ScriptEditor 
                title="" 
                value={postScript} 
                onChange={setPostScript}
                placeholder="// Runs after every request in the workspace..."
              />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
