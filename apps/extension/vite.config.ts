import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './src/manifest';

// Port can be overridden via `LBAB_EXTENSION_PORT` env var so the dev
// server does not collide with another project running on 5174.
const extensionPort = Number(process.env.LBAB_EXTENSION_PORT ?? 5174);

export default defineConfig({
  plugins: [crx({ manifest })],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {},
    },
  },
  server: {
    port: extensionPort,
    strictPort: true,
    hmr: { port: extensionPort },
  },
});
