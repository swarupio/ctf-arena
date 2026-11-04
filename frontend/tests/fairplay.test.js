import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// The contract list: must match the backend honeypot constants exactly.
const CONTRACT_PATHS = [
  '/api/internal/debug/flags',
  '/api/internal/config',
  '/api/v1/flags',
  '/api/debug/teams',
  '/api/legacy/solutions',
];

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Trap every way the page could reach the network BEFORE the module is imported, so import-time requests are caught too.
// Each test file runs in its own process, so these globals do not leak into other suites.
const network = [];
const trap = (name) => (...args) => { network.push([name, ...args]); throw new Error(`bait must not use ${name}`); };
globalThis.fetch = trap('fetch');
globalThis.XMLHttpRequest = function XMLHttpRequest() { network.push(['XMLHttpRequest']); throw new Error('bait must not use XHR'); };
globalThis.WebSocket = function WebSocket() { network.push(['WebSocket']); throw new Error('bait must not use WebSocket'); };
const bait = await import('../src/fairplay/bait.js');

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(js|jsx|css|html)$/.test(entry.name) ? [path] : [];
  });
}

test('the five honeypot paths are exactly the contract list', () => {
  assert.deepEqual([...bait.HONEYPOT_PATHS], CONTRACT_PATHS);
  assert.ok(Object.isFrozen(bait.HONEYPOT_PATHS));
});

test('importing the module does not touch the network', () => {
  assert.deepEqual(network, []);
});

test('installBait publishes a normal, frozen, enumerable debug object and never fetches', () => {
  const target = {};
  assert.equal(bait.installBait(target), true);
  const debug = target.__ARENA_DEBUG__;
  assert.equal(debug.build, 'staging-7f3c');
  assert.equal(debug.api, '/api');
  assert.equal(debug.note, 'debug routes enabled for QA, no auth required');
  assert.deepEqual([...debug.internal], CONTRACT_PATHS);
  assert.ok(Object.isFrozen(debug));
  assert.ok(Object.isFrozen(debug.internal));
  // Devtools and console greps must find it, so it must not be hidden.
  assert.equal(Object.getOwnPropertyDescriptor(target, '__ARENA_DEBUG__').enumerable, true);
  assert.equal(typeof target.__arenaDebugFetch, 'function');
  // Installing again (hot reload) is harmless.
  assert.equal(bait.installBait(target), true);
  assert.deepEqual(network, []);
});

test('installBait defaults to the global object (window in the browser) and tolerates a missing target', () => {
  try {
    assert.equal(bait.installBait(), true);
    assert.deepEqual([...globalThis.__ARENA_DEBUG__.internal], CONTRACT_PATHS);
    assert.equal(bait.installBait(null), false);
    assert.deepEqual(network, []);
  } finally {
    delete globalThis.__ARENA_DEBUG__;
    delete globalThis.__arenaDebugFetch;
  }
});

test('__arenaDebugFetch only requests contract paths, and only when someone calls it', async () => {
  const seen = [];
  const fake = async (path) => { seen.push(path); return { ok: true }; };
  for (const path of CONTRACT_PATHS) await bait.__arenaDebugFetch(path, fake);
  assert.deepEqual(seen, CONTRACT_PATHS);
  await bait.__arenaDebugFetch(undefined, fake);
  assert.equal(seen.at(-1), CONTRACT_PATHS[0]);
  assert.throws(() => bait.__arenaDebugFetch('/api/challenges', fake), TypeError);
  assert.equal(seen.length, CONTRACT_PATHS.length + 1);
  assert.deepEqual(network, []);
});

test('no other source file references a honeypot path (real pages must never call them)', () => {
  const baitFile = join(root, 'src', 'fairplay', 'bait.js');
  const offenders = [];
  for (const file of sourceFiles(join(root, 'src'))) {
    if (file === baitFile) continue;
    const text = readFileSync(file, 'utf8');
    for (const path of CONTRACT_PATHS) if (text.includes(path)) offenders.push(`${relative(root, file)} -> ${path}`);
  }
  assert.deepEqual(offenders, []);
});

test('index.html keeps a developer comment that only mentions contract paths', () => {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const comment = html.match(/<!--([\s\S]*?)-->/g)?.find((text) => text.includes('TODO(dev)'));
  assert.ok(comment, 'the TODO(dev) comment is missing');
  assert.match(comment, /\/api\/internal\/debug\/flags/);
  const mentioned = comment.match(/\/api\/[a-z0-9/_-]+/g) ?? [];
  assert.ok(mentioned.length >= 1);
  for (const path of mentioned) assert.ok(CONTRACT_PATHS.includes(path), `${path} is not a honeypot path`);
  // Real content is still there.
  assert.match(html, /<div id="root"><\/div>/);
  assert.match(html, /src="\/src\/main\.jsx"/);
});

test('main.jsx installs the bait exactly once', () => {
  const main = readFileSync(join(root, 'src', 'main.jsx'), 'utf8');
  assert.match(main, /import \{ installBait \} from '\.\/fairplay\/bait\.js';/);
  assert.equal(main.match(/installBait\(\)/g)?.length, 1);
});
