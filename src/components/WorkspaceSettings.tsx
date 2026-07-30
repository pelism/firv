import { useState, useEffect } from 'react';
import { Eye, EyeOff, KeyRound, Pencil, Plus, Save, Settings2, Trash2, X } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useSidebarStore } from '../store/sidebarStore';
import { useSecretModalStore } from '../store/secretModalStore';
import { Button } from './ui/button';
import { KVEditor, KeyValue, SecretOption } from './editors/KVEditor';

type EnvironmentDraft = {
  id: string;
  name: string;
  variables: KeyValue[];
};

const hydrateRows = (rows: Array<{ id?: string; key: string; value: string; enabled?: boolean; secret_ref?: string }>): KeyValue[] => {
  return rows.map((row) => ({
    id: row.id || crypto.randomUUID(),
    key: row.key ?? '',
    value: row.value ?? '',
    enabled: row.enabled ?? true,
    secretRef: row.secret_ref || undefined,
  }));
};

const serializeRows = (rows: KeyValue[]) => {
  return rows
    .filter(row => row.key.trim() !== '' || row.value.trim() !== '' || !!row.secretRef)
    .map(({ id: _id, secretRef, ...row }) => ({ ...row, secret_ref: secretRef || undefined }));
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
  const [workspaceId, setWorkspaceId] = useState<string>('');
  const [secretOptions, setSecretOptions] = useState<SecretOption[]>([]);
  const [revealedSecrets, setRevealedSecrets] = useState<Record<string, string>>({});
  const [revealingSecret, setRevealingSecret] = useState<string | null>(null);
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
      setWorkspaceId(manifest.workspace_id || '');
      if (manifest.workspace_id) {
        await refreshSecrets(manifest.workspace_id);
      }
    } catch (err) {
      console.error("Failed to load workspace settings", err);
    }
  };

  const refreshSecrets = async (id: string) => {
    try {
      const options = await invoke<SecretOption[]>('list_secrets', { workspaceId: id });
      setSecretOptions(options);
    } catch (err) {
      console.error('Failed to load secrets', err);
    }
  };

  const handleCreateSecret = async (secretName: string, value: string): Promise<string> => {
    if (!workspaceId) throw new Error('No workspace loaded');
    const id = await invoke<string>('create_secret_value', { workspaceId, name: secretName, value });
    await refreshSecrets(workspaceId);
    return id;
  };

  const stripSecretRef = (rows: KeyValue[], secretId: string): KeyValue[] =>
    rows.map(row => (row.secretRef === secretId ? { ...row, secretRef: undefined } : row));

  const handleDeleteSecret = async (secretId: string) => {
    if (!workspaceId) return;
    try {
      await invoke('delete_secret_value', { workspaceId, id: secretId });
      await refreshSecrets(workspaceId);
      setVariables(prev => stripSecretRef(prev, secretId));
      setEnvironments(prev => prev.map(environment => ({ ...environment, variables: stripSecretRef(environment.variables, secretId) })));
      setRevealedSecrets(prev => {
        const { [secretId]: _removed, ...rest } = prev;
        return rest;
      });
    } catch (err) {
      console.error('Failed to delete secret', err);
    }
  };

  const handleEditSecret = async (secretId: string, currentName: string) => {
    if (!workspaceId) return;
    let currentValue = revealedSecrets[secretId];
    if (currentValue === undefined) {
      try {
        currentValue = await invoke<string>('get_secret_value', { workspaceId, id: secretId });
      } catch (err) {
        console.error('Failed to load secret for editing', err);
        currentValue = '';
      }
    }
    const existingNames = secretOptions.filter(o => o.id !== secretId).map(o => o.name);
    const result = await useSecretModalStore.getState().openSecretModal({
      title: 'Edit Secret',
      description: 'Update this secret\'s name and/or value. Renaming it keeps existing references working.',
      initialName: currentName,
      initialValue: currentValue,
      existingNames,
    });
    if (!result) return;
    try {
      if (result.name !== currentName) {
        await invoke('rename_secret_value', { workspaceId, id: secretId, name: result.name });
      }
      if (result.value !== currentValue) {
        await invoke('set_secret_value', { workspaceId, id: secretId, value: result.value });
      }
      await refreshSecrets(workspaceId);
      setRevealedSecrets(prev => (secretId in prev ? { ...prev, [secretId]: result.value } : prev));
    } catch (err) {
      console.error('Failed to update secret', err);
    }
  };

  const toggleRevealSecret = async (secretId: string) => {
    if (!workspaceId) return;
    if (secretId in revealedSecrets) {
      setRevealedSecrets(prev => {
        const { [secretId]: _removed, ...rest } = prev;
        return rest;
      });
      return;
    }
    setRevealingSecret(secretId);
    try {
      const value = await invoke<string>('get_secret_value', { workspaceId, id: secretId });
      setRevealedSecrets(prev => ({ ...prev, [secretId]: value }));
    } catch (err) {
      console.error('Failed to reveal secret', err);
    } finally {
      setRevealingSecret(null);
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
                secretsEnabled={true}
                secretOptions={secretOptions}
                onCreateSecret={handleCreateSecret}
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
                          secretsEnabled={true}
                          secretOptions={secretOptions}
                          onCreateSecret={handleCreateSecret}
                          secretNamePrefix={environment.name}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          {/* Secrets Section */}
          <section className="space-y-4">
            <div>
              <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">Secrets</h2>
              <p className="text-sm text-zinc-500">
                Values stored outside of {name || 'this workspace'}'s files, in your local secret store. Reference them from a
                global or environment variable using the <KeyRound size={12} className="inline -mt-0.5" /> icon above.
              </p>
            </div>
            <div className="p-6 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-sm">
              {!workspaceId ? (
                <div className="text-sm text-zinc-500">Save this workspace once to start managing secrets.</div>
              ) : secretOptions.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-zinc-200 dark:border-zinc-800 px-4 py-5 text-sm text-zinc-500 bg-zinc-50/60 dark:bg-zinc-950/40">
                  No secrets yet. Create one from a variable row using the <KeyRound size={12} className="inline -mt-0.5" /> icon.
                </div>
              ) : (
                <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {secretOptions.map((secret) => {
                    const isRevealed = secret.id in revealedSecrets;
                    return (
                      <li key={secret.id} className="flex items-center justify-between py-2.5 gap-4">
                        <span className="flex items-center gap-2 font-mono text-sm text-zinc-800 dark:text-zinc-200 min-w-0">
                          <KeyRound size={14} className="text-amber-500 shrink-0" />
                          <span className="shrink-0">{secret.name}</span>
                          {isRevealed && (
                            <span className="truncate text-zinc-500 dark:text-zinc-400">
                              {revealedSecrets[secret.id]}
                            </span>
                          )}
                        </span>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => toggleRevealSecret(secret.id)}
                            disabled={revealingSecret === secret.id}
                            className="p-1.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-colors disabled:opacity-50"
                            aria-label={isRevealed ? `Hide secret ${secret.name}` : `Reveal secret ${secret.name}`}
                          >
                            {isRevealed ? <EyeOff size={16} /> : <Eye size={16} />}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleEditSecret(secret.id, secret.name)}
                            className="p-1.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-colors"
                            aria-label={`Edit secret ${secret.name}`}
                          >
                            <Pencil size={16} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteSecret(secret.id)}
                            className="p-1.5 text-zinc-400 hover:text-red-500 hover:bg-red-500/10 rounded transition-colors"
                            aria-label={`Delete secret ${secret.name}`}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
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
