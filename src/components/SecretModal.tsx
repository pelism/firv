import React, { useState, useEffect } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { useSecretModalStore } from '../store/secretModalStore';

export const SecretModal: React.FC = () => {
  const { isOpen, title, description, initialName, initialValue, existingNames, closeSecretModal } = useSecretModalStore();
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [showValue, setShowValue] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      setName(initialName);
      setValue(initialValue);
      setShowValue(false);
      setError('');
    }
  }, [isOpen, initialName, initialValue]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Secret name is required.');
      return;
    }
    if (trimmedName !== initialName && existingNames.includes(trimmedName)) {
      setError(`A secret named "${trimmedName}" already exists.`);
      return;
    }
    closeSecretModal({ name: trimmedName, value });
  };

  const handleCancel = () => {
    closeSecretModal(null);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleCancel()}>
      <DialogContent className="sm:max-w-[440px]" hideClose>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-2.5">
              <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Name</label>
              <Input
                autoFocus
                placeholder="Secret name"
                value={name}
                onChange={(e) => { setName(e.target.value); setError(''); }}
                className="focus-visible:ring-primary/20 focus-visible:border-primary/50 focus-visible:ring-offset-0 dark:focus-visible:ring-primary/20"
              />
            </div>
            <div className="space-y-2.5">
              <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Value</label>
              <div className="relative">
                <Input
                  type={showValue ? 'text' : 'password'}
                  placeholder="Secret value"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  className="pr-9 focus-visible:ring-primary/20 focus-visible:border-primary/50 focus-visible:ring-offset-0 dark:focus-visible:ring-primary/20"
                />
                <button
                  type="button"
                  onClick={() => setShowValue((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={showValue ? 'Hide value' : 'Show value'}
                >
                  {showValue ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            {error && <p className="text-xs text-red-500">{error}</p>}
          </div>
          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={handleCancel}>
              Cancel
            </Button>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
