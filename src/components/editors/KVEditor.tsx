import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Trash2, FileText, Table } from 'lucide-react';
import { getVariableHoverTitleAtPoint, type VariableLookup } from '../../lib/variableHover';

export interface KeyValue {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
}

interface KVEditorProps {
  data: KeyValue[];
  onChange: (updatedData: KeyValue[]) => void;
  placeholderKey?: string;
  placeholderValue?: string;
  uniqueEnabledKeys?: boolean;
  variableLookup?: VariableLookup;
}

const generateId = () => Math.random().toString(36).substring(2, 9);

const HighlightedInput = ({ value, onChange, onKeyDown, placeholder, inputRef, onMouseMove, onMouseLeave, tooltip }: any) => {
  const localRef = useRef<HTMLInputElement>(null);
  const bgRef = useRef<HTMLDivElement>(null);
  const ref = inputRef || localRef;

  const handleScroll = () => {
    if (ref.current && bgRef.current) {
      bgRef.current.scrollLeft = ref.current.scrollLeft;
    }
  };

  return (
    <div className="relative flex-1 flex items-center overflow-hidden border border-border rounded focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary/50 bg-transparent">
      {/* Background layer for highlighting */}
      <div
        ref={bgRef}
        className="absolute inset-0 pointer-events-none whitespace-pre overflow-hidden flex items-center px-3"
        aria-hidden="true"
      >
        <span className="font-mono text-sm">
          {value ? value.split(/(\{\{.*?\}\})/).map((part: string, i: number) =>
            part.startsWith('{{') && part.endsWith('}}') ? (
              <span key={i} className="bg-primary/30 rounded text-transparent">{part}</span>
            ) : (
              <span key={i} className="text-transparent">{part}</span>
            )
          ) : (
            <span className="text-transparent">{placeholder || ''}</span>
          )}
        </span>
      </div>
      {/* Foreground input */}
      <input
        ref={ref}
        type="text"
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
        onScroll={handleScroll}
        placeholder={placeholder}
        className="w-full bg-transparent font-mono text-sm px-3 py-1.5 focus:outline-none relative z-10 text-foreground placeholder:text-muted-foreground/60"
      />
      {tooltip && (
        <div
          role="tooltip"
          className="pointer-events-none absolute left-0 top-full z-50 mt-2 rounded-md bg-neutral-900 px-2 py-1 text-xs text-white shadow-lg whitespace-pre-wrap"
          style={{ left: Math.max(8, tooltip.left) }}
        >
          {tooltip.title}
        </div>
      )}
    </div>
  );
};

export function KVEditor({ data, onChange, placeholderKey = "Key", placeholderValue = "Value", uniqueEnabledKeys = false, variableLookup = {} }: KVEditorProps) {
  const [rows, setRows] = useState<KeyValue[]>([]);
  const [nextEmptyId, setNextEmptyId] = useState(generateId());
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [hoverState, setHoverState] = useState<{ [rowId: string]: { title: string; left: number } | null }>({});
  const valueInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const keyInputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Initialize and sync rows, ensuring there's always an empty row at the end
  useEffect(() => {
    const updatedRows = [...data];
    if (updatedRows.length === 0 || 
        (updatedRows[updatedRows.length - 1].key !== "" || updatedRows[updatedRows.length - 1].value !== "")) {
      updatedRows.push({ id: nextEmptyId, key: "", value: "", enabled: true });
    }
    
    // Check if deep equal to avoid infinite loops if parents just pass a new array ref
    const isSame = rows.length === updatedRows.length && rows.every((r, i) => 
      r.key === updatedRows[i].key && r.value === updatedRows[i].value && r.enabled === updatedRows[i].enabled && r.id === updatedRows[i].id
    );
    
    if (!isSame) {
      setRows(updatedRows);
    }
  }, [data, rows, nextEmptyId]);

  const notifyChange = useCallback((newRows: KeyValue[]) => {
    // Filter out rows that have both empty key and value
    const filtered = newRows.filter(r => r.key.trim() !== "" || r.value.trim() !== "");
    onChange(filtered);
  }, [onChange]);

  const updateRow = (index: number, updates: Partial<KeyValue>) => {
    let newRows = [...rows];
    const row = newRows[index];
    
    // If we're updating the empty row, keep its ID stable but prepare a new one for the NEXT empty row
    if (row.id === nextEmptyId) {
      setNextEmptyId(generateId());
    }
    
    const updatedRow = { ...row, ...updates };

    // Guard: Prevent multiple enabled rows with the same key if uniqueEnabledKeys is set
    if (uniqueEnabledKeys && updatedRow.enabled && updatedRow.key.trim() !== "") {
      newRows = newRows.map((r, i) => {
        if (i !== index && r.enabled && r.key.trim().toLowerCase() === updatedRow.key.trim().toLowerCase()) {
          return { ...r, enabled: false };
        }
        return r;
      });
    }

    newRows[index] = updatedRow;
    
    setRows(newRows);
    notifyChange(newRows);
  };

  const deleteRow = (index: number) => {
    const newRows = rows.filter((_, i) => i !== index);
    setRows(newRows);
    notifyChange(newRows);
  };

  const handleKeyDown = (e: React.KeyboardEvent, index: number, field: 'key' | 'value') => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (field === 'key') {
        valueInputRefs.current[index]?.focus();
      } else if (field === 'value') {
        // Move to the next row's key input, if it exists
        if (index + 1 < rows.length) {
          keyInputRefs.current[index + 1]?.focus();
        }
      }
    }
  };

  const toggleBulkMode = () => {
    if (!bulkMode) {
      // Switch to bulk mode: generate text from data
      const text = data.map(r => `${r.key}: ${r.value}`).join('\n');
      setBulkText(text);
    } else {
      // Switch to table mode: parse text
      const lines = bulkText.split('\n');
      const newPairs: KeyValue[] = lines.map(line => {
        const separatorIndex = line.indexOf(':');
        if (separatorIndex === -1) {
          return { id: generateId(), key: line.trim(), value: "", enabled: true };
        }
        const key = line.substring(0, separatorIndex).trim();
        const value = line.substring(separatorIndex + 1).trim();
        return { id: generateId(), key, value, enabled: true };
      }).filter(r => r.key !== "" || r.value !== "");
      onChange(newPairs);
    }
    setBulkMode(!bulkMode);
  };

  const handleBulkChange = (text: string) => {
    setBulkText(text);
    const lines = text.split('\n');
    const newPairs: KeyValue[] = lines.map(line => {
      const separatorIndex = line.indexOf(':');
      if (separatorIndex === -1) {
        return { id: generateId(), key: line.trim(), value: "", enabled: true };
      }
      const key = line.substring(0, separatorIndex).trim();
      const value = line.substring(separatorIndex + 1).trim();
      return { id: generateId(), key, value, enabled: true };
    }).filter(r => r.key !== "" || r.value !== "");
    onChange(newPairs);
  };

  const handleValueMouseMove = (rowId: string, value: string, event: React.MouseEvent<HTMLInputElement>) => {
    const title = getVariableHoverTitleAtPoint(value, variableLookup, event.currentTarget, event.clientX, event.clientY);
    if (!title) {
      setHoverState(prev => ({ ...prev, [rowId]: null }));
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    setHoverState(prev => ({ ...prev, [rowId]: { title, left: event.clientX - rect.left } }));
  };

  return (
    <div className="flex flex-col space-y-2">
      <div className="flex justify-start mb-2">
        <button
          onClick={toggleBulkMode}
          className="flex items-center text-xs font-medium text-gray-600 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded"
        >
          {bulkMode ? <Table className="w-4 h-4 mr-1.5" /> : <FileText className="w-4 h-4 mr-1.5" />}
          {bulkMode ? 'Table View' : 'Bulk Edit'}
        </button>
      </div>

      {bulkMode ? (
        <textarea
          value={bulkText}
          onChange={(e) => handleBulkChange(e.target.value)}
          className="w-full h-48 p-3 font-mono text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          placeholder="Key: Value&#10;Authorization: Bearer {{token}}"
        />
      ) : (
        <div className="flex flex-col space-y-1.5">
          {rows.map((row, index) => (
            <div key={row.id} className="flex items-center space-x-2 group">
              <input
                type="checkbox"
                checked={row.enabled}
                onChange={(e) => updateRow(index, { enabled: e.target.checked })}
                className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
              />
              <input
                ref={(el) => { keyInputRefs.current[index] = el; }}
                type="text"
                value={row.key}
                onChange={(e) => updateRow(index, { key: e.target.value })}
                onKeyDown={(e) => handleKeyDown(e, index, 'key')}
                placeholder={placeholderKey}
                className="flex-1 bg-transparent border border-border rounded px-3 py-1.5 font-mono text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50"
              />
              <HighlightedInput
                inputRef={(el: HTMLInputElement | null) => { valueInputRefs.current[index] = el; }}
                value={row.value}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateRow(index, { value: e.target.value })}
                onKeyDown={(e: React.KeyboardEvent) => handleKeyDown(e, index, 'value')}
                placeholder={placeholderValue}
                onMouseMove={(e: React.MouseEvent<HTMLInputElement>) => handleValueMouseMove(row.id, row.value, e)}
                onMouseLeave={() => setHoverState(prev => ({ ...prev, [row.id]: null }))}
                tooltip={hoverState[row.id]}
              />
              <button
                onClick={() => deleteRow(index)}
                className="p-1.5 text-gray-500 hover:text-red-500 hover:bg-red-500/10 rounded opacity-80 group-hover:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-red-500/40 transition-colors"
                title="Remove"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
