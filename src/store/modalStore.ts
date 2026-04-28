import { create } from 'zustand';

interface ModalState {
  isOpen: boolean;
  title: string;
  description?: string;
  placeholder?: string;
  defaultValue?: string;
  resolve: (value: string | null) => void;
  openModal: (options: { title: string; description?: string; placeholder?: string; defaultValue?: string }) => Promise<string | null>;
  closeModal: (value: string | null) => void;
}

export const useModalStore = create<ModalState>((set) => ({
  isOpen: false,
  title: '',
  description: '',
  placeholder: '',
  defaultValue: '',
  resolve: () => {},
  openModal: ({ title, description, placeholder, defaultValue }) => {
    return new Promise((resolve) => {
      set({
        isOpen: true,
        title,
        description,
        placeholder,
        defaultValue,
        resolve,
      });
    });
  },
  closeModal: (value) => {
    set((state) => {
      if (state.resolve) state.resolve(value);
      return { isOpen: false, resolve: () => {} };
    });
  },
}));
