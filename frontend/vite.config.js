import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { missingAuthVariables } from './src/auth/logic.js';

export default defineConfig(({ mode, command }) => {
  // Proxy-only setting: stays on the dev server and is not exposed to the browser.
  const env = loadEnv(mode, process.cwd(), '');
  // The repo-root .env (shared with the backend) carries NODE_ENV=development, and envDir below points at it. Vite would
  // honour that and bake React's development build into `vite build` (about 700 KB more JS, 90 KB more gzip). An empty
  // value tells Vite there is no user NODE_ENV, so builds stay production builds; the dev server is unaffected.
  if (command === 'build') process.env.VITE_USER_NODE_ENV = '';
  // The Cognito settings are baked into the bundle at build time: say so loudly instead of shipping a "not configured" site.
  if (command === 'build') {
    const missing = missingAuthVariables(loadEnv(mode, '..', 'VITE_'));
    if (missing.length) process.stderr.write(`\n[auth] WARNING: ${missing.join(', ')} not set at build time. Sign-in will show "Authentication is not configured".\n`);
  }
  return {
    plugins: [react()],
    envDir: '..',
    envPrefix: 'VITE_',
    // Never ship source maps: they would hand the original source (and every route the client knows) to anyone with DevTools.
    build: {
      sourcemap: false,
      rollupOptions: {
        output: {
          // Stable vendor chunks cache across deploys and keep rarely used libraries out of the entry.
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined;
            if (id.includes('qrcode.react')) return 'qrcode';
            // React and the router are separate files: a router upgrade does not evict the (larger) react-dom from caches.
            if (/node_modules[\\/](react-router|react-router-dom|cookie|set-cookie-parser)[\\/]/.test(id)) return 'router';
            if (/node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react';
            if (/node_modules[\\/](aws-amplify|@aws-amplify|@aws-sdk|@smithy|@aws-crypto)[\\/]/.test(id)) return 'amplify';
            return undefined;
          },
        },
      },
    },
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
