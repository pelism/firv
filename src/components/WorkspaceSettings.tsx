import { useState, useEffect } from 'react';
import { Plus, Save, Settings2, Trash2, X } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useSidebarStore } from '../store/sidebarStore';
import { Button } from './ui/button';
import { KVEditor, KeyValue } from './editors/KVEditor';

type EnvironmentDraft = {
  id: string;
  name: string;
  variables: KeyValue[];
};

const hydrateRows = (rows: Array<{ id?: string; key: string; value: string; enabled?: boolean }>): KeyValue[] => {
  return rows.map((row) => ({
    id: row.id || crypto.randomUUID(),
    key: row.key ?? '',
    value: row.value ?? '',
    enabled: row.enabled ?? true,
  }));
};

const serializeRows = (rows: KeyValue[]) => {
  return rows
    .filter(row => row.key.trim() !== '' || row.value.trim() !== '')
    .map(({ id: _id, ...row }) => row);
};

const serializeEnvironment = (environment: EnvironmentDraft) => ({
  id: environment.id,
  name: environment.name.trim() || 'Environment',
  variables: serializeRows(environment.variables),
});

type InitialState = {
  name: string;
  variables: KeyValue[];
  environments: EnvironmentDraft[];
};

export function WorkspaceSettings() {
  const [name, setName] = useState('');
  const [variables, setVariables] = useState<KeyValue[]>([]);
  const [environments, setEnvironments] = useState<EnvironmentDraft[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [initialState, setInitialState] = useState<InitialState | null>(null);
  const { projectPath, setWorkspaceName: setStoreWorkspaceName, setWorkspaceSettingsOpen, ensureWorkspace, setActiveMenu } = useSidebarStore();

  const handleClose = () => {
    setWorkspaceSettingsOpen(false);
    setActiveMenu('workspace');
  };

  const addEnvironment = () => {
    setEnvironments(current => [
      ...current,
      {
        id: crypto.randomUUID(),
        name: 'Environment',
        variables: [],
      },
    ]);
  };

  const updateEnvironment = (id: string, patch: Partial<EnvironmentDraft>) => {
    setEnvironments(current => current.map(environment => (environment.id === id ? { ...environment, ...patch } : environment)));
  };

  const deleteEnvironment = (id: string) => {
    setEnvironments(current => current.filter(environment => environment.id !== id));
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
      const loadedName = manifest.name || '';
      const loadedVariables = manifest.workspace.globals ? hydrateRows(manifest.workspace.globals) : [];
      const loadedEnvironments = Array.isArray(manifest.workspace.environments)
        ? manifest.workspace.environments.map((environment: any) => ({
            id: environment.id || crypto.randomUUID(),
            name: environment.name || 'Environment',
            variables: hydrateRows(environment.variables || []),
          }))
        : [];
      setName(loadedName);
      setVariables(loadedVariables);
      setEnvironments(loadedEnvironments);
      setInitialState({ name: loadedName, variables: loadedVariables, environments: loadedEnvironments });
    } catch (err) {
      console.error("Failed to load workspace settings", err);
    }
  };

  const isDirty = initialState !== null && (
    name !== initialState.name ||
    JSON.stringify(variables) !== JSON.stringify(initialState.variables) ||
    JSON.stringify(environments) !== JSON.stringify(initialState.environments)
  );

  const handleSave = async () => {
    const ok = await ensureWorkspace();
    if (!ok) return;

    const { projectPath: currentPath } = useSidebarStore.getState();
    setIsSaving(true);
    try {
      const manifest: any = await invoke('get_manifest', { projectPath: currentPath });
      
      manifest.name = name || projectPath.split(/[/\\]/).filter(Boolean).pop() || 'Workspace';
      
      // Filter out only completely empty rows for saving, keep disabled ones
      const globals = serializeRows(variables);
      const savedEnvironments = environments
        .map(serializeEnvironment)
        .filter((environment) => environment.name.trim() !== '' || environment.variables.length > 0);
      const activeEnvironmentId = manifest.workspace?.active_environment;
      const activeEnvironment = activeEnvironmentId && savedEnvironments.some(environment => environment.id === activeEnvironmentId)
        ? activeEnvironmentId
        : null;
      
      const updatedWorkspace = {
        ...manifest.workspace,
        globals,
        environments: savedEnvironments,
        active_environment: activeEnvironment,
      };

      await invoke('update_manifest_structure', {
        projectRoot: currentPath,
        workspace: updatedWorkspace,
        name: name.trim() || null
      });

      await useSidebarStore.getState().fetchSidebar();
      
      setStoreWorkspaceName(name.trim() || currentPath.split(/[/\\]/).filter(Boolean).pop() || 'Workspace');
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
            disabled={isSaving || !isDirty}
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
              <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">Globals</h2>
              <p className="text-sm text-zinc-500">Variables available to every environment and request in this workspace.</p>
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

          {/* Environments Section */}
          <section className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">Environments</h2>
                <p className="text-sm text-zinc-500">Create named variable sets such as development or production.</p>
              </div>
              <Button type="button" onClick={addEnvironment} className="rounded-xl flex items-center gap-2">
                <Plus size={16} />
                Add Environment
              </Button>
            </div>

            <div className="p-6 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-sm space-y-6">
              {environments.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-zinc-200 dark:border-zinc-800 px-4 py-5 text-sm text-zinc-500 bg-zinc-50/60 dark:bg-zinc-950/40">
                  No environments yet. Add one to define development, production, or any other scoped variable set.
                </div>
              ) : (
                <div className="space-y-4">
                  {environments.map((environment) => {
                    return (
                      <div
                        key={environment.id}
                        className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-950/40 p-4 space-y-4"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 space-y-2">
                            <input
                              type="text"
                              value={environment.name}
                              onChange={(e) => updateEnvironment(environment.id, { name: e.target.value })}
                              placeholder="Environment name"
                              className="w-full px-4 py-2.5 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-zinc-500/20 focus:border-zinc-500/50 text-zinc-900 dark:text-zinc-100 transition-all"
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() => deleteEnvironment(environment.id)}
                            className="inline-flex self-start items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold text-zinc-500 hover:text-red-600 hover:bg-red-500/10 transition-colors"
                            aria-label="Delete environment"
                          >
                            <Trash2 size={16} />
                            Delete
                          </button>
                        </div>

                        <KVEditor
                          data={environment.variables}
                          onChange={(updatedVariables) => updateEnvironment(environment.id, { variables: updatedVariables })}
                          placeholderKey="Variable Name"
                          placeholderValue="Value"
                          uniqueEnabledKeys={true}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
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
