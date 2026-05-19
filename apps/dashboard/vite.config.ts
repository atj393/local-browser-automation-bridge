import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Ports can be overridden by environment variables so the whole stack
// can run on dedicated ports without colliding with another project.
//   LBAB_DASHBOARD_PORT  Vite dev server port (default 5173)
//   LBAB_BACKEND_PORT    Backend port for /api + /test proxy (default 4000)
const dashboardPort = Number(process.env.LBAB_DASHBOARD_PORT ?? 5173);
const backendPort = Number(process.env.LBAB_BACKEND_PORT ?? 4000);
const backendTarget = `http://localhost:${backendPort}`;

export default defineConfig({
  plugins: [react()],
  server: {
    port: dashboardPort,
    strictPort: true,
    proxy: {
      '/api': backendTarget,
      '/test': backendTarget,
    },
  },
});
