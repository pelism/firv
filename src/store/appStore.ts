import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type RequestOrigin = 'workspace' | 'scratchpad';

export interface AppState {
  activeRequestId: string | null;
  setActiveRequestId: (id: string | null) => void;
  openTabs: string[];
  openTab: (id: string) => void;
  closeTab: (id: string) => void;
  runningRequests: Record<string, boolean>;
  isRequestRunning: (id: string) => boolean;
  setRequestRunning: (id: string, isRunning: boolean) => void;
  responses: Record<string, any>;
  setResponse: (requestId: string, response: any | null) => void;
  dirtyRequests: Set<string>;
  setDirty: (id: string, isDirty: boolean) => void;
  requestOrigins: Record<string, RequestOrigin>;
  setRequestOrigin: (id: string, origin: RequestOrigin) => void;
  clearRequestOrigin: (id: string) => void;
  scratchpadRequestData: Record<string, any>;
  setScratchpadRequestData: (id: string, data: any) => void;
  clearScratchpadRequestData: (id: string) => void;
  reset: () => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
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
        const newRunningRequests = { ...state.runningRequests };
        delete newRunningRequests[id];
        const newDirty = new Set(state.dirtyRequests);
        newDirty.delete(id);
        let newActiveId = state.activeRequestId;
        if (state.activeRequestId === id) {
          newActiveId = newTabs.length > 0 ? newTabs[newTabs.length - 1] : null;
        }
        return { openTabs: newTabs, activeRequestId: newActiveId, responses: newResponses, runningRequests: newRunningRequests, dirtyRequests: newDirty };
      }),
      runningRequests: {},
      isRequestRunning: (id) => !!get().runningRequests[id],
      setRequestRunning: (id, isRunning) => set((state) => {
        const next = { ...state.runningRequests };
        if (isRunning) {
          next[id] = true;
        } else {
          delete next[id];
        }
        return { runningRequests: next };
      }),
      responses: {},
      setResponse: (requestId, response) => set((state) => ({ 
        responses: { ...state.responses, [requestId]: response } 
      })),
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
      requestOrigins: {},
      setRequestOrigin: (id, origin) => set((state) => ({
        requestOrigins: { ...state.requestOrigins, [id]: origin }
      })),
      clearRequestOrigin: (id) => set((state) => {
        if (!(id in state.requestOrigins)) return state;
        const next = { ...state.requestOrigins };
        delete next[id];
        return { requestOrigins: next };
      }),
      scratchpadRequestData: {},
      setScratchpadRequestData: (id, data) => set((state) => ({
        scratchpadRequestData: { ...state.scratchpadRequestData, [id]: data }
      })),
      clearScratchpadRequestData: (id) => set((state) => {
        if (!(id in state.scratchpadRequestData)) return state;
        const next = { ...state.scratchpadRequestData };
        delete next[id];
        return { scratchpadRequestData: next };
      }),
      reset: () => set({
        activeRequestId: null,
        openTabs: [],
        runningRequests: {},
        responses: {},
        dirtyRequests: new Set(),
        requestOrigins: {},
        scratchpadRequestData: {},
      }),
    }),
    {
      name: 'firv-app-storage',
      partialize: (state) => ({ 
        scratchpadRequestData: state.scratchpadRequestData,
        openTabs: state.openTabs,
        activeRequestId: state.activeRequestId,
        requestOrigins: state.requestOrigins,
      }),
    }
  )
);
