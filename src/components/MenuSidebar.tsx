import React, { useState } from 'react';
import { Layers, ScrollText, Settings, Terminal, FolderOpen } from 'lucide-react';
import { useSidebarStore } from '../store/sidebarStore';
import { WorkspaceScriptDrawer } from './WorkspaceScriptDrawer';
import { twMerge } from 'tailwind-merge';

export const MenuSidebar: React.FC = () => {
  const { openWorkspace, activeMenu, setActiveMenu } = useSidebarStore();
  const [isWorkspaceScriptsOpen, setIsWorkspaceScriptsOpen] = useState(false);

  const menuItems = [
    { id: 'workspace', icon: Layers, label: 'Workspace', onClick: () => {} },
    { id: 'open', icon: FolderOpen, label: 'Open Workspace', onClick: openWorkspace },
    { id: 'scripts', icon: ScrollText, label: 'Workspace Scripts', onClick: () => setIsWorkspaceScriptsOpen(true) },
    { id: 'terminal', icon: Terminal, label: 'Terminal', onClick: () => {} },
    { id: 'settings', icon: Settings, label: 'Settings', onClick: () => {} },
  ];

  return (
    <div className="w-16 h-full bg-zinc-100 dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-800 flex flex-col items-center py-4 gap-4 z-50">
      {menuItems.map((item) => (
        <button
          key={item.id}
          onClick={() => {
            if (item.onClick) item.onClick();
            if (item.id !== 'scripts') setActiveMenu(item.id as any);
          }}
          className={twMerge(
            "p-3 rounded-xl transition-all group relative",
            activeMenu === item.id 
              ? "bg-white dark:bg-zinc-800 text-indigo-500 shadow-sm ring-1 ring-zinc-200 dark:ring-zinc-700" 
              : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-800"
          )}
          title={item.label}
        >
          <item.icon size={20} />
          
          {/* Tooltip */}
          <div className="absolute left-full ml-3 px-2 py-1 bg-zinc-800 text-white text-[10px] font-bold rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50 shadow-xl">
            {item.label}
          </div>
          
          {activeMenu === item.id && (
            <div className="absolute left-[-4px] top-1/2 -translate-y-1/2 w-1 h-6 bg-indigo-500 rounded-full" />
          )}
        </button>
      ))}

      <div className="mt-auto flex flex-col items-center gap-4">
      </div>

      <WorkspaceScriptDrawer 
        isOpen={isWorkspaceScriptsOpen} 
        onClose={() => {
          setIsWorkspaceScriptsOpen(false);
          setActiveMenu('workspace');
        }} 
      />
    </div>
  );
};
