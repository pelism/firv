import { useState, useEffect } from 'react';
import { Send, Settings, Save } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { KVEditor, KeyValue } from './editors/KVEditor';
import { BodyEditor } from './editors/BodyEditor';
import { useAppStore } from '../store/appStore';
import { useSidebarStore } from '../store/sidebarStore';
import { twMerge } from 'tailwind-merge';

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
          projectRoot: '.', 
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
    name: 'Unknown Request', 
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
    if (isRunning) return; 
    setIsRunning(true);
    try {
      addLog(`Running request ${method} ${url}...`);
      const result: any = await invoke('run_firv_request', {
        request: getFormattedRequest(),
        initialVars: {} 
      });
      
      if (result.logs && Array.isArray(result.logs)) {
        result.logs.forEach((log: string) => addLog(`[Script] ${log}`));
      }
      if (result.script_errors && Array.isArray(result.script_errors)) {
        result.script_errors.forEach((err: string) => addLog(`[Script Error] ${err}`));
      }
      
      setResponse(requestId, result.response);
      addLog(`Request completed successfully in ${result.execution_time_ms}ms.`);
    } catch (e: any) {
      console.error(e);
      addLog(`Error: ${e.toString()}`);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0 bg-white dark:bg-zinc-950 w-full">
      {/* Unified Command Bar */}
      <div className="p-4 border-b border-zinc-200 dark:border-zinc-800">
        <div className="flex items-stretch gap-2 bg-zinc-100 dark:bg-zinc-900 p-1 rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-800 shadow-sm">
          <select 
            value={method} 
            onChange={e => setMethod(e.target.value)}
            className="px-4 bg-transparent font-bold text-xs uppercase tracking-wider text-indigo-500 dark:text-indigo-400 outline-none border-r border-zinc-200 dark:border-zinc-800"
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
            className="flex-1 px-3 py-2 bg-transparent text-sm outline-none text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400"
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleRun();
            }}
          />
          
          <div className="flex items-center gap-1 pr-1">
            <button 
              onClick={saveRequest}
              className="p-2 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
              title="Save (Ctrl+S)"
            >
              <Save size={18} />
            </button>
            <button 
              onClick={handleRun}
              disabled={isRunning}
              className={twMerge(
                "flex items-center gap-2 px-4 py-1.5 rounded-lg text-white font-bold text-sm transition-all shadow-md active:scale-95",
                isRunning ? 'bg-zinc-400' : 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-600/30'
              )}
            >
              <Send size={16} className={isRunning ? 'animate-pulse' : ''} />
              {isRunning ? 'Sending' : 'Send'}
            </button>
          </div>
        </div>
      </div>

      {/* Segmented Editor Tabs */}
      <div className="px-4 py-2 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
        <div className="flex bg-zinc-200/50 dark:bg-zinc-800/50 p-1 rounded-lg w-fit">
          {['params', 'headers', 'body', 'scripts'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab as any)}
              className={twMerge(
                "px-4 py-1.5 text-xs font-semibold rounded-md transition-all uppercase tracking-tight",
                activeTab === tab 
                  ? "bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm" 
                  : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
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
                <div className="flex gap-2 bg-zinc-100 dark:bg-zinc-900 p-1 rounded-lg ring-1 ring-zinc-200 dark:ring-zinc-800">
                  {['none', 'json', 'yaml', 'raw'].map(mode => (
                    <button
                      key={mode}
                      onClick={() => setBodyMode(mode as any)}
                      className={twMerge(
                        "px-3 py-1 text-[10px] font-bold uppercase rounded-md transition-all",
                        bodyMode === mode 
                          ? "bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm"
                          : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                      )}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
                <button className="p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-md transition-colors">
                  <Settings size={16} />
                </button>
              </div>
              <div className="flex-1 min-h-[300px] border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden shadow-sm">
                {bodyMode !== 'none' ? (
                  <BodyEditor value={body} mode={bodyMode} onChange={setBody} />
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-zinc-400 text-sm space-y-2 bg-zinc-50/50 dark:bg-zinc-900/50">
                    <div className="p-3 rounded-full bg-zinc-100 dark:bg-zinc-800/50">
                      <Settings size={24} className="opacity-50" />
                    </div>
                    <p className="font-medium">No Request Body</p>
                    <p className="text-xs">Select a mode above to add a body.</p>
                  </div>
                )}
              </div>
            </div>
          )}
          {activeTab === 'scripts' && (
            <div className="text-zinc-400 flex flex-col items-center justify-center h-full space-y-4">
               <div className="p-4 rounded-full bg-zinc-100 dark:bg-zinc-900">
                <Settings size={32} className="opacity-20 animate-spin-slow" />
              </div>
              <div className="text-center">
                <p className="font-medium text-zinc-600 dark:text-zinc-300">Scripts Editor</p>
                <p className="text-sm">Under development for next release.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
