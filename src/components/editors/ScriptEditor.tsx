import React, { useMemo } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { Extension } from '@codemirror/state';

interface ScriptEditorProps {
  value: string;
  onChange: (newValue: string) => void;
  title: string;
  placeholder?: string;
}

export const ScriptEditor: React.FC<ScriptEditorProps> = ({ value, onChange, title, placeholder }) => {
  const extensions = useMemo(() => [javascript()] as Extension[], []);

  return (
    <div className="flex flex-col h-full w-full bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden shadow-sm">
      <div className="px-4 py-2 bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          {title}
        </span>
      </div>
      <div className="flex-1 overflow-auto">
        <CodeMirror
          value={value || ''}
          height="100%"
          extensions={extensions}
          onChange={onChange}
          placeholder={placeholder || "// Enter your JavaScript here..."}
          className="h-full text-sm"
          theme="light"
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
