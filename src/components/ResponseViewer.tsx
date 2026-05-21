import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { Download, Search, Activity, Database, Clock, FileJson, Globe, Copy } from 'lucide-react';
import { twMerge } from 'tailwind-merge';

export interface FirvResponse {
  status: number;
  status_text: string;
  headers: Record<string, string>;
  body: string;
  time_ms: number;
  size_bytes: number;
}

interface ResponseViewerProps {
  response: FirvResponse | null;
}

type TraceableResponse = FirvResponse & {
  __trace?: Record<string, string>;
  __request?: any;
  __errors?: string[];
  __variable_trace?: Array<{ key: string; value: string; scope: string; source: string }>;
  __before_run_results?: Array<{ request_id: string; success: boolean; status: number | null; execution_time_ms: number }>;
  __chained_results?: Array<{ request_id: string; success: boolean; status: number | null; execution_time_ms: number }>;
};

// Basic virtualized JSON tree node
interface JsonNode {
  keyName: string;
  value: any;
  path: string;
  depth: number;
  isObject: boolean;
  isArray: boolean;
  isEnd: boolean; // closing bracket
  hasChildren: boolean;
  size: number;
}

// A simple recursive flattener
function flattenJson(
  obj: any,
  expandedPaths: Set<string>,
  depth: number = 0,
  path: string = '$',
  keyName: string = ''
): JsonNode[] {
  let result: JsonNode[] = [];
  const isObject = typeof obj === 'object' && obj !== null && !Array.isArray(obj);
  const isArray = Array.isArray(obj);
  
  const hasChildren = (isObject && Object.keys(obj).length > 0) || (isArray && obj.length > 0);
  const size = isObject ? Object.keys(obj).length : (isArray ? obj.length : 0);
  
  result.push({ keyName, value: obj, path, depth, isObject, isArray, isEnd: false, hasChildren, size });
  
  if (hasChildren && expandedPaths.has(path)) {
    if (isObject) {
      for (const [k, v] of Object.entries(obj)) {
        result = result.concat(flattenJson(v, expandedPaths, depth + 1, `${path}.${k}`, k));
      }
      result.push({ keyName: '', value: null, path: `${path}_end`, depth, isObject, isArray, isEnd: true, hasChildren: false, size: 0 });
    } else if (isArray) {
      for (let i = 0; i < obj.length; i++) {
        result = result.concat(flattenJson(obj[i], expandedPaths, depth + 1, `${path}[${i}]`, String(i)));
      }
      result.push({ keyName: '', value: null, path: `${path}_end`, depth, isObject, isArray, isEnd: true, hasChildren: false, size: 0 });
    }
  }
  return result;
}

export function ResponseViewer({ response }: ResponseViewerProps) {
  const [mode, setMode] = useState<'Pretty' | 'Raw'>('Pretty');
  const [searchQuery, setSearchQuery] = useState('');
  const [jmesQuery, setJmesQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'Body' | 'Headers' | 'Trace'>('Body');
  
  const [parsedData, setParsedData] = useState<any>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [parseError, setParseError] = useState('');
  
  const workerRef = useRef<Worker | null>(null);
  const msgIdCounter = useRef(0);
  
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set(['$']));

  useEffect(() => {
    // Initialize Web Worker
    workerRef.current = new Worker(new URL('../workers/responseWorker.ts', import.meta.url), { type: 'module' });
    
    return () => {
      workerRef.current?.terminate();
    };
  }, []);

  const traceableResponse = response as TraceableResponse | null;
  const safeResponse = response || { status: 0, status_text: '', time_ms: 0, size_bytes: 0, body: '', headers: {} };
  const { status, status_text, time_ms, size_bytes, body } = safeResponse;
  const headers = safeResponse.headers ?? {};
  const trace = traceableResponse?.__trace || {};
  const requestInfo = traceableResponse?.__request || null;
  const errors = traceableResponse?.__errors || [];
  const variableTrace = traceableResponse?.__variable_trace || [];
  const beforeRunResults = traceableResponse?.__before_run_results || [];
  const chainedResults = traceableResponse?.__chained_results || [];
  const isLarge = size_bytes > 5 * 1024 * 1024;

  useEffect(() => {
    if (!response || mode !== 'Pretty') return;
    
    const isJson = headers['content-type']?.includes('application/json');
    if (!isJson) return;
    
    setIsParsing(true);
    setParseError('');
    
    const id = ++msgIdCounter.current;
    
    const handleMessage = (e: MessageEvent) => {
      if (e.data.id === id) {
        if (e.data.type === 'SUCCESS') {
          setParsedData(e.data.payload.parsed);
        } else {
          setParseError(e.data.payload);
        }
        setIsParsing(false);
      }
    };
    
    workerRef.current?.addEventListener('message', handleMessage);
    workerRef.current?.postMessage({
      type: 'PARSE_AND_FILTER',
      payload: { body, jmesQuery },
      id
    });
    
    return () => {
      workerRef.current?.removeEventListener('message', handleMessage);
    };
  }, [body, jmesQuery, mode, headers, response]);

  const toggleExpand = useCallback((path: string) => {
    setExpandedPaths(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const flattenedData = useMemo(() => {
    if (!parsedData) return [];
    return flattenJson(parsedData, expandedPaths);
  }, [parsedData, expandedPaths]);

  const handleCopyPath = (e: React.MouseEvent, path: string) => {
    e.preventDefault();
    navigator.clipboard.writeText(path);
  };

  const renderNode = (_index: number, node: JsonNode) => {
    const { keyName, value, path, depth, isArray, isEnd, hasChildren, size } = node;
    
    const renderText = (text: string) => {
      if (!searchQuery) return text;
      const parts = String(text).split(new RegExp(`(${searchQuery})`, 'gi'));
      return parts.map((part, i) => 
        part.toLowerCase() === searchQuery.toLowerCase() ? <mark key={i} className="bg-primary/20 text-primary rounded px-0.5">{part}</mark> : part
      );
    };

    if (isEnd) {
      return (
        <div style={{ paddingLeft: `${depth * 24}px` }} className="font-mono text-xs text-muted-foreground py-0.5" onContextMenu={(e) => handleCopyPath(e, path)}>
          {isArray ? ']' : '}'}
        </div>
      );
    }

    return (
      <div 
        style={{ paddingLeft: `${depth * 24}px` }} 
        className="font-mono text-xs hover:bg-muted/50 flex items-center py-0.5 group relative"
        onContextMenu={(e) => handleCopyPath(e, path)}
      >
        {depth > 0 && <div className="absolute left-[-12px] top-0 bottom-0 w-[1px] bg-border" />}
        
        {hasChildren ? (
          <button onClick={() => toggleExpand(path)} className="w-4 h-4 flex items-center justify-center text-muted-foreground mr-1 hover:text-primary transition-colors">
            {expandedPaths.has(path) ? '▾' : '▸'}
          </button>
        ) : (
          <span className="w-4 mr-1 inline-block"></span>
        )}
        
        {keyName && (
          <span className="text-json-key mr-2" title="Right click to copy path">
            "{renderText(keyName)}":
          </span>
        )}
        
        {hasChildren ? (
          <span className="text-muted-foreground">
            {isArray ? '[' : '{'} {!expandedPaths.has(path) && <span className="text-[10px] text-muted-foreground/60 ml-1 font-sans italic">{size} items {isArray ? ']' : '}'}</span>}
          </span>
        ) : (
          <span className={twMerge(
            typeof value === 'number' ? 'text-json-number' : 
            typeof value === 'string' ? 'text-json-string' : 
            typeof value === 'boolean' ? 'text-json-boolean' : 
            'text-muted-foreground'
          )}>
            {typeof value === 'string' ? `"${renderText(value)}"` : renderText(String(value))}
          </span>
        )}
      </div>
    );
  };

  const handleSave = async () => {
    try {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const { writeTextFile } = await import('@tauri-apps/plugin-fs');
      const filePath = await save({ defaultPath: 'response.json' });
      if (filePath) {
        await writeTextFile(filePath, body);
      }
    } catch (err) {
      console.error('Failed to save file:', err);
    }
  };

  const handleCopyResponse = async () => {
    try {
      await navigator.clipboard.writeText(body);
    } catch (err) {
      console.error('Failed to copy response:', err);
    }
  };

  if (!response) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center space-y-4 bg-muted/30 text-muted-foreground">
        <div className="p-6 rounded-full bg-muted shadow-inner relative group/icon">
          <div className="absolute inset-0 bg-primary/20 blur-2xl rounded-full opacity-0 group-hover/icon:opacity-100 transition-opacity duration-500" />
          <Activity size={48} className="relative z-10 opacity-20 group-hover:opacity-40 text-primary transition-all duration-500" />
        </div>
        <div className="text-center">
          <p className="font-semibold text-foreground/60">Ready for Request</p>
          <p className="text-xs">Send a request to see the response here.</p>
        </div>
      </div>
    );
  }

  const isJson = headers['content-type']?.includes('application/json');
  
  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">
      {/* Metric Bar */}
      <div className="px-4 py-3 border-b border-border flex items-center justify-between bg-muted/30">
        <div className="flex gap-2">
          <div className={twMerge(
            "flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold ring-1 shadow-sm",
            status >= 400 
              ? "bg-destructive/10 text-destructive ring-destructive/20 shadow-destructive/10" 
              : "bg-emerald-500/10 text-emerald-500 ring-emerald-500/20 shadow-emerald-500/10"
          )}>
            <div className={twMerge("w-1.5 h-1.5 rounded-full animate-pulse", status >= 400 ? "bg-destructive" : "bg-emerald-500")} />
            {status} {status_text}
          </div>
          
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold text-muted-foreground bg-muted ring-1 ring-border">
            <Clock size={12} className="opacity-60" />
            {time_ms} ms
          </div>
          
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold text-muted-foreground bg-muted ring-1 ring-border">
            <Database size={12} className="opacity-60" />
            {(size_bytes / 1024).toFixed(2)} KB
          </div>
        </div>

        <div className="flex gap-2 items-center">
          <select 
            value={mode} 
            onChange={e => setMode(e.target.value as any)}
            className="text-[11px] font-bold uppercase tracking-wider bg-background border border-border rounded-lg px-3 py-1 outline-none focus:ring-2 focus:ring-primary/20 transition-all cursor-pointer"
          >
            <option value="Pretty">Pretty</option>
            <option value="Raw">Raw</option>
          </select>
          <button 
            onClick={handleCopyResponse}
            className="p-1.5 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-lg transition-all"
            title="Copy Response"
          >
            <Copy size={18} />
          </button>
          <button 
            onClick={handleSave}
            className="p-1.5 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-lg transition-all"
            title="Download Response"
          >
            <Download size={18} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex px-4 border-b border-border bg-background">
        <button 
          className={twMerge(
            "px-4 py-2 text-xs font-bold uppercase tracking-wider transition-all relative",
            activeTab === 'Body' 
              ? "text-primary" 
              : "text-muted-foreground hover:text-foreground"
          )}
          onClick={() => setActiveTab('Body')}
        >
          <span className="flex items-center gap-2">
            <FileJson size={14} />
            Body
          </span>
          {activeTab === 'Body' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-t-full" />}
        </button>
        <button 
          className={twMerge(
            "px-4 py-2 text-xs font-bold uppercase tracking-wider transition-all relative",
            activeTab === 'Headers' 
              ? "text-primary" 
              : "text-muted-foreground hover:text-foreground"
          )}
          onClick={() => setActiveTab('Headers')}
        >
          <span className="flex items-center gap-2">
            <Globe size={14} />
            Headers
            <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded-full text-muted-foreground">{Object.keys(headers).length}</span>
          </span>
          {activeTab === 'Headers' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-t-full" />}
        </button>

        <button 
          className={twMerge(
            "px-4 py-2 text-xs font-bold uppercase tracking-wider transition-all relative",
            activeTab === 'Trace' 
              ? "text-primary" 
              : "text-muted-foreground hover:text-foreground"
          )}
          onClick={() => setActiveTab('Trace')}
        >
          <span className="flex items-center gap-2">
            <Database size={14} />
            Trace
            <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded-full text-muted-foreground">{Object.keys(trace).length}</span>
          </span>
          {activeTab === 'Trace' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-t-full" />}
        </button>
      </div>

      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {activeTab === 'Body' && (
          <>
            {mode === 'Pretty' && isJson && (
              <div className="p-3 border-b border-border flex gap-3 bg-muted/10">
                <div className="relative flex-1">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder="Search response..."
                    className="w-full pl-9 pr-3 py-1.5 text-xs bg-background border border-border rounded-lg outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                  />
                </div>
                <input
                  type="text"
                  placeholder="JMESPath Filter"
                  className="flex-1 px-3 py-1.5 text-xs font-mono bg-background border border-border rounded-lg outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                  value={jmesQuery}
                  onChange={e => setJmesQuery(e.target.value)}
                />
              </div>
            )}

            <div className="flex-1 overflow-auto bg-background custom-scrollbar">
              {isLarge && mode === 'Pretty' && (
                <div className="m-2 p-2 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[10px] font-bold rounded-lg ring-1 ring-amber-500/20 flex justify-center">
                  Large response: performance optimizations active
                </div>
              )}

              {mode === 'Raw' || !isJson ? (
                <pre className="p-6 text-xs font-mono whitespace-pre-wrap text-foreground bg-muted/5">{body}</pre>
              ) : mode === 'Pretty' && isParsing ? (
                <div className="p-12 text-center text-muted-foreground">
                  <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                  <p className="text-xs font-medium">Analyzing Data...</p>
                </div>
              ) : mode === 'Pretty' && parseError ? (
                <div className="m-4 p-4 text-destructive font-mono text-xs bg-destructive/10 rounded-xl ring-1 ring-destructive/20">{parseError}</div>
              ) : mode === 'Pretty' && parsedData !== null ? (
                <div className="p-4 h-full">
                  <Virtuoso
                    totalCount={flattenedData.length}
                    itemContent={(index) => renderNode(index, flattenedData[index])}
                    style={{ height: '100%', width: '100%' }}
                    className="custom-scrollbar"
                  />
                </div>
              ) : null}
            </div>
          </>
        )}

        {activeTab === 'Headers' && (
          <div className="flex-1 overflow-auto bg-background custom-scrollbar p-6">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-border">
                  <th className="pb-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Key</th>
                  <th className="pb-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {Object.entries(headers).map(([key, value]) => (
                  <tr key={key} className="group">
                    <td className="py-3 pr-6 font-mono text-xs font-semibold text-muted-foreground w-1/3 align-top group-hover:text-primary transition-colors">{key}</td>
                    <td className="py-3 font-mono text-xs text-foreground/80 break-all">{value}</td>
                  </tr>
                ))}
                {Object.keys(headers).length === 0 && (
                  <tr>
                    <td colSpan={2} className="py-12 text-center text-muted-foreground italic text-sm">No headers received</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'Trace' && (
          <div className="flex-1 overflow-auto bg-background custom-scrollbar p-4 space-y-4">
            {errors.length > 0 && (
              <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-400">
                <h3 className="text-xs font-bold uppercase tracking-wider mb-2">Execution Errors</h3>
                <ul className="list-disc pl-5 space-y-1">
                  {errors.map((err, idx) => <li key={idx}>{err}</li>)}
                </ul>
              </div>
            )}

            <div className="rounded-xl border border-border bg-muted/20 p-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">Resolved Variables</h3>
              {Object.keys(trace).length === 0 ? (
                <div className="text-sm text-muted-foreground">No variables were returned by the run.</div>
              ) : (
                <div className="space-y-2 font-mono text-xs">
                  {Object.entries(trace).map(([key, value]) => (
                    <div key={key} className="grid grid-cols-[160px_1fr] gap-3 items-start">
                      <div className="text-primary font-semibold break-all">{key}</div>
                      <div className="break-all text-foreground/80">{value}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-border bg-muted/20 p-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">Before-Run Requests</h3>
              {beforeRunResults.length === 0 ? (
                <div className="text-sm text-muted-foreground">No before-run requests were executed.</div>
              ) : (
                <div className="space-y-2">
                  {beforeRunResults.map((entry, idx) => (
                    <div key={`${entry.request_id}-${idx}`} className="rounded-lg border border-border bg-background/60 p-3 text-xs flex items-center justify-between gap-3">
                      <div className="space-y-1">
                        <div className="font-mono font-semibold break-all">{entry.request_id}</div>
                        <div className="text-muted-foreground">{entry.execution_time_ms} ms</div>
                      </div>
                      <div className={twMerge(
                        "px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider",
                        entry.success ? "bg-emerald-500/10 text-emerald-600" : "bg-red-500/10 text-red-600"
                      )}>
                        {entry.success ? `status ${entry.status ?? 'ok'}` : `status ${entry.status ?? 'fail'}`}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-border bg-muted/20 p-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">Variable Source</h3>
              {variableTrace.length === 0 ? (
                <div className="text-sm text-muted-foreground">No source details were returned.</div>
              ) : (
                <div className="space-y-2">
                  {variableTrace.map((entry, idx) => (
                    <div key={`${entry.key}-${idx}`} className="rounded-lg border border-border bg-background/60 p-3 text-xs font-mono space-y-1">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-primary font-semibold break-all">{entry.key}</span>
                        <span className="text-muted-foreground">{entry.scope}</span>
                      </div>
                      <div className="text-foreground/80 break-all">{entry.value}</div>
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{entry.source}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-border bg-muted/20 p-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">Chained Requests</h3>
              {chainedResults.length === 0 ? (
                <div className="text-sm text-muted-foreground">No chained requests were executed.</div>
              ) : (
                <div className="space-y-2">
                  {chainedResults.map((entry, idx) => (
                    <div key={`${entry.request_id}-${idx}`} className="rounded-lg border border-border bg-background/60 p-3 text-xs flex items-center justify-between gap-3">
                      <div className="space-y-1">
                        <div className="font-mono font-semibold break-all">{entry.request_id}</div>
                        <div className="text-muted-foreground">{entry.execution_time_ms} ms</div>
                      </div>
                      <div className={twMerge(
                        "px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider",
                        entry.success ? "bg-emerald-500/10 text-emerald-600" : "bg-red-500/10 text-red-600"
                      )}>
                        {entry.success ? `status ${entry.status ?? 'ok'}` : `status ${entry.status ?? 'fail'}`}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {requestInfo && (
              <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Final Request</h3>
                <div className="font-mono text-xs space-y-1 text-foreground/80 break-all">
                  <div><span className="text-muted-foreground">URL:</span> {requestInfo.url}</div>
                  <div><span className="text-muted-foreground">Method:</span> {requestInfo.method}</div>
                  <div><span className="text-muted-foreground">Body:</span> {requestInfo.body || '(empty)'}</div>
                </div>
                <div className="space-y-2">
                  <div className="font-mono text-xs text-foreground/80 break-all"><span className="text-muted-foreground">Headers:</span></div>
                  {requestInfo.headers && Object.keys(requestInfo.headers).length > 0 ? (
                    <div className="space-y-1 font-mono text-xs text-foreground/80">
                      {Object.entries(requestInfo.headers).map(([key, value]) => (
                        <div key={key} className="grid grid-cols-[180px_1fr] gap-3">
                          <div className="text-primary font-semibold break-all">{key}</div>
                          <div className="break-all">{String(value)}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground">No headers were added.</div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

