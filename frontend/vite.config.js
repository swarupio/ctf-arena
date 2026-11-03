import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // Proxy-only setting: stays on the dev server and is not exposed to the browser.
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    envDir: '..',
    envPrefix: 'VITE_',
    server: {
      proxy: {
        '/api': {
          target: process.env.API_PROXY_TARGET || env.API_PROXY_TARGET || 'http://localhost:4000',
          changeOrigin: true,
        },
      },
    },
  };
});
