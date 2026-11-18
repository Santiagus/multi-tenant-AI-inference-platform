import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/v1': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        // Align with dashboard nginx: real process-next / HF downloads exceed 60s.
        timeout: 1_800_000,
        proxyTimeout: 1_800_000,
      },
      '/healthz': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/readyz': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/docs': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/documentation': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
