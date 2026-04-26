import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';

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

  const renderNode = (index: number, node: JsonNode) => {
    const { keyName, value, path, depth, isArray, isEnd, hasChildren, size } = node;
    
    // Highlight matching text for search
    const renderText = (text: string) => {
      if (!searchQuery) return text;
      const parts = String(text).split(new RegExp(`(${searchQuery})`, 'gi'));
      return parts.map((part, i) => 
        part.toLowerCase() === searchQuery.toLowerCase() ? <mark key={i} className="bg-yellow-200 text-black">{part}</mark> : part
      );
    };

    if (isEnd) {
      return (
        <div style={{ paddingLeft: `${depth * 20}px` }} className="font-mono text-sm text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 py-0.5" onContextMenu={(e) => handleCopyPath(e, path)}>
          {isArray ? ']' : '}'}
        </div>
      );
    }

    return (
      <div 
        style={{ paddingLeft: `${depth * 20}px` }} 
        className="font-mono text-sm hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center py-0.5 group"
        onContextMenu={(e) => handleCopyPath(e, path)}
      >
        <span className="w-10 text-right text-gray-400 select-none mr-2 text-xs border-r pr-2 border-gray-300 dark:border-gray-700">{index + 1}</span>
        
        {hasChildren ? (
          <button onClick={() => toggleExpand(path)} className="w-4 h-4 flex items-center justify-center text-gray-500 mr-1 hover:text-blue-500">
            {expandedPaths.has(path) ? '▼' : '▶'}
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
          <span className="text-gray-500">
            {isArray ? '[' : '{'} {!expandedPaths.has(path) && <span className="text-xs text-gray-400 ml-1">{size} items {isArray ? ']' : '}'}</span>}
          </span>
        ) : (
          <span className={typeof value === 'number' ? 'text-blue-600 dark:text-blue-400' : typeof value === 'string' ? 'text-green-600 dark:text-green-400' : typeof value === 'boolean' ? 'text-orange-600 dark:text-orange-400' : 'text-gray-500'}>
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
    return <div className="p-4 text-gray-500 flex-1 h-full flex items-center justify-center">No response to display.</div>;
  }

  const isJson = headers['content-type']?.includes('application/json');
  const isImage = headers['content-type']?.includes('image/');
  const isPdf = headers['content-type']?.includes('application/pdf');
  const isHtml = headers['content-type']?.includes('text/html');

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-800">
      {/* Header / Metadata */}
      <div className="p-2 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between text-sm bg-gray-50 dark:bg-gray-800">
        <div className="flex gap-4">
          <span className={`font-mono font-bold ${status >= 400 ? 'text-red-500' : 'text-green-500'}`}>
            {status} {status_text}
          </span>
          <span className="text-gray-500">{time_ms} ms</span>
          <span className="text-gray-500">{(size_bytes / 1024).toFixed(2)} KB</span>
        </div>
        <div className="flex gap-2 items-center">
          <select 
            value={mode} 
            onChange={e => setMode(e.target.value as any)}
            className="text-xs bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded px-2 py-1"
          >
            <option value="Pretty">Pretty</option>
            <option value="Raw">Raw</option>
            <option value="Preview">Preview</option>
          </select>
          <button 
            onClick={handleSave}
            className="px-2 py-1 bg-blue-500 text-white text-xs rounded hover:bg-blue-600"
          >
            Save to File
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800 text-sm">
        <button 
          className={`px-4 py-2 font-medium ${activeTab === 'Body' ? 'border-b-2 border-blue-500 text-blue-600 dark:text-blue-400' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
          onClick={() => setActiveTab('Body')}
        >
          Body
        </button>
        <button 
          className={`px-4 py-2 font-medium ${activeTab === 'Headers' ? 'border-b-2 border-blue-500 text-blue-600 dark:text-blue-400' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
          onClick={() => setActiveTab('Headers')}
        >
          Headers <span className="ml-1 text-xs text-gray-400 bg-gray-200 dark:bg-gray-700 px-1.5 py-0.5 rounded-full">{Object.keys(headers).length}</span>
        </button>
      </div>

      {activeTab === 'Body' ? (
        <>
          {/* Filter / Search Bar */}
          {mode === 'Pretty' && isJson && (
            <div className="p-2 border-b border-gray-200 dark:border-gray-800 flex gap-2 text-sm bg-gray-50 dark:bg-gray-800">
              <input 
                type="text" 
                placeholder="Search keys/values..." 
                className="flex-1 px-2 py-1 border rounded dark:bg-gray-700 dark:border-gray-600"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
              <input 
                type="text" 
                placeholder="JMESPath filter (e.g. $.items)" 
                className="flex-1 px-2 py-1 border rounded dark:bg-gray-700 dark:border-gray-600 font-mono"
                value={jmesQuery}
                onChange={e => setJmesQuery(e.target.value)}
              />
            </div>
          )}

          {/* Body Content */}
          <div className="flex-1 overflow-auto relative bg-white dark:bg-gray-900">
            {isLarge && mode === 'Pretty' && (
              <div className="p-2 bg-yellow-100 text-yellow-800 text-sm flex justify-between items-center z-10 sticky top-0">
                <span>Large response detected (&gt;5MB). Performance optimizations applied.</span>
              </div>
            )}

            {mode === 'Preview' && isImage ? (
              <div className="p-4 flex items-center justify-center h-full">
                 <span className="text-gray-500">Image preview not fully supported for lossy strings yet.</span>
              </div>
            ) : mode === 'Preview' && isPdf ? (
              <div className="p-4 flex items-center justify-center h-full">
                <span className="text-gray-500">PDF preview (requires binary body parsing).</span>
              </div>
            ) : mode === 'Preview' && isHtml ? (
              <iframe srcDoc={body} className="w-full h-full border-none bg-white" title="preview" />
            ) : mode === 'Raw' || !isJson ? (
              <pre className="p-4 text-sm font-mono whitespace-pre-wrap text-gray-800 dark:text-gray-200">
                {body}
              </pre>
            ) : mode === 'Pretty' && isParsing ? (
              <div className="p-8 text-center text-gray-500">Parsing response...</div>
            ) : mode === 'Pretty' && parseError ? (
              <div className="p-4 text-red-500 font-mono text-sm bg-red-50 dark:bg-red-900">{parseError}</div>
            ) : mode === 'Pretty' && parsedData !== null ? (
              <Virtuoso
                totalCount={flattenedData.length}
                itemContent={(index) => renderNode(index, flattenedData[index])}
                style={{ height: '100%', width: '100%' }}
                className="json-viewer-virtuoso custom-scrollbar"
              />
            ) : null}
          </div>
        </>
      ) : (
        <div className="flex-1 overflow-auto bg-white dark:bg-gray-900 p-4">
          <table className="w-full text-left text-sm">
            <tbody>
              {Object.entries(headers).map(([key, value]) => (
                <tr key={key} className="border-b border-gray-100 dark:border-gray-800">
                  <td className="py-2 pr-4 font-mono font-medium text-gray-700 dark:text-gray-300 w-1/3 align-top">{key}</td>
                  <td className="py-2 font-mono text-gray-600 dark:text-gray-400 break-all">{value}</td>
                </tr>
              ))}
              {Object.keys(headers).length === 0 && (
                <tr>
                  <td colSpan={2} className="py-4 text-center text-gray-500">No headers found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

