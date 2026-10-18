import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE_PATH || './',
  resolve: {
    alias: {
      '@browos/notepad': fileURLToPath(
        new URL('../../system-apps/notepad/src/index.tsx', import.meta.url),
      ),
      '@browos/calculator': fileURLToPath(
        new URL('../../system-apps/calculator/src/index.tsx', import.meta.url),
      ),
      '@browos/paint': fileURLToPath(
        new URL('../../system-apps/paint/src/index.tsx', import.meta.url),
      ),
      '@browos/terminal': fileURLToPath(
        new URL('../../system-apps/terminal/src/index.tsx', import.meta.url),
      ),
      '@browos/photos': fileURLToPath(
        new URL('../../system-apps/photos/src/index.tsx', import.meta.url),
      ),
      '@browos/media-player': fileURLToPath(
        new URL('../../system-apps/media-player/src/index.tsx', import.meta.url),
      ),
    },
  },
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 700 },
  server: { port: 5173, strictPort: true },
});
