import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@browos/filesystem': fileURLToPath(
        new URL('./packages/filesystem/src/index.ts', import.meta.url),
      ),
      '@browos/window-manager': fileURLToPath(
        new URL('./packages/window-manager/src/index.ts', import.meta.url),
      ),
      '@browos/shared': fileURLToPath(new URL('./packages/shared/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: [
      'tests/**/*.test.ts',
      'packages/**/*.test.ts',
      'system-apps/**/*.test.ts',
      'apps/server/**/*.test.ts',
    ],
    exclude: ['tests/e2e/**', '**/node_modules/**', '**/dist/**'],
    environment: 'node',
    testTimeout: 15000,
    reporters: ['default'],
  },
});
