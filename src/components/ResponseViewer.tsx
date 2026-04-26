import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { Download, Search, Terminal, Database, Clock, FileJson, Globe } from 'lucide-react';
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
  const [mode, setMode] = useState<'Pretty' | 'Raw' | 'Preview'>('Pretty');
  const [searchQuery, setSearchQuery] = useState('');
  const [jmesQuery, setJmesQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'Body' | 'Headers'>('Body');
  
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

  const { status, status_text, time_ms, size_bytes, body, headers } = response || { status: 0, status_text: '', time_ms: 0, size_bytes: 0, body: '', headers: {} };
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
        part.toLowerCase() === searchQuery.toLowerCase() ? <mark key={i} className="bg-yellow-200 text-black rounded px-0.5">{part}</mark> : part
      );
    };

    if (isEnd) {
      return (
        <div style={{ paddingLeft: `${depth * 24}px` }} className="font-mono text-xs text-zinc-400 py-0.5" onContextMenu={(e) => handleCopyPath(e, path)}>
          {isArray ? ']' : '}'}
        </div>
      );
    }

    return (
      <div 
        style={{ paddingLeft: `${depth * 24}px` }} 
        className="font-mono text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800/50 flex items-center py-0.5 group relative"
        onContextMenu={(e) => handleCopyPath(e, path)}
      >
        {depth > 0 && <div className="absolute left-[-12px] top-0 bottom-0 w-[1px] bg-zinc-200 dark:bg-zinc-800" />}
        
        {hasChildren ? (
          <button onClick={() => toggleExpand(path)} className="w-4 h-4 flex items-center justify-center text-zinc-400 mr-1 hover:text-indigo-500 transition-colors">
            {expandedPaths.has(path) ? '▾' : '▸'}
          </button>
        ) : (
          <span className="w-4 mr-1 inline-block"></span>
        )}
        
        {keyName && (
          <span className="text-purple-600 dark:text-purple-400 mr-2" title="Right click to copy path">
            "{renderText(keyName)}":
          </span>
        )}
        
        {hasChildren ? (
          <span className="text-zinc-500">
            {isArray ? '[' : '{'} {!expandedPaths.has(path) && <span className="text-[10px] text-zinc-400 ml-1 font-sans italic">{size} items {isArray ? ']' : '}'}</span>}
          </span>
        ) : (
          <span className={twMerge(
            typeof value === 'number' ? 'text-blue-500' : 
            typeof value === 'string' ? 'text-emerald-500' : 
            typeof value === 'boolean' ? 'text-orange-500' : 
            'text-zinc-500'
          )}>
            {typeof value === 'string' ? `"${renderText(value)}"` : renderText(String(value))}
          </span>
        )}
      </div>
    );
  };

  const handleSave = async () => {
    try {
      const filePath = await save({ defaultPath: 'response.json' });
      if (filePath) {
        await writeTextFile(filePath, body);
      }
    } catch (err) {
      console.error('Failed to save file:', err);
    }
  };

  if (!response) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center space-y-4 bg-zinc-50 dark:bg-zinc-950/50 text-zinc-400">
        <div className="p-6 rounded-full bg-zinc-100 dark:bg-zinc-900 shadow-inner">
          <Terminal size={48} className="opacity-20" />
        </div>
        <div className="text-center">
          <p className="font-semibold text-zinc-600 dark:text-zinc-300">Ready for Request</p>
          <p className="text-xs">Send a request to see the response here.</p>
        </div>
      </div>
    );
  }

  const isJson = headers['content-type']?.includes('application/json');
  const isImage = headers['content-type']?.includes('image/');
  const isPdf = headers['content-type']?.includes('application/pdf');
  const isHtml = headers['content-type']?.includes('text/html');

  return (
    <div className="flex flex-col h-full bg-white dark:bg-zinc-950 overflow-hidden">
      {/* Metric Bar */}
      <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between bg-zinc-50/50 dark:bg-zinc-900/50">
        <div className="flex gap-2">
          <div className={twMerge(
            "flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold ring-1 shadow-sm",
            status >= 400 
              ? "bg-red-500/10 text-red-500 ring-red-500/20 shadow-red-500/10" 
              : "bg-emerald-500/10 text-emerald-500 ring-emerald-500/20 shadow-emerald-500/10"
          )}>
            <div className={twMerge("w-1.5 h-1.5 rounded-full animate-pulse", status >= 400 ? "bg-red-500" : "bg-emerald-500")} />
            {status} {status_text}
          </div>
          
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800 ring-1 ring-zinc-200 dark:ring-zinc-700">
            <Clock size={12} className="opacity-60" />
            {time_ms} ms
          </div>
          
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800 ring-1 ring-zinc-200 dark:ring-zinc-700">
            <Database size={12} className="opacity-60" />
            {(size_bytes / 1024).toFixed(2)} KB
          </div>
        </div>

        <div className="flex gap-2 items-center">
          <select 
            value={mode} 
            onChange={e => setMode(e.target.value as any)}
            className="text-[11px] font-bold uppercase tracking-wider bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-1 outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all cursor-pointer"
          >
            <option value="Pretty">Pretty</option>
            <option value="Raw">Raw</option>
            <option value="Preview">Preview</option>
          </select>
          <button 
            onClick={handleSave}
            className="p-1.5 text-zinc-500 hover:text-indigo-500 hover:bg-indigo-500/10 rounded-lg transition-all"
            title="Download Response"
          >
            <Download size={18} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex px-4 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950">
        <button 
          className={twMerge(
            "px-4 py-2 text-xs font-bold uppercase tracking-wider transition-all relative",
            activeTab === 'Body' 
              ? "text-indigo-500" 
              : "text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
          )}
          onClick={() => setActiveTab('Body')}
        >
          <span className="flex items-center gap-2">
            <FileJson size={14} />
            Body
          </span>
          {activeTab === 'Body' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-500 rounded-t-full" />}
        </button>
        <button 
          className={twMerge(
            "px-4 py-2 text-xs font-bold uppercase tracking-wider transition-all relative",
            activeTab === 'Headers' 
              ? "text-indigo-500" 
              : "text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
          )}
          onClick={() => setActiveTab('Headers')}
        >
          <span className="flex items-center gap-2">
            <Globe size={14} />
            Headers
            <span className="text-[10px] bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded-full text-zinc-500">{Object.keys(headers).length}</span>
          </span>
          {activeTab === 'Headers' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-500 rounded-t-full" />}
        </button>
      </div>

      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {activeTab === 'Body' ? (
          <>
            {mode === 'Pretty' && isJson && (
              <div className="p-3 border-b border-zinc-200 dark:border-zinc-800 flex gap-3 bg-zinc-50/30 dark:bg-zinc-950/30">
                <div className="relative flex-1">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                  <input 
                    type="text" 
                    placeholder="Search response..." 
                    className="w-full pl-9 pr-3 py-1.5 text-xs bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                  />
                </div>
                <input 
                  type="text" 
                  placeholder="JMESPath Filter" 
                  className="flex-1 px-3 py-1.5 text-xs font-mono bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all"
                  value={jmesQuery}
                  onChange={e => setJmesQuery(e.target.value)}
                />
              </div>
            )}

            <div className="flex-1 overflow-auto bg-white dark:bg-zinc-950 custom-scrollbar">
              {isLarge && mode === 'Pretty' && (
                <div className="m-2 p-2 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[10px] font-bold rounded-lg ring-1 ring-amber-500/20 flex justify-center">
                  Large response: performance optimizations active
                </div>
              )}

              {mode === 'Preview' && isImage ? (
                <div className="p-8 flex items-center justify-center h-full">
                   <div className="text-zinc-400 text-center">
                    <Database size={48} className="mx-auto mb-4 opacity-10" />
                    <p className="text-sm">Image preview coming soon</p>
                   </div>
                </div>
              ) : mode === 'Preview' && isPdf ? (
                <div className="p-8 flex items-center justify-center h-full">
                  <p className="text-zinc-500">PDF Viewer not available in this version.</p>
                </div>
              ) : mode === 'Preview' && isHtml ? (
                <iframe srcDoc={body} className="w-full h-full border-none bg-white" title="preview" />
              ) : mode === 'Raw' || !isJson ? (
                <pre className="p-6 text-xs font-mono whitespace-pre-wrap text-zinc-700 dark:text-zinc-300 bg-zinc-50/50 dark:bg-zinc-950">
                  {body}
                </pre>
              ) : mode === 'Pretty' && isParsing ? (
                <div className="p-12 text-center text-zinc-400">
                  <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                  <p className="text-xs font-medium">Analyzing Data...</p>
                </div>
              ) : mode === 'Pretty' && parseError ? (
                <div className="m-4 p-4 text-red-500 font-mono text-xs bg-red-500/10 rounded-xl ring-1 ring-red-500/20">{parseError}</div>
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
        ) : (
          <div className="flex-1 overflow-auto bg-white dark:bg-zinc-950 p-6 custom-scrollbar">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800">
                  <th className="pb-3 text-[10px] font-bold uppercase tracking-widest text-zinc-400">Key</th>
                  <th className="pb-3 text-[10px] font-bold uppercase tracking-widest text-zinc-400">Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
                {Object.entries(headers).map(([key, value]) => (
                  <tr key={key} className="group">
                    <td className="py-3 pr-6 font-mono text-xs font-semibold text-zinc-500 dark:text-zinc-400 w-1/3 align-top group-hover:text-indigo-500 transition-colors">{key}</td>
                    <td className="py-3 font-mono text-xs text-zinc-600 dark:text-zinc-300 break-all">{value}</td>
                  </tr>
                ))}
                {Object.keys(headers).length === 0 && (
                  <tr>
                    <td colSpan={2} className="py-12 text-center text-zinc-400 italic text-sm">No headers received</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

