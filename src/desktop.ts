// Native file handling for the Tauri desktop build. Only imported when running inside Tauri,
// so the plugin code stays out of the web bundle's main chunk.
import { save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';

/** Asks where to save with the OS Save dialog and writes the file. Returns false if the user cancels. */
export async function savePdfNative(bytes: Uint8Array, defaultName: string): Promise<boolean> {
  const path = await save({ defaultPath: defaultName, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
  if (!path) return false;
  await writeFile(path, bytes);
  return true;
}
