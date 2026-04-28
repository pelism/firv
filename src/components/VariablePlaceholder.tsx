import React from 'react';
import { Variable } from 'lucide-react';

export const VariablePlaceholder: React.FC = () => {
  return (
    <div className="flex flex-col items-center justify-center p-8 border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-2xl bg-zinc-50/50 dark:bg-zinc-900/50 group hover:border-indigo-500/50 transition-colors cursor-default">
      <div className="p-3 rounded-xl bg-white dark:bg-zinc-800 shadow-sm border border-zinc-200 dark:border-zinc-700 mb-4 group-hover:scale-110 transition-transform">
        <Variable size={24} className="text-indigo-500" />
      </div>
      <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 mb-1">Variable Editor</h3>
      <p className="text-xs text-zinc-500 text-center max-w-[240px]">
        Coming soon. Manage workspace-level environment variables here.
      </p>
    </div>
  );
};
