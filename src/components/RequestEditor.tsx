import { useState, useEffect, useRef } from 'react';
import { Send, Settings, Save, FolderPlus, Check } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { KVEditor, KeyValue } from './editors/KVEditor';
import { BodyEditor } from './editors/BodyEditor';
import { useAppStore } from '../store/appStore';
import { useSidebarStore } from '../store/sidebarStore';
import { HydratedSidebarItem } from '../types/hydratedSidebarItem.ts';
import { twMerge } from 'tailwind-merge';

interface RequestEditorProps {
  requestId: string;
}

export function RequestEditor({ requestId }: RequestEditorProps) {
  const [method, setMethod] = useState('GET');
  const [url, setUrl] = useState('');
  const [activeTab, setActiveTab] = useState<'params'|'headers'|'body'>('params');
  const [headers, setHeaders] = useState<KeyValue[]>([]);
  const [params, setParams] = useState<KeyValue[]>([]);
  const [body, setBody] = useState('');
  const [bodyMode, setBodyMode] = useState<'json'|'yaml'|'raw'|'none'>('json');
  const savedStateRef = useRef<any>(null);
  
  const { isRunning, setIsRunning, setResponse, addLog, setDirty, dirtyRequests, scratchpadRequestData, setScratchpadRequestData } = useAppStore();
  const isDirty = dirtyRequests.has(requestId);
  const {
    syncTreeToBackend, 
    projectPath, 
    ensureWorkspace, 
    getRequestName, 
    pendingNames,
    clearPendingName
  } = useSidebarStore();

  // Hydration
  useEffect(() => {
    async function loadRequest() {
      // 1. Try loading from scratchpad data first
      if (scratchpadRequestData[requestId]) {
        const req = scratchpadRequestData[requestId];
        setMethod(req.method || 'GET');
        setUrl(req.url || '');
        if (req.body) {
          setBodyMode(req.body.mode || 'none');
          setBody(req.body.data || '');
        }
        if (req.headers) setHeaders(req.headers.map((h: any) => ({ id: Math.random().toString(36).substring(2, 9), ...h })));
        if (req.params) setParams(req.params.map((p: any) => ({ id: Math.random().toString(36).substring(2, 9), ...p })));
        savedStateRef.current = req;
        setDirty(requestId, false);
        return;
      }

      if (!projectPath) {
        // If no project path and no scratchpad data, it's a completely new scratchpad request
        const defaultState = {
          name: getRequestName(requestId),
          method: 'GET',
          url: '',
          headers: [],
          params: [],
          bodyMode: 'none',
          body: '',
        };
        savedStateRef.current = defaultState;
        setDirty(requestId, true);
        return;
      }
      
      try {
        const req: any = await invoke('get_request', { 
          projectRoot: projectPath, 
          id: requestId 
        });
        setMethod(req.method || 'GET');
        setUrl(req.url || '');
        
        if (req.body) {
          if (req.body.mode === 'none') {
            setBodyMode('none');
            setBody('');
          } else if (req.body.mode === 'json') {
            setBodyMode('json');
            setBody(req.body.data || '');
          } else if (req.body.mode === 'raw') {
            setBodyMode('raw');
            setBody(req.body.data || '');
          }
        }

        if (req.headers && Array.isArray(req.headers)) {
          setHeaders(req.headers.map((h: any) => ({ id: Math.random().toString(36).substring(2, 9), ...h })));
        } else {
          setHeaders([]);
        }

        if (req.params && Array.isArray(req.params)) {
          setParams(req.params.map((p: any) => ({ id: Math.random().toString(36).substring(2, 9), ...p })));
        } else {
          setParams([]);
        }
        const initialState = {
          name: req.name || getRequestName(requestId),
          method: req.method || 'GET',
          url: req.url || '',
          headers: (req.headers || []).map((h: any) => ({ key: h.key, value: h.value, enabled: h.enabled })),
          params: (req.params || []).map((p: any) => ({ key: p.key, value: p.value, enabled: p.enabled })),
          bodyMode: req.body?.mode || 'json',
          body: req.body?.data || '',
        };
        savedStateRef.current = initialState;
        setDirty(requestId, false);
      } catch (err) {
        console.error("Failed to load request", err);
        // If it failed to load, it might be a new request that hasn't been saved yet
        // Set a default initial state so we can track dirtyness
        const defaultState = {
          name: getRequestName(requestId),
          method: 'GET',
          url: '',
          headers: [],
          params: [],
          bodyMode: 'json',
          body: '',
        };
        savedStateRef.current = defaultState;
        setDirty(requestId, true); // Mark as dirty since it doesn't exist on disk
      }
    }
    loadRequest();
  }, [requestId]);

  useEffect(() => {
    const handleGlobalKeydown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveRequest();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        handleRun();
      }
    };
    window.addEventListener('keydown', handleGlobalKeydown);
    return () => window.removeEventListener('keydown', handleGlobalKeydown);
  }, [method, url, headers, body, requestId]);

  useEffect(() => {
    const currentState = {
      name: getRequestName(requestId),
      method,
      url,
      headers: headers.map(h => ({ key: h.key, value: h.value, enabled: h.enabled })),
      params: params.map(p => ({ key: p.key, value: p.value, enabled: p.enabled })),
      bodyMode,
      body,
    };

    if (!projectPath) {
      // Auto-save to scratchpad store
      setScratchpadRequestData(requestId, {
        ...currentState,
        id: requestId,
        body: getFormattedBody(),
      });
      setDirty(requestId, false);
      return;
    }

    if (!savedStateRef.current) {
      setDirty(requestId, true);
      return;
    }

    const isDirty = JSON.stringify(currentState) !== JSON.stringify(savedStateRef.current);
    setDirty(requestId, isDirty);
  }, [method, url, headers, params, bodyMode, body, requestId, setDirty, pendingNames, projectPath]);

  const getFormattedBody = () => {
    if (bodyMode === 'none') return { mode: 'none' };
    if (bodyMode === 'json') return { mode: 'json', data: body };
    return { mode: 'raw', data: body };
  };

  const getFormattedRequest = () => ({
    id: requestId,
    name: getRequestName(requestId), 
    method,
    url,
    headers: headers.map(h => ({ key: h.key, value: h.value, enabled: h.enabled })),
    params: params.map(p => ({ key: p.key, value: p.value, enabled: p.enabled })),
    body: getFormattedBody()
  });

  const saveRequest = async () => {
    if (!projectPath) {
      // For scratchpad, "Saving" means moving to a workspace
      const ok = await ensureWorkspace();
      if (!ok) return;
      
      // After ensuring workspace, it will re-run this function or the user can click again
      // The auto-save effect will have already synced the current state to the store
      // We fall through to the workspace save logic below
    }

    const ok = await ensureWorkspace();
    if (!ok) return;

    // After ensureWorkspace, the projectPath might have changed, so we MUST get the latest state
    const { projectPath: currentPath, tree: currentTree } = useSidebarStore.getState();

    try {
      const pendingName = pendingNames[requestId];
      
      const findItemInTree = (items: HydratedSidebarItem[]): HydratedSidebarItem | null => {
        for (const item of items) {
          if (item.kind.type === 'request' && item.kind.id === requestId) return item;
          if (item.kind.type === 'folder') {
            const found = findItemInTree(item.kind.items);
            if (found) return found;
          }
        }
        return null;
      };

      const existingItem = findItemInTree(currentTree);
      const methodChanged = existingItem && existingItem.kind.type === 'request' && existingItem.kind.method !== method;

      let updatedTree = currentTree;
      
      if (!existingItem) {
        const newItem: HydratedSidebarItem = {
          id: crypto.randomUUID(),
          kind: { type: 'request', id: requestId, name: pendingName || getRequestName(requestId) || 'New Request', method: method as any }
        };
        updatedTree = [...currentTree, newItem];
        useSidebarStore.getState().updateTreeOptimistic(updatedTree);
        await syncTreeToBackend(updatedTree);
        if (pendingName) clearPendingName(requestId);
      } else if (pendingName || methodChanged) {
        const updateInItems = (items: HydratedSidebarItem[]): HydratedSidebarItem[] => {
          return items.map(item => {
            if (item.kind.type === 'request' && item.kind.id === requestId) {
              return { 
                ...item, 
                kind: { 
                  ...item.kind, 
                  name: pendingName || item.kind.name,
                  method: method as any
                } 
              };
            }
            if (item.kind.type === 'folder' && item.kind.items) {
              return {
                ...item,
                kind: {
                  ...item.kind,
                  items: updateInItems(item.kind.items)
                }
              };
            }
            return item;
          });
        };
        updatedTree = updateInItems(currentTree);
        useSidebarStore.getState().updateTreeOptimistic(updatedTree);
        await syncTreeToBackend(updatedTree);
        clearPendingName(requestId);
      }

      await invoke('update_request', {
        projectRoot: currentPath || '.',
        request: getFormattedRequest()
      });
      
      const currentState = {
        name: pendingName || getRequestName(requestId),
        method,
        url,
        headers: headers.map(h => ({ key: h.key, value: h.value, enabled: h.enabled })),
        params: params.map(p => ({ key: p.key, value: p.value, enabled: p.enabled })),
        bodyMode,
        body
      };
      savedStateRef.current = currentState;
      setDirty(requestId, false);

      addLog(`Saved request ${requestId}`);
    } catch (err) {
      console.error("Failed to save", err);
      addLog(`Error saving: ${err}`);
    }
  };

  const handleRun = async () => {
    if (isRunning) return; 
    setIsRunning(true);
    try {
      addLog(`Running request ${method} ${url}...`);
      
      let workspaceVars = {};
      if (projectPath) {
        try {
          const manifest: any = await invoke('get_manifest', { projectPath });
          workspaceVars = manifest.workspace.globals || {};
        } catch (err) {
          addLog(`Warning: Could not load workspace manifest: ${err}`);
        }
      }

      const result: any = await invoke('run_firv_request', {
        request: getFormattedRequest(),
        workspaceVars,
      });

      setResponse(requestId, result.response);
      addLog(`Request completed successfully in ${result.execution_time_ms}ms.`);
    }
    catch (e: any) {
      console.error(e);
      addLog(`Error: ${e.toString()}`);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0 bg-background w-full">
      {/* Unified Command Bar */}
      <div className="p-4 border-b border-border">
        <div className="flex items-stretch gap-2 bg-muted p-1 rounded-xl ring-1 ring-border shadow-sm">
          <select 
            value={method} 
            onChange={e => setMethod(e.target.value)}
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
            onChange={e => setUrl(e.target.value)}
            placeholder="Enter URL or paste request..."
            className="flex-1 px-3 py-2 bg-transparent text-sm outline-none text-foreground placeholder:text-muted-foreground"
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleRun();
            }}
          />
          
          <div className="flex items-center gap-1 pr-1">
            <button 
              onClick={saveRequest}
              className={twMerge(
                "p-2 transition-all flex items-center gap-2 rounded-lg",
                projectPath 
                  ? (isDirty ? "text-primary hover:bg-primary/10" : "text-muted-foreground cursor-default")
                  : "text-primary hover:bg-primary/10"
              )}
              title={projectPath ? "Save to Workspace (Ctrl+S)" : "Move to Workspace"}
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
              onClick={handleRun}
              disabled={isRunning}
              className={twMerge(
                "flex items-center gap-2 px-4 py-1.5 rounded-lg text-primary-foreground font-bold text-sm transition-all shadow-md active:scale-95",
                isRunning ? 'bg-muted-foreground' : 'bg-primary hover:bg-primary/90 shadow-primary/30'
              )}
            >
              <Send size={16} className={isRunning ? 'animate-pulse' : ''} />
              {isRunning ? 'Sending' : 'Send'}
            </button>
          </div>
        </div>
      </div>

      {/* Segmented Editor Tabs */}
      <div className="px-4 py-2 border-b border-border bg-muted/30">
        <div className="flex bg-muted p-1 rounded-lg w-fit">
          {['params', 'headers', 'body'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab as any)}
              className={twMerge(
                "px-4 py-1.5 text-xs font-semibold rounded-md transition-all uppercase tracking-tight",
                activeTab === tab 
                  ? "bg-background text-foreground shadow-sm" 
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Editor Content */}
      <div className="flex-1 overflow-auto p-4 custom-scrollbar">
        <div className="max-w-5xl h-full flex flex-col">
          {activeTab === 'headers' && (
            <KVEditor data={headers} onChange={setHeaders} placeholderKey="Header Name" placeholderValue="Value" />
          )}
          {activeTab === 'params' && (
            <KVEditor data={params} onChange={setParams} placeholderKey="Query Param" placeholderValue="Value" />
          )}
          {activeTab === 'body' && (
            <div className="h-full flex flex-col">
              <div className="mb-4 flex items-center justify-between">
                <div className="flex gap-2 bg-muted p-1 rounded-lg ring-1 ring-border">
                  {['none', 'json', 'yaml', 'raw'].map(mode => (
                    <button
                      key={mode}
                      onClick={() => setBodyMode(mode as any)}
                      className={twMerge(
                        "px-3 py-1 text-[10px] font-bold uppercase rounded-md transition-all",
                        bodyMode === mode 
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
                <button className="p-1.5 text-muted-foreground hover:bg-muted rounded-md transition-colors">
                  <Settings size={16} />
                </button>
              </div>
              <div className="flex-1 min-h-[300px] border border-border rounded-xl overflow-hidden shadow-sm">
                {bodyMode !== 'none' ? (
                  <BodyEditor value={body} mode={bodyMode} onChange={setBody} />
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-muted-foreground text-sm space-y-2 bg-muted/50">
                    <div className="p-3 rounded-full bg-muted">
                      <Settings size={24} className="opacity-50" />
                    </div>
                    <p className="font-medium">No Request Body</p>
                    <p className="text-xs">Select a mode above to add a body.</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
