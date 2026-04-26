import { useState, useEffect } from 'react';
import { Play, Settings } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { KVEditor, KeyValue } from './editors/KVEditor';
import { BodyEditor } from './editors/BodyEditor';
import { useAppStore } from '../store/appStore';
import { useSidebarStore } from '../store/sidebarStore';

interface RequestEditorProps {
  requestId: string;
}

export function RequestEditor({ requestId }: RequestEditorProps) {
  const [method, setMethod] = useState('GET');
  const [url, setUrl] = useState('');
  const [activeTab, setActiveTab] = useState<'params'|'headers'|'body'|'scripts'>('params');
  const [headers, setHeaders] = useState<KeyValue[]>([]);
  const [params, setParams] = useState<KeyValue[]>([]);
  const [body, setBody] = useState('');
  const [bodyMode, setBodyMode] = useState<'json'|'yaml'|'raw'|'none'>('json');
  
  const { isRunning, setIsRunning, setResponse, addLog } = useAppStore();
  const { tree, syncTreeToBackend, projectPath } = useSidebarStore();

  // Hydration
  useEffect(() => {
    async function loadRequest() {
      try {
        const req: any = await invoke('get_request', { 
          projectRoot: '.', // For now hardcoded or get from state
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
      } catch (err) {
        console.error("Failed to load request", err);
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

  const getFormattedBody = () => {
    if (bodyMode === 'none') return { mode: 'none' };
    if (bodyMode === 'json') return { mode: 'json', data: body };
    return { mode: 'raw', data: body };
  };

  const getFormattedRequest = () => ({
    id: requestId,
    name: 'Unknown Request', // Or get it from the tree state if needed
    method,
    url,
    headers: headers.map(h => ({ key: h.key, value: h.value, enabled: h.enabled })),
    params: params.map(p => ({ key: p.key, value: p.value, enabled: p.enabled })),
    body: getFormattedBody(),
    scripts: { pre: null, post: null }
  });

  const saveRequest = async () => {
    try {
      await invoke('update_request', {
        projectRoot: projectPath || '.',
        request: getFormattedRequest()
      });
      await syncTreeToBackend(tree);
      addLog(`Saved request ${requestId}`);
    } catch (err) {
      console.error("Failed to save", err);
      addLog(`Error saving: ${err}`);
    }
  };
  const handleRun = async () => {
    if (isRunning) return; // Prevent double click or add stop logic
    setIsRunning(true);
    try {
      addLog(`Running request ${method} ${url}...`);
      // Calling rust backend
      const result: any = await invoke('run_firv_request', {
        request: getFormattedRequest(),
        initialVars: {} // Provide an empty dictionary for now, can pull from environment/variables store later
      });
      
      if (result.logs && Array.isArray(result.logs)) {
        result.logs.forEach((log: string) => addLog(`[Script] ${log}`));
      }
      if (result.script_errors && Array.isArray(result.script_errors)) {
        result.script_errors.forEach((err: string) => addLog(`[Script Error] ${err}`));
      }
      
      setResponse(result.response);
      addLog(`Request completed successfully in ${result.execution_time_ms}ms.`);
    } catch (e: any) {
      console.error(e);
      addLog(`Error: ${e.toString()}`);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0 bg-white dark:bg-gray-900 w-full">
      {/* Request Header */}
      <div className="flex items-center gap-2 p-4 border-b border-gray-200 dark:border-gray-800">
        <select 
          value={method} 
          onChange={e => setMethod(e.target.value)}
          className="px-3 py-2 bg-gray-100 dark:bg-gray-800 rounded font-semibold text-sm border-none outline-none focus:ring-2 focus:ring-blue-500"
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
          placeholder="https://api.example.com/endpoint"
          className="flex-1 px-4 py-2 bg-gray-100 dark:bg-gray-800 rounded text-sm border-none outline-none focus:ring-2 focus:ring-blue-500"
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleRun();
          }}
        />
        
        <button 
          onClick={handleRun}
          disabled={isRunning}
          className={`flex items-center gap-2 px-6 py-2 rounded text-white font-semibold transition-colors ${isRunning ? 'bg-gray-400' : 'bg-green-500 hover:bg-green-600'}`}
        >
          <Play size={16} className={isRunning ? 'animate-pulse' : ''} />
          {isRunning ? 'Running...' : 'RUN'}
        </button>
        
        <button className="p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 rounded">
          <Settings size={20} />
        </button>
      </div>

      {/* Editor Tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-800">
        {['params', 'headers', 'body', 'scripts'].map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab as any)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === tab ? 'border-blue-500 text-blue-600 dark:text-blue-400' : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* Editor Content */}
      <div className="flex-1 overflow-auto p-4">
        {activeTab === 'headers' && (
          <KVEditor data={headers} onChange={setHeaders} placeholderKey="Header Name" placeholderValue="Value" />
        )}
        {activeTab === 'params' && (
          <KVEditor data={params} onChange={setParams} placeholderKey="Query Param" placeholderValue="Value" />
        )}
        {activeTab === 'body' && (
          <div className="h-full flex flex-col">
            <div className="mb-2 flex gap-2">
              <select value={bodyMode} onChange={e => setBodyMode(e.target.value as any)} className="text-sm px-2 py-1 bg-gray-100 dark:bg-gray-800 rounded border-none outline-none">
                <option value="none">None</option>
                <option value="json">JSON</option>
                <option value="yaml">YAML</option>
                <option value="raw">Raw</option>
              </select>
            </div>
            <div className="flex-1 border rounded overflow-hidden border-gray-200 dark:border-gray-800">
              {bodyMode !== 'none' ? (
                <BodyEditor value={body} mode={bodyMode} onChange={setBody} />
              ) : (
                <div className="h-full flex items-center justify-center text-gray-400 text-sm">
                  This request does not have a body.
                </div>
              )}
            </div>
          </div>
        )}
        {activeTab === 'scripts' && (
          <div className="text-gray-500 flex items-center justify-center h-full">Scripts editor coming soon...</div>
        )}
      </div>
    </div>
  );
}
