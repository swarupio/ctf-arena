// Static server for a production build of the frontend with the harness API stubs (data.cjs, ovdata.cjs, playhandler.cjs).
// Serves gzip, the cache and security headers of vercel.json (so CSP violations and caching show up) and the SPA fallback.
// Used by axe.cjs and lighthouse.cjs; standalone: DIST=<dir> PORT=5491 node perfserver.cjs
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { route } = require('./data.cjs');
const ov = require('./ovdata.cjs');
const { makeHandler } = require('./playhandler.cjs');

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.txt': 'text/plain', '.xml': 'application/xml', '.ico': 'image/x-icon' };

function vercelHeaders() {
  // Same rules as vercel.json: /assets and /fonts immutable, everything else no-cache plus the security headers.
  const cfg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../vercel.json'), 'utf8'));
  return (urlPath) => {
    const out = {};
    for (const rule of cfg.headers || []) {
      if (new RegExp('^' + rule.source + '$').test(urlPath)) for (const h of rule.headers) out[h.key] = h.value;
    }
    return out;
  };
}

async function startServer({ dist, port, log = false }) {
  const headersFor = vercelHeaders();
  const play = await makeHandler((req, p) => req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(route(p, Object.fromEntries(new URL(req.url()).searchParams))) }));
  const gamePrefix = /^\/(cipherlab|crackme|forensics|osint|terminal|weblab)(\/|$)/;
  const reply = (res, status, type, body, extra = {}) => { res.writeHead(status, { 'Content-Type': type, ...extra }); res.end(body); };
  const json = (req, status, body) => req.respond({ status, contentType: 'application/json', body: JSON.stringify(body) });
  const api = async (rq, res, url, body) => {
    const fake = {
      url: () => url.href, method: () => rq.method, postData: () => body, continue: () => reply(res, 404, 'text/plain', 'not stubbed'),
      respond: (r) => reply(res, r.status, r.contentType, r.body, { 'X-Served-By': 'replica-2', 'Cache-Control': 'no-store', ...(r.headers || {}) }),
    };
    const p = url.pathname.slice(4);
    if (ov[p]) return json(fake, 200, ov[p]);
    if (p === '/challenges' || /^\/challenges\//.test(p)) return json(fake, 200, route(p, {}));
    if (gamePrefix.test(p)) return play(fake);
    return json(fake, 200, route(p, Object.fromEntries(url.searchParams)));
  };
  const server = http.createServer((rq, res) => {
    const url = new URL(rq.url, 'http://x');
    if (log) console.error(rq.method, url.pathname);
    if (url.pathname.startsWith('/api/')) {
      const chunks = []; rq.on('data', (c) => chunks.push(c));
      rq.on('end', () => api(rq, res, new URL(rq.url, 'http://127.0.0.1:' + port), Buffer.concat(chunks).toString()).catch((e) => reply(res, 500, 'text/plain', String(e))));
      return;
    }
    let file = path.join(dist, decodeURIComponent(url.pathname));
    const isFile = file.startsWith(dist) && fs.existsSync(file) && fs.statSync(file).isFile();
    const known = isFile || /^\/(assets|fonts)\//.test(url.pathname);
    if (!isFile && known) return reply(res, 404, 'text/plain', 'not found');
    if (!isFile) file = path.join(dist, 'index.html');
    const ext = path.extname(file);
    let body = fs.readFileSync(file);
    const hdr = { 'Content-Type': TYPES[ext] || 'application/octet-stream', ...headersFor(isFile ? url.pathname : '/spa') };
    if (/^\.(html|js|css|svg|json|webmanifest|txt|xml)$/.test(ext) && /gzip/.test(rq.headers['accept-encoding'] || '')) { body = zlib.gzipSync(body, { level: 6 }); hdr['Content-Encoding'] = 'gzip'; hdr.Vary = 'Accept-Encoding'; }
    res.writeHead(200, hdr); res.end(body);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return server;
}
module.exports = { startServer };
if (require.main === module) {
  const port = Number(process.env.PORT || 5491);
  startServer({ dist: path.resolve(process.env.DIST), port, log: !!process.env.LOG }).then(() => console.log('serving on', port));
}
