import { useState, useEffect } from 'react';
import { Save, Settings2, X } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useSidebarStore } from '../store/sidebarStore';
import { Button } from './ui/button';
import { KVEditor, KeyValue } from './editors/KVEditor';

export function WorkspaceSettings() {
  const [name, setName] = useState('');
  const [variables, setVariables] = useState<KeyValue[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const { projectPath, setWorkspaceName: setStoreWorkspaceName, setWorkspaceSettingsOpen, ensureWorkspace, setActiveMenu } = useSidebarStore();

  const handleClose = () => {
    setWorkspaceSettingsOpen(false);
    setActiveMenu('workspace');
  };

  useEffect(() => {
    if (projectPath) {
      loadWorkspaceSettings();
    }
  }, [projectPath]);

  const loadWorkspaceSettings = async () => {
    const { projectPath: currentPath } = useSidebarStore.getState();
    if (!currentPath) return;

    try {
      const manifest: any = await invoke('get_manifest', { projectPath: currentPath });
      setName(manifest.name || '');
      if (manifest.workspace.globals) {
        setVariables(manifest.workspace.globals);
      }
    } catch (err) {
      console.error("Failed to load workspace settings", err);
    }
  };

  const handleSave = async () => {
    const ok = await ensureWorkspace();
    if (!ok) return;

    const { projectPath: currentPath } = useSidebarStore.getState();
    setIsSaving(true);
    try {
      const manifest: any = await invoke('get_manifest', { projectPath: currentPath });
      
      manifest.name = name || projectPath.split(/[/\\]/).filter(Boolean).pop() || 'Workspace';
      
      // Filter out only completely empty rows for saving, keep disabled ones
      const globals = variables.filter(v => v.key.trim() !== "" || v.value.trim() !== "");
      
      const updatedWorkspace = {
        ...manifest.workspace,
        globals,
      };

      await invoke('update_manifest_structure', {
        projectRoot: currentPath,
        workspace: updatedWorkspace,
        name: name.trim() || null
      });
      
      setStoreWorkspaceName(name.trim() || currentPath.split(/[/\\]/).filter(Boolean).pop() || 'Workspace');
      console.log("Successfully saved workspace settings");
      handleClose();
    } catch (err) {
      console.error("Failed to save workspace settings", err);
    } finally {
      setIsSaving(false);
    }
  };

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
            <p className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider">{name || 'Unnamed Workspace'}</p>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          <Button
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center gap-2 rounded-xl text-sm font-bold shadow-lg shadow-zinc-900/20 dark:shadow-zinc-100/20 active:scale-95"
          >
            <Save size={16} />
            {isSaving ? 'Saving...' : 'Save Changes'}
          </Button>
          <button
            type="button"
            onClick={handleClose}
            className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded-xl text-zinc-500 transition-colors active:scale-90"
            aria-label="Close workspace settings"
          >
            <X size={20} />
          </button>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto custom-scrollbar bg-zinc-50/50 dark:bg-zinc-950/50">
        <div className="max-w-5xl mx-auto p-8 space-y-12">
          
          {/* General Section */}
          <section className="space-y-4">
            <div>
              <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">General</h2>
              <p className="text-sm text-zinc-500">Configure the basic identity of your workspace.</p>
            </div>
            <div className="p-6 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-sm">
              <div className="space-y-2">
                <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Workspace Name</label>
                <input 
                  type="text" 
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Enter workspace name..."
                  className="w-full px-4 py-2.5 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-zinc-500/20 focus:border-zinc-500/50 text-zinc-900 dark:text-zinc-100 transition-all"
                />
              </div>
            </div>
          </section>

          {/* Variables Section */}
          <section className="space-y-4">
            <div>
              <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">Variables</h2>
              <p className="text-sm text-zinc-500">Global environment variables accessible to all requests in this workspace.</p>
            </div>
            <div className="p-6 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-sm">
              <KVEditor 
                data={variables} 
                onChange={setVariables} 
                placeholderKey="Variable Name" 
                placeholderValue="Value" 
                uniqueEnabledKeys={true}
              />
            </div>
          </section>

          {/* Pre-request Script Section */}
          <section className="space-y-4 pb-12">
          </section>
        </div>
      </div>
    </div>
  );
}
