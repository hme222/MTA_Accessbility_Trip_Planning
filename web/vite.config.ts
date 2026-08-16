import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * In development the app talks to the FastAPI service through a proxy, so the
 * browser only ever makes same-origin requests and CORS never enters into it.
 * In production, point VITE_API_URL at the deployed backend.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: process.env.API_TARGET ?? 'http://127.0.0.1:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
