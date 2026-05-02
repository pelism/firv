import { create } from 'zustand';

export interface AppState {
  activeRequestId: string | null;
  setActiveRequestId: (id: string | null) => void;
  openTabs: string[];
  openTab: (id: string) => void;
  closeTab: (id: string) => void;
  isRunning: boolean;
  setIsRunning: (isRunning: boolean) => void;
  responses: Record<string, any>;
  setResponse: (requestId: string, response: any | null) => void;
  logs: string[];
  addLog: (log: string) => void;
  clearLogs: () => void;
  dirtyRequests: Set<string>;
  setDirty: (id: string, isDirty: boolean) => void;
  reset: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  activeRequestId: null,
  setActiveRequestId: (id) => set({ activeRequestId: id }),
  openTabs: [],
  openTab: (id) => set((state) => {
    if (!state.openTabs.includes(id)) {
      return { openTabs: [...state.openTabs, id], activeRequestId: id };
    }
    return { activeRequestId: id };
  }),
  closeTab: (id) => set((state) => {
    const newTabs = state.openTabs.filter(t => t !== id);
    const newResponses = { ...state.responses };
    delete newResponses[id];
    const newDirty = new Set(state.dirtyRequests);
    newDirty.delete(id);
    let newActiveId = state.activeRequestId;
    if (state.activeRequestId === id) {
      newActiveId = newTabs.length > 0 ? newTabs[newTabs.length - 1] : null;
    }
    return { openTabs: newTabs, activeRequestId: newActiveId, responses: newResponses, dirtyRequests: newDirty };
  }),
  isRunning: false,
  setIsRunning: (isRunning) => set({ isRunning }),
  responses: {},
  setResponse: (requestId, response) => set((state) => ({ 
    responses: { ...state.responses, [requestId]: response } 
  })),
  logs: [],
  addLog: (log) => set((state) => ({ logs: [...state.logs, log] })),
  clearLogs: () => set({ logs: [] }),
  dirtyRequests: new Set(),
  setDirty: (id, isDirty) => set((state) => {
    const newDirty = new Set(state.dirtyRequests);
    if (isDirty) {
      newDirty.add(id);
    } else {
      newDirty.delete(id);
    }
    return { dirtyRequests: newDirty };
  }),
  reset: () => set({
    activeRequestId: null,
    openTabs: [],
    isRunning: false,
    responses: {},
    logs: [],
    dirtyRequests: new Set(),
  }),
}));
