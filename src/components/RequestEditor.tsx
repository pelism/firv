import { useState, useEffect, useMemo, useRef } from 'react';
import { Send, Settings, Save, FolderPlus, Check, CircleSlash2 } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { KVEditor, KeyValue } from './editors/KVEditor';
import { BodyEditor } from './editors/BodyEditor';
import { useAppStore } from '../store/appStore';
import { useSidebarStore } from '../store/sidebarStore';
import { HydratedSidebarItem } from '../types/hydratedSidebarItem.ts';
import type { BeforeRunStep } from '../types/beforeRunStep';
import type { RequestExtractionRule } from '../types/requestExtractionRule';
import type { RequestChainStep } from '../types/requestChainStep';
import { twMerge } from 'tailwind-merge';

interface RequestEditorProps {
  requestId: string;
}

export function RequestEditor({ requestId }: RequestEditorProps) {
  const [method, setMethod] = useState('GET');
  const [url, setUrl] = useState('');
  const [activeTab, setActiveTab] = useState<'params'|'headers'|'body'|'transforms'>('params');
  const [headers, setHeaders] = useState<KeyValue[]>([]);
  const [params, setParams] = useState<KeyValue[]>([]);
  const [body, setBody] = useState('');
  const [formBody, setFormBody] = useState<KeyValue[]>([]);
  const [bodyMode, setBodyMode] = useState<'none'|'form'|'json'|'raw'>('json');
  const [jsonViewMode, setJsonViewMode] = useState<'Raw' | 'Pretty' | 'Preview'>('Raw');
  const savedStateRef = useRef<any>(null);
  const [templateText, setTemplateText] = useState('');
  const [extractions, setExtractions] = useState<RequestExtractionRule[]>([]);
  const [beforeRunChain, setBeforeRunChain] = useState<BeforeRunStep[]>([]);
  const [chainSteps, setChainSteps] = useState<RequestChainStep[]>([]);
  const [showChainPicker, setShowChainPicker] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [bodyErrorLine, setBodyErrorLine] = useState<number | null>(null);
  
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
  const sidebarTree = useSidebarStore(state => state.tree);

  const requestOptions = useMemo(() => {
    const flatten = (items: HydratedSidebarItem[], prefix: string[] = []): Array<{ id: string; name: string }> => {
      const result: Array<{ id: string; name: string }> = [];
      for (const item of items) {
        if (item.kind.type === 'request') {
          result.push({ id: item.kind.id, name: [...prefix, item.kind.name].join('/') });
        } else if (item.kind.type === 'folder') {
          result.push(...flatten(item.kind.items, [...prefix, item.kind.name]));
        }
      }
      return result;
    };
    return flatten(sidebarTree);
  }, [sidebarTree]);

  const renderJsonPreview = () => {
    if (jsonViewMode === 'Raw') {
      return <pre className="h-full overflow-auto p-4 text-xs font-mono whitespace-pre-wrap bg-background text-foreground">{body || ''}</pre>;
    }

    let pretty = body;
    if (body.trim()) {
      try {
        pretty = JSON.stringify(JSON.parse(body), null, 2);
      } catch {
        pretty = body;
      }
    }

    if (jsonViewMode === 'Preview') {
      try {
        const parsed = body.trim() ? JSON.parse(body) : null;
        return (
          <div className="h-full overflow-auto p-4 bg-background">
            <pre className="text-xs font-mono whitespace-pre-wrap text-foreground">{parsed === null ? '(empty JSON body)' : JSON.stringify(parsed, null, 2)}</pre>
          </div>
        );
      } catch {
        return <div className="h-full overflow-auto p-4 text-xs text-destructive bg-background">Invalid JSON preview</div>;
      }
    }

    return <pre className="h-full overflow-auto p-4 text-xs font-mono whitespace-pre-wrap bg-background text-foreground">{pretty || ''}</pre>;
  };

  const resolveRequestIdByName = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return '';
    const match = requestOptions.find(option => option.name === trimmed || option.name.split('/').pop() === trimmed);
    return match?.id || '';
  };

  const resolveRequestDisplayName = (idOrName: string) => {
    const trimmed = idOrName.trim();
    if (!trimmed) return '';
    const byId = requestOptions.find(option => option.id === trimmed);
    if (byId) return byId.name;

    const byName = requestOptions.find(option => option.name === trimmed || option.name.split('/').pop() === trimmed);
    return byName?.name || trimmed;
  };

  const getRequestDisplayName = (id: string) => {
    const found = requestOptions.find(option => option.id === id);
    return found?.name || getRequestName(id);
  };

  // Hydration
  useEffect(() => {
    async function loadRequest() {
      // 1. Try loading from scratchpad data first
      if (scratchpadRequestData[requestId]) {
        const req = scratchpadRequestData[requestId];
        setMethod(req.method || 'GET');
        setUrl(req.url || '');
        if (req.body) {
          if (req.body.mode === 'formdata') {
            setBodyMode('form');
            setFormBody(Array.isArray(req.body.data) ? req.body.data.map((h: any) => ({ id: Math.random().toString(36).substring(2, 9), ...h })) : []);
            setBody('');
          } else {
            setBodyMode(req.body.mode || 'none');
            setBody(req.body.data || '');
            setFormBody([]);
          }
        }
        if (req.headers) setHeaders(req.headers.map((h: any) => ({ id: Math.random().toString(36).substring(2, 9), ...h })));
        if (req.params) setParams(req.params.map((p: any) => ({ id: Math.random().toString(36).substring(2, 9), ...p })));
        setTemplateText(req.transforms?.pre_request_template || '');
        setExtractions(req.transforms?.response_extractions || []);
        setBeforeRunChain(req.transforms?.before_run?.map((step: any) => ({ request_id: step.request_id })) || []);
        setChainSteps(req.transforms?.chain_steps?.map((step: any) => ({ when: step.when, next_request_id: step.next_request_id })) || []);
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
          formBody: [],
        };
        savedStateRef.current = defaultState;
        setTemplateText('');
        setExtractions([]);
        setBeforeRunChain([]);
        setChainSteps([]);
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
            setFormBody([]);
          } else if (req.body.mode === 'formdata') {
            setBodyMode('form');
            setFormBody(Array.isArray(req.body.data) ? req.body.data.map((h: any) => ({ id: Math.random().toString(36).substring(2, 9), ...h })) : []);
            setBody('');
          } else if (req.body.mode === 'json') {
            setBodyMode('json');
            setBody(req.body.data || '');
            setFormBody([]);
          } else if (req.body.mode === 'raw') {
            setBodyMode('raw');
            setBody(req.body.data || '');
            setFormBody([]);
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
          formBody: req.body?.mode === 'formdata' && Array.isArray(req.body?.data) ? req.body.data.map((h: any) => ({ key: h.key, value: h.value, enabled: h.enabled })) : [],
        };
        setTemplateText(req.transforms?.pre_request_template || '');
        setExtractions(req.transforms?.response_extractions || []);
        setBeforeRunChain((req.transforms?.before_run || []).map((step: any) => ({ request_id: step.request_id })));
        setChainSteps(req.transforms?.chain_steps || []);
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
          formBody: [],
        };
        savedStateRef.current = defaultState;
        setTemplateText('');
        setExtractions([]);
        setBeforeRunChain([]);
        setChainSteps([]);
        setDirty(requestId, true); // Mark as dirty since it doesn't exist on disk
      }
    }
    loadRequest();
  }, [requestId]);

  const updateChainStep = (index: number, patch: Partial<RequestChainStep>) => {
    setChainSteps(current => current.map((step, i) => (i === index ? { ...step, ...patch } : step)));
  };

  const addChainStep = (placement?: 'before' | 'on_success' | 'on_failure') => {
    const selected = placement;
    setShowChainPicker(false);

    if (!selected) return;

    if (selected === 'before') {
      if (beforeRunChain.length > 0) return;
      setBeforeRunChain(current => [...current, { request_id: '' }]);
      return;
    }

    if (chainSteps.some(step => step.when === selected)) return;
    setChainSteps(current => [...current, { when: selected, next_request_id: '' }]);
  };

  const removeChainStep = (index: number) => {
    setChainSteps(current => current.filter((_, i) => i !== index));
  };

  const updateExtraction = (index: number, patch: Partial<RequestExtractionRule>) => {
    setExtractions(current => current.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)));
  };

  const addExtraction = () => {
    setExtractions(current => [
      ...current,
      { target: '', source: 'response_body_json', pattern: '' },
    ]);
  };

  const removeExtraction = (index: number) => {
    setExtractions(current => current.filter((_, i) => i !== index));
  };

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
      formBody: formBody.map(item => ({ key: item.key, value: item.value, enabled: item.enabled })),
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
    if (bodyMode === 'form') return { mode: 'formdata', data: formBody.map(({ key, value, enabled }) => ({ key, value, enabled })) };
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
    body: getFormattedBody(),
    transforms: {
      pre_request_template: templateText.trim() || null,
      response_extractions: extractions,
      before_run: beforeRunChain.filter(step => step.request_id.trim()),
      chain_steps: chainSteps.filter(step => step.next_request_id.trim())
    }
  });

  const saveRequest = async () => {
    if (!projectPath) {
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
        body,
        formBody: formBody.map(item => ({ key: item.key, value: item.value, enabled: item.enabled })),
        transforms: {
          pre_request_template: templateText.trim() || null,
          response_extractions: extractions,
          before_run: beforeRunChain.filter(step => step.request_id.trim()),
          chain_steps: chainSteps.filter(step => step.next_request_id.trim())
        }
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

      if (bodyMode === 'json' && body.trim()) {
        try {
          JSON.parse(body);
          setValidationError(null);
          setBodyErrorLine(null);
        } catch (err: any) {
          const rawMessage = err?.message || String(err);
          const positionMatch = rawMessage.match(/position\s+(\d+)/i);
          const position = positionMatch ? Number(positionMatch[1]) : null;
          let lineInfo = '';
          let lineNumber: number | null = null;
          if (position !== null && Number.isFinite(position)) {
            const prefix = body.slice(0, position);
            const line = prefix.split('\n').length;
            const column = prefix.length - prefix.lastIndexOf('\n');
            lineInfo = ` (line ${line}, column ${column})`;
            lineNumber = line;
          }
          setBodyErrorLine(lineNumber);
          setValidationError(`Invalid JSON body${lineInfo}: ${rawMessage}`);
          addLog(`Validation error: ${rawMessage}${lineInfo}`);
          return;
        }
      }
      
      let workspaceVars: Array<{ key: string; value: string; enabled: boolean }> = [];
      if (projectPath) {
        try {
          const manifest: any = await invoke('get_manifest', { projectPath });
          workspaceVars = Array.isArray(manifest?.workspace?.globals) ? manifest.workspace.globals : [];
        } catch (err) {
          addLog(`Warning: Could not load workspace manifest: ${err}`);
        }
      }

      const result: any = await invoke('run_firv_request', {
        projectRoot: projectPath || '.',
        request: getFormattedRequest(),
        workspaceVars,
      });

      setResponse(requestId, {
        ...(result.response || null),
        __trace: result.variables || {},
        __request: result.final_request || null,
        __errors: result.script_errors || [],
        __before_run_results: result.before_run_results || [],
        __variable_trace: result.variable_trace || [],
        __chained_results: result.chained_results || []
      });
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
        {validationError && (
          <div className="mt-3 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400">
            {validationError}
          </div>
        )}
      </div>

      {/* Segmented Editor Tabs */}
      <div className="px-4 py-2 border-b border-border bg-muted/30">
        <div className="flex bg-muted p-1 rounded-lg w-fit">
          {['params', 'headers', 'body', 'transforms'].map(tab => (
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
                  {['none', 'form', 'json', 'raw'].map(mode => (
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
              </div>
              <div className="flex-1 min-h-[300px] overflow-hidden">
                {bodyMode === 'none' ? (
                  <div className="h-full flex flex-col items-center justify-center text-muted-foreground text-sm space-y-2 bg-muted/50">
                    <div className="p-3 rounded-full bg-muted">
                      <CircleSlash2 size={24} className="opacity-50" />
                    </div>
                    <p className="font-medium">No Request Body</p>
                    <p className="text-xs">Select a mode above to add a body.</p>
                  </div>
                ) : bodyMode === 'form' ? (
                  <div className="h-full flex flex-col gap-4">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Form Fields</span>
                      <button
                        type="button"
                        onClick={() => setFormBody(current => [...current, { id: Math.random().toString(36).substring(2, 9), key: '', value: '', enabled: true } as any])}
                        className="text-xs font-semibold text-primary hover:underline"
                      >
                        Add field
                      </button>
                    </div>
                    <div className="space-y-3">
                      {formBody.length === 0 && (
                        <div className="text-sm text-muted-foreground border border-dashed border-border rounded-xl p-4 bg-muted/20">
                          No form fields yet. Add one to build a multipart form body.
                        </div>
                      )}
                      {formBody.map((field, index) => (
                        <div key={field.id ?? index} className="rounded-xl border border-border p-3 bg-muted/20 space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                              field {index + 1}
                            </span>
                            <span className="text-[10px] text-muted-foreground">
                              {field.enabled ?? true ? 'enabled' : 'disabled'}
                            </span>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                            <input className="md:col-span-4 rounded-lg border border-border bg-background px-3 py-2 text-sm" value={field.key} onChange={e => setFormBody(current => current.map((item, i) => i === index ? { ...item, key: e.target.value } : item))} placeholder="Key" />
                            <input className="md:col-span-6 rounded-lg border border-border bg-background px-3 py-2 text-sm" value={field.value} onChange={e => setFormBody(current => current.map((item, i) => i === index ? { ...item, value: e.target.value } : item))} placeholder="Value" />
                            <div className="md:col-span-1 flex items-center justify-center rounded-lg border border-border bg-background">
                              <input type="checkbox" checked={field.enabled ?? true} onChange={e => setFormBody(current => current.map((item, i) => i === index ? { ...item, enabled: e.target.checked } : item))} />
                            </div>
                            <button type="button" onClick={() => setFormBody(current => current.filter((_, i) => i !== index))} className="md:col-span-1 rounded-lg border border-border px-3 py-2 text-sm text-destructive bg-background hover:bg-muted transition-colors">Remove</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="h-full flex flex-col gap-4">
                    {bodyMode === 'json' && (
                      <div className="flex items-center justify-between">
                        <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">JSON Body</div>
                        <select
                          value={jsonViewMode}
                          onChange={e => {
                            const nextMode = e.target.value as 'Raw' | 'Pretty' | 'Preview';
                            setJsonViewMode(nextMode);
                            if (nextMode === 'Pretty') {
                              try {
                                setBody(JSON.stringify(JSON.parse(body), null, 2));
                              } catch {
                                // Leave the body untouched if it isn't valid JSON.
                              }
                            }
                          }}
                          className="text-[11px] font-bold uppercase tracking-wider bg-background border border-border rounded-lg px-3 py-1 outline-none focus:ring-2 focus:ring-primary/20 transition-all cursor-pointer"
                        >
                          <option value="Raw">Raw</option>
                          <option value="Pretty">Pretty</option>
                          <option value="Preview">Preview</option>
                        </select>
                      </div>
                    )}
                    {bodyMode === 'json' && jsonViewMode === 'Preview' ? (
                      <div className="flex-1 min-h-[300px] border border-border rounded-xl overflow-hidden shadow-sm">
                        {renderJsonPreview()}
                      </div>
                    ) : (
                      <BodyEditor value={body} mode={bodyMode} onChange={setBody} highlightLine={bodyErrorLine} />
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
          {activeTab === 'transforms' && (
            <div className="h-full flex flex-col gap-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Pre-request Liquid Template</label>
                <textarea
                  value={templateText}
                  onChange={e => setTemplateText(e.target.value)}
                  placeholder="Build or rewrite the body before the request is sent."
                  className="w-full min-h-[140px] rounded-xl border border-border bg-background p-3 text-sm font-mono outline-none resize-y"
                />
              </div>

              <div className="flex items-center justify-between">
                <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground">Response Extractions</label>
                <button onClick={addExtraction} className="text-xs font-semibold text-primary hover:underline">Add extraction</button>
              </div>

              <datalist id="request-name-options">
                {requestOptions.map(option => (
                  <option key={option.id} value={option.name} />
                ))}
              </datalist>

              <div className="space-y-3">
                {extractions.length === 0 && (
                  <div className="text-sm text-muted-foreground border border-dashed border-border rounded-xl p-4">
                    No extraction rules yet. Add one to capture values from the response body.
                  </div>
                )}
                {extractions.map((rule, index) => (
                  <div key={index} className="rounded-xl border border-border p-3 bg-muted/20 space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <input className="rounded-lg border border-border bg-background px-3 py-2 text-sm" value={rule.target} onChange={e => updateExtraction(index, { target: e.target.value })} placeholder="target variable" />
                      <select className="rounded-lg border border-border bg-background px-3 py-2 text-sm" value={rule.source} onChange={e => updateExtraction(index, { source: e.target.value as any })}>
                        <option value="response_body_json">response_body_json</option>
                        <option value="response_body_raw">response_body_raw</option>
                      </select>
                      <button onClick={() => removeExtraction(index)} className="rounded-lg border border-border px-3 py-2 text-sm text-destructive">Remove</button>
                    </div>
                    <input className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono" value={rule.pattern} onChange={e => updateExtraction(index, { pattern: e.target.value })} placeholder='$.access_token or literal substring' />
                  </div>
                ))}
              </div>

              <div className="pt-4 pb-4 border-t border-border space-y-3">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground">Request Chain</label>
                  <button onClick={() => setShowChainPicker(v => !v)} className="text-xs font-semibold text-primary hover:underline" title="Add chain step" type="button">
                    Add chain step
                  </button>
                </div>

                <div className="space-y-3">
                  {beforeRunChain.length === 0 && chainSteps.length === 0 && (
                    <div className="text-sm text-muted-foreground border border-dashed border-border rounded-xl p-4">
                      No chain steps yet. Add one before, on success, or on failure.
                    </div>
                  )}

                  {showChainPicker && (
                    <div className="rounded-xl border border-border bg-background p-3 shadow-sm">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Add chain step</span>
                        <button
                          className="text-xs text-muted-foreground hover:text-foreground"
                          onClick={() => setShowChainPicker(false)}
                          type="button"
                        >
                          Cancel
                        </button>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <button
                          type="button"
                          className="rounded-lg border border-border px-3 py-2 text-sm font-semibold hover:bg-muted transition-colors"
                          onClick={() => addChainStep('before')}
                        >
                          before
                        </button>
                        <button
                          type="button"
                          className="rounded-lg border border-border px-3 py-2 text-sm font-semibold hover:bg-muted transition-colors"
                          onClick={() => addChainStep('on_success')}
                        >
                          on success
                        </button>
                        <button
                          type="button"
                          className="rounded-lg border border-border px-3 py-2 text-sm font-semibold hover:bg-muted transition-colors"
                          onClick={() => addChainStep('on_failure')}
                        >
                          on failure
                        </button>
                      </div>
                    </div>
                  )}

                  {beforeRunChain.length > 0 && (
                    <div className="rounded-xl border border-border p-3 bg-muted/20 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">before</span>
                        <span className="text-[10px] text-muted-foreground">1 of 1</span>
                      </div>
                      {beforeRunChain.map((step, index) => (
                        <div key={`before-${index}`} className="space-y-3">
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <input
                              list="request-name-options"
                              className="md:col-span-2 rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono"
                              value={resolveRequestDisplayName(step.request_id)}
                              onChange={e => setBeforeRunChain(current => current.map((item, i) => i === index ? { ...item, request_id: resolveRequestIdByName(e.target.value) || e.target.value.trim() } : item))}
                              placeholder="Search request by name"
                            />
                          </div>
                          <div className="flex justify-end">
                            <button onClick={() => setBeforeRunChain([])} className="rounded-lg border border-border px-3 py-2 text-sm text-destructive">Remove</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {chainSteps.filter(step => step.when === 'on_success').length > 0 && (
                    <div className="rounded-xl border border-border p-3 bg-muted/20 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">success</span>
                        <span className="text-[10px] text-muted-foreground">1 of 1</span>
                      </div>
                      {chainSteps.filter(step => step.when === 'on_success').map((step, index) => {
                        const actualIndex = chainSteps.findIndex(item => item === step);
                        return (
                          <div key={`success-${index}`} className="space-y-3">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                              <input
                                list="request-name-options"
                                className="md:col-span-2 rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono"
                                value={resolveRequestDisplayName(step.next_request_id)}
                                onChange={e => updateChainStep(actualIndex, { next_request_id: resolveRequestIdByName(e.target.value) || e.target.value.trim() })}
                                placeholder="Search request by name"
                              />
                            </div>
                            <div className="flex justify-end">
                              <button onClick={() => removeChainStep(actualIndex)} className="rounded-lg border border-border px-3 py-2 text-sm text-destructive">Remove</button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {chainSteps.filter(step => step.when === 'on_failure').length > 0 && (
                    <div className="rounded-xl border border-border p-3 bg-muted/20 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">failure</span>
                        <span className="text-[10px] text-muted-foreground">1 of 1</span>
                      </div>
                      {chainSteps.filter(step => step.when === 'on_failure').map((step, index) => {
                        const actualIndex = chainSteps.findIndex(item => item === step);
                        return (
                          <div key={`failure-${index}`} className="space-y-3">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                              <input
                                list="request-name-options"
                                className="md:col-span-2 rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono"
                                value={getRequestDisplayName(step.next_request_id)}
                                onChange={e => updateChainStep(actualIndex, { next_request_id: resolveRequestIdByName(e.target.value) })}
                                placeholder="Search request by name"
                              />
                            </div>
                            <div className="flex justify-end">
                              <button onClick={() => removeChainStep(actualIndex)} className="rounded-lg border border-border px-3 py-2 text-sm text-destructive">Remove</button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
