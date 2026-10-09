/// <reference types="vitest/config" />
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// [imageLAB patch] Vendored tool config. This tool is served as a plain static
// site from /tools/psychos/ inside the imageLAB repo, so:
//   - base is './' so every emitted asset URL is relative to index.html, which
//     keeps the build portable to any sub-path;
//   - outDir is the repo's dist/tools/psychos, NOT the tool's own dist/.
// emptyOutDir is set explicitly (Vite otherwise refuses to empty an outDir
// outside the project root) and only ever clears dist/tools/psychos — never
// the repo's shared dist/ root.
export default defineConfig({
  base: './',
  plugins: [react()],
  // the trace worker is created as { type: 'module' }, so its bundle must be
  // emitted as ESM rather than the default IIFE
  worker: { format: 'es' },
  build: {
    outDir: resolve(__dirname, '../../dist/tools/psychos'),
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 4096,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
