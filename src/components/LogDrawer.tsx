import { useState } from 'react';
import { useAppStore } from '../store/appStore';
import { useSidebarStore } from '../store/sidebarStore';
import { ChevronUp, ChevronDown, Trash2 } from 'lucide-react';

export function LogDrawer() {
  const [isOpen, setIsOpen] = useState(false);
  const logs = useAppStore(state => state.logs);
  const clearLogs = useAppStore(state => state.clearLogs);
  const setActiveMenu = useSidebarStore(state => state.setActiveMenu);

  const toggleOpen = () => {
    if (isOpen) {
      // Closing
      setActiveMenu('workspace');
    }
    setIsOpen(!isOpen);
  };

  return (
    <div className="relative flex items-center h-full">
      <div 
        className="flex items-center gap-1 px-2 py-1 cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-800 rounded transition-colors"
        onClick={toggleOpen}
      >
        <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Console ({logs.length})</span>
        {isOpen ? <ChevronDown size={14} className="text-gray-500" /> : <ChevronUp size={14} className="text-gray-500" />}
      </div>
      
      {isOpen && (
        <>
          <div 
            className="fixed inset-0 bg-gray-900/40 backdrop-blur-[2px] z-[99990]"
            onClick={toggleOpen}
          />
          <div 
            className="fixed inset-x-0 bottom-8 px-4 sm:px-6 lg:px-10 z-[99999]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto w-full max-w-4xl h-64 max-h-[70vh] bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-800 shadow-2xl rounded-xl flex flex-col overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
                <span className="text-xs font-semibold tracking-wide text-gray-600 dark:text-gray-300 uppercase">Console ({logs.length})</span>
                <div className="flex items-center gap-1">
                  <button 
                    onClick={(e) => { e.stopPropagation(); clearLogs(); }}
                    className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded text-gray-500 hover:text-red-500"
                    title="Clear Logs"
                  >
                    <Trash2 size={14} />
                  </button>
                  <button 
                    onClick={toggleOpen}
                    className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded text-gray-500"
                    title="Close Console"
                  >
                    <ChevronDown size={14} />
                  </button>
                </div>
              </div>
              
              <div className="flex-1 p-3 overflow-y-auto font-mono text-xs bg-gray-900 text-gray-100">
                {logs.map((log, i) => (
                  <div key={i} className="mb-1 border-gray-800 pb-1 break-all">
                    <span className="text-gray-500 mr-2">{new Date().toLocaleTimeString()}&nbsp;</span>
                    {log}
                  </div>
                ))}
                {logs.length === 0 && (
                  <div className="h-full flex items-center justify-center text-gray-500 text-[11px] tracking-wide uppercase">
                    No console output yet
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
