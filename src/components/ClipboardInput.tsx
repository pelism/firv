import { useState } from 'react';
import { Clipboard, ClipboardPaste } from 'lucide-react';
import { useNativeContextMenu } from '../hooks/useNativeContextMenu';
import { readClipboardText, writeClipboardText } from '../lib/clipboard';

export const ClipboardInput = () => {
  const [buffer, setBuffer] = useState('');
  const [status, setStatus] = useState<'idle' | 'copied' | 'pasted' | 'error'>('idle');
  const triggerContextMenu = useNativeContextMenu();

  const executeCopy = async () => {
    try {
      if (!buffer) return;
      await writeClipboardText(buffer);
      setStatus('copied');
    } catch (error) {
      console.error('Failed to write clipboard text:', error);
      setStatus('error');
    }
  };

  const executePaste = async () => {
    try {
      const text = await readClipboardText();
      setBuffer(text ?? '');
      setStatus('pasted');
    } catch (error) {
      console.error('Failed to read clipboard text:', error);
      setStatus('error');
    }
  };

  const statusLabel = {
    idle: 'Waiting for action',
    copied: 'Copied to clipboard',
    pasted: 'Pasted from clipboard',
    error: 'Clipboard operation failed',
  }[status];

  return (
    <div
      className="p-4 rounded-2xl border border-border bg-background shadow-sm space-y-3"
      onContextMenu={triggerContextMenu}
    >
      <div className="flex items-center gap-2">
        <div className="p-2 rounded-xl bg-primary/10 text-primary">
          <Clipboard size={20} />
        </div>
        <div>
          <p className="text-sm font-semibold">Clipboard Sandbox</p>
          <p className="text-xs text-muted-foreground">Right-click to open the native menu or use the buttons below.</p>
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Buffer</label>
        <input
          type="text"
          value={buffer}
          onChange={(event) => setBuffer(event.target.value)}
          placeholder="Type something and copy/paste"
          className="w-full rounded-xl border border-border bg-muted/50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
      </div>

      <div className="flex gap-2">
        <button
          onClick={executeCopy}
          className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-muted/50 px-3 py-2 text-xs font-bold uppercase tracking-wider hover:bg-primary/10 hover:text-primary transition-colors"
        >
          <Clipboard size={14} /> Copy
        </button>
        <button
          onClick={executePaste}
          className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-muted/50 px-3 py-2 text-xs font-bold uppercase tracking-wider hover:bg-primary/10 hover:text-primary transition-colors"
        >
          <ClipboardPaste size={14} /> Paste
        </button>
      </div>

      <p className="text-[11px] font-medium text-muted-foreground">{statusLabel}</p>
    </div>
  );
};
