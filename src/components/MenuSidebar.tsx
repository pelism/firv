import React from 'react';
import { Layers, Settings, Terminal, FolderOpen, Plus } from 'lucide-react';
import { useSidebarStore } from '../store/sidebarStore';
import { twMerge } from 'tailwind-merge';

export const MenuSidebar: React.FC = () => {
  const { openWorkspace, createWorkspace, activeMenu, setActiveMenu } = useSidebarStore();

  const menuItems = [
    { 
      id: 'workspace', 
      icon: Layers, 
      label: 'Workspace', 
      onClick: () => setActiveMenu('workspace'),
      subItems: [
        { label: 'New Workspace', icon: Plus, onClick: createWorkspace },
        { label: 'Open Workspace', icon: FolderOpen, onClick: openWorkspace },
      ]
    },
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
          
          {item.subItems ? (
            <div className="absolute left-full top-1/2 -translate-y-1/2 pl-3 opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto transition-all z-50">
              <div className="p-1 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-2xl flex flex-col gap-1 min-w-[160px] ring-1 ring-black/5 dark:ring-white/5">
                {item.subItems.map((sub, i) => (
                  <div
                    key={i}
                    onClick={(e) => {
                      e.stopPropagation();
                      sub.onClick();
                    }}
                    className="flex items-center gap-2.5 px-3 py-2 text-[10px] font-bold text-zinc-600 dark:text-zinc-400 hover:text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 rounded-lg transition-all whitespace-nowrap cursor-pointer uppercase tracking-wider"
                  >
                    <sub.icon size={14} className="opacity-70" />
                    {sub.label}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="absolute left-full ml-3 px-2 py-1 bg-zinc-800 text-white text-[10px] font-bold rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50 shadow-xl">
              {item.label}
            </div>
          )}
          
          {activeMenu === item.id && (
            <div className="absolute left-[-4px] top-1/2 -translate-y-1/2 w-1 h-6 bg-indigo-500 rounded-full" />
          )}
        </button>
      ))}

      <div className="mt-auto flex flex-col items-center gap-4">
      </div>
    </div>
  );
};
