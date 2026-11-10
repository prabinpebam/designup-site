import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// The private preview's public gate: its own build, sharing no chunk with the site. Run by deploy/publish.mjs.
const here = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: `${here}gate`,
  base: process.env.DESIGNUP_BASE ?? '/designup-site/',
  publicDir: false,
  plugins: [react()],
  build: {
    outDir: process.env.DESIGNUP_GATE_OUT ?? `${here}../.deploy-out/gate`,
    emptyOutDir: true,
    assetsDir: '_gate/assets',
    sourcemap: false,
  },
});
