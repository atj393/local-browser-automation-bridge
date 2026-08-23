import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // Vite 5 does not yet treat `node:sqlite` (Node >= 22.5) as a builtin and
      // fails to resolve it. Unit tests are pure and never open a database, so
      // it is aliased to a stub that throws if anything actually tries.
      'node:sqlite': fileURLToPath(new URL('./test/node-sqlite-stub.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['apps/**/src/**/*.test.ts', 'packages/**/src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
