import { useState, useEffect, useMemo, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { KeyValue } from './editors/KVEditor';
import { useAppStore } from '../store/appStore';
import { useSidebarStore } from '../store/sidebarStore';
import { HydratedSidebarItem } from '../types/hydratedSidebarItem.ts';
import type { BeforeRunStep } from '../types/beforeRunStep';
import type { RequestExtractionRule } from '../types/requestExtractionRule';
import type { RequestChainStep } from '../types/requestChainStep';
import { twMerge } from 'tailwind-merge';
import {
  flattenRequestOptions,
  getFormattedRequest,
  getHydratedBodySnapshot,
  getHydratedFormBodySnapshot,
  getTransformsState,
  normalizeBodyMode,
  type RequestAuthorizationState,
} from './requestEditorUtils';
import { RequestEditorCommandBar } from './RequestEditorCommandBar';
import { RequestEditorBodySection } from './RequestEditorBodySection';
import { RequestEditorTransformsSection } from './RequestEditorTransformsSection';

interface RequestEditorProps {
  requestId: string;
}

export function RequestEditor({ requestId }: RequestEditorProps) {
  const [method, setMethod] = useState('GET');
  const [url, setUrl] = useState('');
  const [activeTab, setActiveTab] = useState<'params'|'headers'|'body'|'transforms'>('params');
  const [headers, setHeaders] = useState<KeyValue[]>([]);
  const [authorization, setAuthorization] = useState<RequestAuthorizationState>({ mode: 'none', value: '' });
  const [params, setParams] = useState<KeyValue[]>([]);
  const [body, setBody] = useState('');
  const [formBody, setFormBody] = useState<KeyValue[]>([]);
  const [bodyMode, setBodyMode] = useState<'none'|'form'|'json'|'raw'>('json');
  const [jsonViewMode, setJsonViewMode] = useState<'Raw' | 'Preview'>('Raw');
  const savedStateRef = useRef<any>(null);
  const [templateText, setTemplateText] = useState('');
  const [extractions, setExtractions] = useState<RequestExtractionRule[]>([]);
  const [beforeRunChain, setBeforeRunChain] = useState<BeforeRunStep[]>([]);
  const [chainSteps, setChainSteps] = useState<RequestChainStep[]>([]);
  const [showChainPicker, setShowChainPicker] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [bodyErrorLine, setBodyErrorLine] = useState<number | null>(null);
  const hasHydratedRef = useRef(false);
  const isHydratingRef = useRef(false);
  
  const { isRunning, setIsRunning, setResponse, addLog, setDirty, dirtyRequests, scratchpadRequestData } = useAppStore();
  const clearScratchpadRequestData = useAppStore(state => state.clearScratchpadRequestData);
  const isDirty = dirtyRequests.has(requestId);
  const scratchpadRequest = scratchpadRequestData[requestId];
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
    return flattenRequestOptions(sidebarTree);
  }, [sidebarTree]);

  // Hydration
  useEffect(() => {
    async function loadRequest() {
      if (projectPath) {
        try {
          isHydratingRef.current = true;
          const req: any = await invoke('get_request', {
            projectRoot: projectPath,
            id: requestId,
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

          const authHeader = Array.isArray(req.headers) ? req.headers.find((h: any) => String(h.key).trim().toLowerCase() === 'authorization' && String(h.value || '').trim().toLowerCase().startsWith('bearer ')) : null;
          if (authHeader) {
            const bearerValue = String(authHeader.value || '').replace(/^bearer\s+/i, '');
            setAuthorization({ mode: 'bearer', value: bearerValue });
          } else {
            setAuthorization({ mode: 'none', value: '' });
          }

          if (req.params && Array.isArray(req.params)) {
            setParams(req.params.map((p: any) => ({ id: Math.random().toString(36).substring(2, 9), ...p })));
          } else {
            setParams([]);
          }

          const initialState = {
            method: req.method || 'GET',
            url: req.url || '',
            headers: (req.headers || []).map((h: any) => ({ key: h.key, value: h.value, enabled: h.enabled })),
            authorization: authHeader ? { mode: 'bearer', value: String(authHeader.value || '').replace(/^bearer\s+/i, '') } : { mode: 'none', value: '' },
            params: (req.params || []).map((p: any) => ({ key: p.key, value: p.value, enabled: p.enabled })),
            bodyMode: normalizeBodyMode(req.body?.mode),
            body: getHydratedBodySnapshot(req.body),
            formBody: getHydratedFormBodySnapshot(req.body),
            transforms: {
              pre_request_template: req.transforms?.pre_request_template || '',
              response_extractions: req.transforms?.response_extractions || [],
              before_run: req.transforms?.before_run?.map((step: any) => ({ request_id: step.request_id })) || [],
              chain_steps: req.transforms?.chain_steps?.map((step: any) => ({ when: step.when, next_request_id: step.next_request_id })) || [],
            },
          };
          setTemplateText(req.transforms?.pre_request_template || '');
          setExtractions(req.transforms?.response_extractions || []);
          setBeforeRunChain((req.transforms?.before_run || []).map((step: any) => ({ request_id: step.request_id })));
          setChainSteps(req.transforms?.chain_steps || []);
          savedStateRef.current = initialState;
          hasHydratedRef.current = true;
          setDirty(requestId, false);
          if (scratchpadRequest) {
            clearScratchpadRequestData(requestId);
          }
          isHydratingRef.current = false;
          return;
        } catch (err) {
          console.error("Failed to load request", err);
          isHydratingRef.current = false;
          // If it doesn't exist in the workspace, fall back to scratchpad/new-request behavior.
        }
      }

      if (scratchpadRequest) {
        isHydratingRef.current = true;
        const req = scratchpadRequest;
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
        const scratchAuthHeader = Array.isArray(req.headers) ? req.headers.find((h: any) => String(h.key).trim().toLowerCase() === 'authorization' && String(h.value || '').trim().toLowerCase().startsWith('bearer ')) : null;
        setAuthorization(scratchAuthHeader ? { mode: 'bearer', value: String(scratchAuthHeader.value || '').replace(/^bearer\s+/i, '') } : { mode: 'none', value: '' });
        if (req.params) setParams(req.params.map((p: any) => ({ id: Math.random().toString(36).substring(2, 9), ...p })));
        setTemplateText(req.transforms?.pre_request_template || '');
        setExtractions(req.transforms?.response_extractions || []);
        setBeforeRunChain(req.transforms?.before_run?.map((step: any) => ({ request_id: step.request_id })) || []);
        setChainSteps(req.transforms?.chain_steps?.map((step: any) => ({ when: step.when, next_request_id: step.next_request_id })) || []);
        savedStateRef.current = {
          transforms: req.transforms || {
            pre_request_template: '',
            response_extractions: [],
            before_run: [],
            chain_steps: [],
          },
          method: req.method || 'GET',
          url: req.url || '',
          headers: (req.headers || []).map((h: any) => ({ key: h.key, value: h.value, enabled: h.enabled })),
          authorization: scratchAuthHeader ? { mode: 'bearer', value: String(scratchAuthHeader.value || '').replace(/^bearer\s+/i, '') } : { mode: 'none', value: '' },
          params: (req.params || []).map((p: any) => ({ key: p.key, value: p.value, enabled: p.enabled })),
          bodyMode: normalizeBodyMode(req.body?.mode),
          body: getHydratedBodySnapshot(req.body),
          formBody: getHydratedFormBodySnapshot(req.body),
        };
        hasHydratedRef.current = true;
        setDirty(requestId, false);
        isHydratingRef.current = false;
        return;
      }

      if (!projectPath) {
        // Wait for workspace rehydration before deciding whether this is a scratchpad request.
        return;
      }

      savedStateRef.current = {
        method: 'GET',
        url: '',
        headers: [],
        authorization: { mode: 'none', value: '' },
        params: [],
        bodyMode: 'json',
        body: '',
        formBody: [],
        transforms: {
          pre_request_template: '',
          response_extractions: [],
          before_run: [],
          chain_steps: [],
        },
      };
      hasHydratedRef.current = true;
      setTemplateText('');
      setExtractions([]);
      setBeforeRunChain([]);
      setChainSteps([]);
      setDirty(requestId, true); // Mark as dirty since it doesn't exist on disk
      isHydratingRef.current = false;
    }
    loadRequest();
  }, [requestId, projectPath, scratchpadRequest, getRequestName, setDirty, clearScratchpadRequestData]);

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

  const updateFormField = (index: number, patch: Partial<KeyValue>) => {
    setFormBody(current => current.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  useEffect(() => {
    const handleGlobalKeydown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveRequest();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        void handleRun();
      }
    };
    window.addEventListener('keydown', handleGlobalKeydown);
    return () => window.removeEventListener('keydown', handleGlobalKeydown);
  }, [method, url, headers, body, requestId]);

  useEffect(() => {
    if (!hasHydratedRef.current) return;
    if (isHydratingRef.current) return;

    const currentState = {
      method,
      url,
      headers: headers.map(h => ({ key: h.key, value: h.value, enabled: h.enabled })),
      authorization,
      params: params.map(p => ({ key: p.key, value: p.value, enabled: p.enabled })),
      bodyMode,
      body,
      formBody: formBody.map(item => ({ key: item.key, value: item.value, enabled: item.enabled })),
      transforms: getTransformsState(templateText, extractions, beforeRunChain, chainSteps),
    };

    if (!projectPath) {
      // Do not infer scratchpad state during workspace startup rehydration.
      // If this tab was restored from a workspace, persisting it here would
      // contaminate scratchpad storage and cause future launches to hydrate
      // the wrong source.
      if (!savedStateRef.current) {
        return;
      }

      // Existing scratchpad tabs can still mirror their state locally, but we
      // avoid writing a workspace tab into persisted scratchpad data here.
      return;
    }

    if (!savedStateRef.current) {
      setDirty(requestId, true);
      return;
    }

    const isDirty = JSON.stringify(currentState) !== JSON.stringify(savedStateRef.current);
    setDirty(requestId, isDirty);
  }, [
    method,
    url,
    headers,
    authorization,
    params,
    bodyMode,
    body,
    formBody,
    templateText,
    extractions,
    beforeRunChain,
    chainSteps,
    requestId,
    setDirty,
    pendingNames,
    projectPath,
  ]);

  const buildFormattedRequest = () => {
    return getFormattedRequest({
      requestId,
      requestName: getRequestName(requestId),
      method,
      url,
      headers,
      authorization,
      params,
      bodyMode,
      body,
      formBody,
      templateText,
      extractions,
      beforeRunChain,
      chainSteps,
    });
  };

  const cancelRun = async () => {
    try {
      await invoke('cancel_firv_request');
      addLog(`Canceled request ${requestId}`);
    } catch (err) {
      console.error('Failed to cancel request', err);
      addLog(`Error canceling request: ${err}`);
    } finally {
      setIsRunning(false);
    }
  };

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
        request: buildFormattedRequest()
      });
      
      savedStateRef.current = {
        method,
        url,
        headers: headers.map(h => ({ key: h.key, value: h.value, enabled: h.enabled })),
        authorization,
        params: params.map(p => ({ key: p.key, value: p.value, enabled: p.enabled })),
        bodyMode,
        body,
        formBody: formBody.map(item => ({ key: item.key, value: item.value, enabled: item.enabled })),
        transforms: {
          pre_request_template: templateText,
          response_extractions: extractions,
          before_run: beforeRunChain.map(step => ({ request_id: step.request_id })),
          chain_steps: chainSteps.map(step => ({ when: step.when, next_request_id: step.next_request_id }))
        }
      };
      setDirty(requestId, false);

      addLog(`Saved request ${requestId}`);
    } catch (err) {
      console.error("Failed to save", err);
      addLog(`Error saving: ${err}`);
    }
  };

  const handleRun = async () => {
    if (isRunning) {
      await cancelRun();
      return;
    }
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
        request: buildFormattedRequest(),
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
      <RequestEditorCommandBar
        method={method}
        url={url}
        onMethodChange={setMethod}
        onUrlChange={setUrl}
        onSave={saveRequest}
        onRun={handleRun}
        isRunning={isRunning}
        isDirty={isDirty}
        projectPath={projectPath}
        validationError={validationError}
      />

      <div className="px-4 py-2 border-b border-border bg-muted/30">
        <div className="flex bg-muted p-1 rounded-lg w-fit">
          {['params', 'headers', 'body', 'transforms'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab as any)}
              className={twMerge(
                'px-4 py-1.5 text-xs font-semibold rounded-md transition-all uppercase tracking-tight',
                activeTab === tab ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'transforms' ? (
        <div className="flex-1 overflow-auto p-4 custom-scrollbar">
          <div className="max-w-5xl h-full flex flex-col">
            <RequestEditorTransformsSection
              templateText={templateText}
              onTemplateTextChange={setTemplateText}
              extractions={extractions}
              onAddExtraction={addExtraction}
              onUpdateExtraction={updateExtraction}
              onRemoveExtraction={removeExtraction}
              beforeRunChain={beforeRunChain}
              onBeforeRunChainChange={setBeforeRunChain}
              chainSteps={chainSteps}
              onChainStepsChange={setChainSteps}
              showChainPicker={showChainPicker}
              onToggleChainPicker={() => setShowChainPicker(v => !v)}
              onAddChainStep={addChainStep}
              requestOptions={requestOptions}
              getRequestName={getRequestName}
            />
          </div>
        </div>
      ) : (
        <RequestEditorBodySection
          activeTab={activeTab}
          headers={headers}
          authorization={authorization}
          params={params}
          body={body}
          bodyMode={bodyMode}
          jsonViewMode={jsonViewMode}
          onBodyModeChange={setBodyMode}
          onJsonViewModeChange={setJsonViewMode}
          onBodyChange={setBody}
          onHeadersChange={setHeaders}
          onAuthorizationChange={setAuthorization}
          onParamsChange={setParams}
          formBody={formBody}
          onAddFormField={() => setFormBody(current => [...current, { id: Math.random().toString(36).substring(2, 9), key: '', value: '', enabled: true } as any])}
          onRemoveFormField={index => setFormBody(current => current.filter((_, i) => i !== index))}
          onUpdateFormField={updateFormField}
          bodyErrorLine={bodyErrorLine}
        />
      )}
    </div>
  );
}
