import React, { useCallback, useMemo, useEffect, useRef, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { json } from '@codemirror/lang-json';
import { EditorView, Decoration, DecorationSet } from '@codemirror/view';
import { StateField, Extension } from '@codemirror/state';
import { buildSingleVariableHoverTitle, type VariableLookup } from '../../lib/variableHover';

interface BodyEditorProps {
  value: string;
  mode: 'json' | 'form' | 'raw' | 'none';
  onChange: (newValue: string) => void;
  onFormat?: () => void;
  highlightLine?: number | null;
  workspaceGlobals?: VariableLookup;
}

const buildVariableDeco = (variableName: string, lookup: VariableLookup) => {
  const title = buildSingleVariableHoverTitle(variableName, lookup);
  return Decoration.mark({
    class: 'cm-firv-variable bg-blue-100 text-blue-600 rounded px-1 font-semibold',
    attributes: title ? { title } : {},
  });
};

const firvVariableExtension = (lookup: VariableLookup) => StateField.define<DecorationSet>({
  create(state) {
    const widgets: any[] = [];
    const text = state.doc.toString();
    const regex = /\{\{\s*([a-zA-Z0-9_-]+)\s*}}/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      widgets.push(buildVariableDeco(match[1], lookup).range(match.index, match.index + match[0].length));
    }
    return Decoration.set(widgets);
  },
  update(decorations, tr) {
    if (!tr.docChanged) return decorations.map(tr.changes);
    const widgets: any[] = [];
    const text = tr.state.doc.toString();
    const regex = /\{\{\s*([a-zA-Z0-9_-]+)\s*}}/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      widgets.push(buildVariableDeco(match[1], lookup).range(match.index, match.index + match[0].length));
    }
    return Decoration.set(widgets);
  },
  provide: f => EditorView.decorations.from(f)
});

const lineHighlightExtension = (highlightLine?: number | null): Extension => {
  if (!highlightLine || highlightLine < 1) return [];
  const lineDeco = Decoration.line({ class: 'cm-firv-line-error bg-red-500/10' });
  return EditorView.decorations.of((view) => {
    const ranges: any[] = [];
    const line = view.state.doc.line(Math.min(highlightLine, view.state.doc.lines));
    ranges.push(lineDeco.range(line.from));
    return Decoration.set(ranges);
  });
};

export const BodyEditor: React.FC<BodyEditorProps> = ({ value, mode, onChange, onFormat, highlightLine, workspaceGlobals = {} }) => {
  const [localValue, setLocalValue] = useState(value);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    setLocalValue(current => (current === value ? current : value));
  }, [value]);

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      onChange(localValue);
    }, 150);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [localValue, onChange]);

  const handleChange = useCallback((val: string) => {
    setLocalValue(val);
  }, []);

  if (mode === 'none') {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400 bg-gray-50 h-full min-h-[200px] border rounded">
        This request does not have a body
      </div>
    );
  }

  const extensions = useMemo(() => {
    const exts: Extension[] = [firvVariableExtension(workspaceGlobals), lineHighlightExtension(highlightLine)];
    if (mode === 'json') {
      exts.push(json());
    }
    return exts;
  }, [mode, highlightLine, workspaceGlobals]);

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
      <div className="flex-1 overflow-auto">
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
