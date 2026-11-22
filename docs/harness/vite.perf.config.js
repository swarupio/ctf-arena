// Production build of the REAL frontend (real index.html, entry, chunking) with stubbed auth, for Lighthouse and axe.
//   cd docs/harness && node ../../frontend/node_modules/vite/bin/vite.js build --config vite.perf.config.js --outDir <scratch dir> --emptyOutDir
// Differences from frontend/vite.config.js: AuthContext and token.js are the harness stubs (so the amplify chunk is absent).
import { fileURLToPath } from 'node:url';
import react from '../../frontend/node_modules/@vitejs/plugin-react/dist/index.js';
import { defineConfig } from '../../frontend/node_modules/vite/dist/node/index.js';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
process.env.VITE_USER_NODE_ENV = '';
export default defineConfig({
  root: here('../../frontend'), envDir: here('../..'), envPrefix: 'VITE_',
  plugins: [react()],
  resolve: { alias: [
    { find: /^.*AuthContext\.jsx$/, replacement: here('./stubAuth.jsx') },
    { find: /^.*\/token\.js$/, replacement: here('./stubToken.js') },
  ] },
  build: { sourcemap: false, rollupOptions: { output: { manualChunks(id) {
    if (!id.includes('node_modules')) return undefined;
    if (id.includes('qrcode.react')) return 'qrcode';
    if (/node_modules[\/](react-router|react-router-dom|cookie|set-cookie-parser)[\/]/.test(id)) return 'router';
    if (/node_modules[\/](react|react-dom|scheduler)[\/]/.test(id)) return 'react';
    return undefined;
  } } } },
});
