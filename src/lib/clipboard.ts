import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager';

function hasNavigatorClipboard(): boolean {
  return typeof navigator !== 'undefined' && Boolean(navigator.clipboard);
}

export async function writeClipboardText(value: string) {
  try {
    await writeText(value);
  } catch (error) {
    if (hasNavigatorClipboard() && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(value);
      return;
    }
    throw error;
  }
}

export async function readClipboardText(): Promise<string> {
  try {
    const text = await readText();
    return text ?? '';
  } catch (error) {
    if (hasNavigatorClipboard() && navigator.clipboard.readText) {
      return navigator.clipboard.readText();
    }
    throw error;
  }
}
