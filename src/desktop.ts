// Native file handling for the Tauri desktop build. Only imported when running inside Tauri,
// so the plugin code stays out of the web bundle's main chunk.
import { save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

/** Asks where to save with the OS Save dialog and writes the file. Returns false if the user cancels. */
export async function savePdfNative(bytes: Uint8Array, defaultName: string): Promise<boolean> {
  const path = await save({ defaultPath: defaultName, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
  if (!path) return false;
  await writeFile(path, bytes);
  return true;
}

/**
 * Calls `onOpen` with each PDF the OS asks us to open ("Open with", double-clicking an
 * associated file) — both the one the app was launched with and any that arrive later.
 * Resolves once the launch file (if any) has been handed over, with whether there was one.
 */
export async function handleOpenedFiles(onOpen: (name: string, bytes: Uint8Array) => Promise<void>): Promise<boolean> {
  const take = async () => {
    const paths = await invoke<string[]>('take_opened_files');
    // Several at once can't all be open in one window, so show the last.
    const path = paths.at(-1);
    if (!path) return false;
    const bytes = new Uint8Array(await invoke<ArrayBuffer>('read_opened_file', { path }));
    await onOpen(path.split(/[\\/]/).pop() || 'document.pdf', bytes);
    return true;
  };
  // Listen before the first take so nothing slips through in between.
  await listen('file-opened', () => void take().catch(() => {}));
  return take();
}
