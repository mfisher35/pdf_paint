import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';

// pdf.js fetches its decoders (wasm), CMaps and standard fonts at runtime by URL, so they have
// to be served alongside the app. Serve them from node_modules in dev and copy them into the build.
const PDFJS_DIRS = ['wasm', 'cmaps', 'standard_fonts'];
const pdfjsRoot = path.resolve('node_modules/pdfjs-dist');

function pdfjsAssets(): Plugin {
  let base = '/';
  return {
    name: 'pdfjs-assets',
    configResolved(config) {
      base = config.base;
    },
    configureServer(server) {
      const prefix = `${base.replace(/\/$/, '')}/pdfjs/`;
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0];
        if (!url?.startsWith(prefix)) return next();
        const rel = path.normalize(decodeURIComponent(url.slice(prefix.length)));
        const file = path.join(pdfjsRoot, rel);
        if (!PDFJS_DIRS.includes(rel.split(path.sep)[0]) || !fs.existsSync(file)) return next();
        if (file.endsWith('.wasm')) res.setHeader('Content-Type', 'application/wasm');
        fs.createReadStream(file).pipe(res);
      });
    },
    generateBundle() {
      for (const dir of PDFJS_DIRS) {
        for (const name of fs.readdirSync(path.join(pdfjsRoot, dir))) {
          this.emitFile({ type: 'asset', fileName: `pdfjs/${dir}/${name}`, source: fs.readFileSync(path.join(pdfjsRoot, dir, name)) });
        }
      }
    },
  };
}

// The web build is served from /pdf_paint; the Tauri desktop build (--mode tauri) loads from the app root.
export default defineConfig(({ mode }) => ({
  plugins: [react(), pdfjsAssets()],
  base: mode === 'tauri' ? '/' : '/pdf_paint',
  clearScreen: mode !== 'tauri',
  server: { strictPort: mode === 'tauri' },
}));
