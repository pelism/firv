import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

const DAY_IN_MS = 86_400_000;
const LAST_AUTO_CHECK_STORAGE_KEY = 'firv:last-auto-update-check';

type TauriAwareWindow = Window & {
  __TAURI_INTERNALS__?: unknown;
  __TAURI_IPC__?: unknown;
};

export function isTauriEnvironment(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  const tauriWindow = window as TauriAwareWindow;
  const env = (typeof import.meta !== 'undefined'
    ? (import.meta.env as Record<string, unknown>)
    : undefined);

  return Boolean(
    tauriWindow.__TAURI_INTERNALS__ ||
      tauriWindow.__TAURI_IPC__ ||
      (env && 'TAURI_PLATFORM' in env)
  );
}

export interface UpdateFlowResult {
  available: boolean;
  version?: string;
}

export async function runUpdateFlow(options: { installOnAvailable?: boolean } = {}): Promise<UpdateFlowResult> {
  const { installOnAvailable = true } = options;

  if (!isTauriEnvironment()) {
    return { available: false };
  }

  const update = await check();

  if (update !== null) {
    if (installOnAvailable) {
      await update.downloadAndInstall();
      await relaunch();
    }

    return {
      available: true,
      version: update.version,
    };
  }

  return { available: false };
}

export async function runDailyUpdateCheck(): Promise<UpdateFlowResult | null> {
  if (!isTauriEnvironment() || typeof window === 'undefined') {
    return null;
  }

  const now = Date.now();
  const lastCheckRaw = window.localStorage.getItem(LAST_AUTO_CHECK_STORAGE_KEY);

  if (lastCheckRaw) {
    const lastCheck = Number(lastCheckRaw);
    if (!Number.isNaN(lastCheck) && now - lastCheck < DAY_IN_MS) {
      return null;
    }
  }

  try {
    const result = await runUpdateFlow({ installOnAvailable: false });
    return result;
  } catch (error) {
    console.error('Automatic update check failed', error);
    return null;
  } finally {
    window.localStorage.setItem(LAST_AUTO_CHECK_STORAGE_KEY, `${now}`);
  }
}
