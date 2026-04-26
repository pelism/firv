import { useState, useEffect } from 'react';
import { X, Save } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { ScriptEditor } from './editors/ScriptEditor';
import { useSidebarStore } from '../store/sidebarStore';
import { useAppStore } from '../store/appStore';

interface WorkspaceScriptDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export function WorkspaceScriptDrawer({ isOpen, onClose }: WorkspaceScriptDrawerProps) {
  const [preScript, setPreScript] = useState('');
  const [postScript, setPostScript] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const { projectPath } = useSidebarStore();
  const { addLog } = useAppStore();

  useEffect(() => {
    if (isOpen && projectPath) {
      loadWorkspaceScripts();
    }
  }, [isOpen, projectPath]);

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
    if (!projectPath) return;
    setIsSaving(true);
    try {
      const manifest: any = await invoke('get_manifest', { projectPath });
      manifest.workspace.scripts = {
        pre: preScript || null,
        post: postScript || null
      };
      
      await invoke('update_manifest_structure', {
        projectRoot: projectPath,
        workspace: manifest.workspace
      });
      
      addLog("Saved workspace scripts");
      onClose();
    } catch (err) {
      console.error("Failed to save workspace scripts", err);
      addLog(`Error saving workspace scripts: ${err}`);
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-zinc-950 w-full max-w-4xl h-[80vh] rounded-2xl shadow-2xl flex flex-col border border-zinc-200 dark:border-zinc-800 overflow-hidden">
        <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between bg-zinc-50 dark:bg-zinc-900">
          <div>
            <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">Workspace Scripts</h2>
            <p className="text-xs text-zinc-500">Run for every request in this workspace</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-bold transition-all shadow-lg shadow-indigo-600/20 disabled:opacity-50"
            >
              <Save size={16} />
              {isSaving ? 'Saving...' : 'Save Scripts'}
            </button>
            <button
              onClick={onClose}
              className="p-2 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-lg text-zinc-500 transition-colors"
            >
              <X size={20} />
            </button>
          </div>
        </div>
        
        <div className="flex-1 p-6 overflow-auto space-y-6">
          <div className="h-[300px] flex flex-col">
            <ScriptEditor 
              title="Global Pre-request Script" 
              value={preScript} 
              onChange={setPreScript}
              placeholder="// Runs before every request in the workspace..."
            />
          </div>
          
          <div className="h-[300px] flex flex-col">
            <ScriptEditor 
              title="Global Post-request / Tests" 
              value={postScript} 
              onChange={setPostScript}
              placeholder="// Runs after every request in the workspace..."
            />
          </div>
        </div>
      </div>
    </div>
  );
}
