import { create } from 'zustand';
import type { UpdateFlowResult } from '../lib/updaterClient';

interface UpdateState {
  pendingUpdate: UpdateFlowResult | null;
  isInstalling: boolean;
  error: string | null;
  setPendingUpdate: (update: UpdateFlowResult | null) => void;
  setIsInstalling: (installing: boolean) => void;
  setError: (message: string | null) => void;
}

export const useUpdateStore = create<UpdateState>((set) => ({
  pendingUpdate: null,
  isInstalling: false,
  error: null,
  setPendingUpdate: (pendingUpdate) => set({ pendingUpdate }),
  setIsInstalling: (isInstalling) => set({ isInstalling }),
  setError: (error) => set({ error }),
}));
