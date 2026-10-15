import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The web build is served from /pdf_paint; the Tauri desktop build (--mode tauri) loads from the app root.
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: mode === 'tauri' ? '/' : '/pdf_paint',
  clearScreen: mode !== 'tauri',
  server: { strictPort: mode === 'tauri' },
}));
