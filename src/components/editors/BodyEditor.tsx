import React, { useCallback, useMemo, useEffect, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { json } from '@codemirror/lang-json';
import { yaml } from '@codemirror/lang-yaml';
import { EditorView, Decoration, DecorationSet } from '@codemirror/view';
import { StateField, Extension } from '@codemirror/state';

interface BodyEditorProps {
  value: string;
  mode: 'json' | 'yaml' | 'raw' | 'none';
  onChange: (newValue: string) => void;
  onFormat?: () => void;
}

const firvVariableDecoration = Decoration.mark({ class: 'cm-firv-variable bg-blue-100 text-blue-600 rounded px-1 font-semibold' });

const firvVariableExtension = StateField.define<DecorationSet>({
  create(state) {
    const widgets: any[] = [];
    const text = state.doc.toString();
    const regex = /\{\{[\w_-]+\}\}/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      widgets.push(firvVariableDecoration.range(match.index, match.index + match[0].length));
    }
    return Decoration.set(widgets);
  },
  update(decorations, tr) {
    if (!tr.docChanged) return decorations.map(tr.changes);
    const widgets: any[] = [];
    const text = tr.state.doc.toString();
    const regex = /\{\{[\w_-]+\}\}/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      widgets.push(firvVariableDecoration.range(match.index, match.index + match[0].length));
    }
    return Decoration.set(widgets);
  },
  provide: f => EditorView.decorations.from(f)
});

export const BodyEditor: React.FC<BodyEditorProps> = ({ value, mode, onChange, onFormat }) => {
  const [localValue, setLocalValue] = useState(value);
  const [theme, setTheme] = useState<'light' | 'dark'>(
    window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => setTheme(mediaQuery.matches ? 'dark' : 'light');
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  const handleChange = useCallback((val: string) => {
    setLocalValue(val);
    const handler = setTimeout(() => {
      onChange(val);
    }, 150);
    return () => clearTimeout(handler);
  }, [onChange]);

  if (mode === 'none') {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400 bg-gray-50 h-full min-h-[200px] border rounded">
        This request does not have a body
      </div>
    );
  }

  const extensions = useMemo(() => {
    const exts: Extension[] = [firvVariableExtension];
    if (mode === 'json') {
      exts.push(json());
    } else if (mode === 'yaml' || mode === 'raw') {
      exts.push(yaml());
    }
    return exts;
  }, [mode]);

  const handleFormat = () => {
    if (mode === 'json') {
      try {
        const parsed = JSON.parse(localValue);
        const formatted = JSON.stringify(parsed, null, 2);
        setLocalValue(formatted);
        onChange(formatted);
      } catch (e) {
        console.warn('Invalid JSON format');
      }
    }
    onFormat?.();
  };

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      // Save is typically handled at a higher level
    }
    if (e.key === 'f' && e.shiftKey && e.altKey) {
      e.preventDefault();
      handleFormat();
    }
  }, [localValue, mode, handleFormat]);

  return (
    <div className="flex flex-col h-full w-full bg-white relative border rounded" onKeyDown={handleKeyDown}>
      <div className="flex justify-end p-2 absolute top-0 right-4 z-10">
        <button
          onClick={handleFormat}
          disabled={mode !== 'json'}
          className="text-xs px-2 py-1 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-gray-700 rounded shadow-sm border"
        >
          Format JSON
        </button>
      </div>
      <div className="flex-1 overflow-auto mt-8">
        <CodeMirror
          value={localValue}
          height="100%"
          extensions={extensions}
          onChange={handleChange}
          className="h-full text-sm"
          theme={theme}
          basicSetup={{
            lineNumbers: true,
            highlightActiveLineGutter: true,
            foldGutter: true,
            bracketMatching: true,
            autocompletion: true,
          }}
        />
      </div>
    </div>
  );
};
