import { create } from 'zustand';

export interface SecretModalResult {
  name: string;
  value: string;
}

interface SecretModalOptions {
  title: string;
  description?: string;
  initialName?: string;
  initialValue?: string;
  /** Names already used by other secrets, for inline uniqueness validation.
   * Should exclude the secret currently being edited (if any). */
  existingNames?: string[];
}

interface SecretModalState {
  isOpen: boolean;
  title: string;
  description?: string;
  initialName: string;
  initialValue: string;
  existingNames: string[];
  resolve: (result: SecretModalResult | null) => void;
  openSecretModal: (options: SecretModalOptions) => Promise<SecretModalResult | null>;
  closeSecretModal: (result: SecretModalResult | null) => void;
}

export const useSecretModalStore = create<SecretModalState>((set) => ({
  isOpen: false,
  title: '',
  description: '',
  initialName: '',
  initialValue: '',
  existingNames: [],
  resolve: () => {},
  openSecretModal: ({ title, description, initialName = '', initialValue = '', existingNames = [] }) => {
    return new Promise((resolve) => {
      set({
        isOpen: true,
        title,
        description,
        initialName,
        initialValue,
        existingNames,
        resolve,
      });
    });
  },
  closeSecretModal: (result) => {
    set((state) => {
      if (state.resolve) state.resolve(result);
      return { isOpen: false, resolve: () => {} };
    });
  },
}));
