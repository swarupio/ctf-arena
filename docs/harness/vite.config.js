// Dev server for the layout harness: the real frontend with stubbed auth (stubAuth.jsx, stubToken.js). API calls are
// answered by the browser-side handlers in run.cjs, so no backend and no database are needed.
//   PORT=5480 node ../../frontend/node_modules/vite/bin/vite.js --config vite.config.js   (run it from docs/harness)
import { fileURLToPath } from 'node:url';
import { defineConfig } from '../../frontend/node_modules/vite/dist/node/index.js';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const N = here('../../frontend/node_modules');
export default defineConfig({
  root: here('.'), publicDir: here('../../frontend/public'), esbuild: { jsx: 'automatic' },
  server: { host: '127.0.0.1', port: Number(process.env.PORT || 5480), strictPort: true, fs: { strict: false } },
  resolve: { alias: [
    { find: /^.*AuthContext\.jsx$/, replacement: here('./stubAuth.jsx') },
    { find: /^.*\/token\.js$/, replacement: here('./stubToken.js') },
    { find: /^react-dom\/client$/, replacement: N + '/react-dom/client.js' },
    { find: /^react-dom$/, replacement: N + '/react-dom' },
    { find: /^react\/jsx-dev-runtime$/, replacement: N + '/react/jsx-dev-runtime.js' },
    { find: /^react\/jsx-runtime$/, replacement: N + '/react/jsx-runtime.js' },
    { find: /^react$/, replacement: N + '/react' },
    { find: /^react-router-dom$/, replacement: N + '/react-router-dom' },
  ], dedupe: ['react', 'react-dom'] },
});
