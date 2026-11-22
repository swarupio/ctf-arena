import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src');
const norm = (path) => relative(root, path).replaceAll('\\', '/');
const AMPLIFY = /^(aws-amplify|@aws-amplify)(\/|$)/;

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(js|jsx)$/.test(name) ? [path] : [];
  });
}

function strip(code) {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

// Static specifiers only: `import x from '...'`, `import '...'`, `export ... from '...'`. Dynamic import() is excluded.
function staticSpecifiers(code) {
  const found = [];
  for (const match of strip(code).matchAll(/^\s*(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]/gm)) {
    found.push(match[1] ?? match[2]);
  }
  return found;
}

function dynamicSpecifiers(code) {
  return [...strip(code).matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)].map((match) => match[1]);
}

function resolveLocal(from, specifier) {
  const base = resolve(dirname(from), specifier);
  return [base, `${base}.js`, `${base}.jsx`, join(base, 'index.js'), join(base, 'index.jsx')].find((path) => {
    try { return statSync(path).isFile(); } catch { return false; }
  });
}

const allowed = new Set(['src/auth/amplify.js', 'src/auth/amplifyAuth.js']);
const read = (file) => readFileSync(file, 'utf8');

test('index.html loads src/main.jsx as the entry', () => {
  assert.match(read(join(root, 'index.html')), /<script[^>]+type="module"[^>]+src="\/src\/main\.jsx"/);
});

test('only amplify.js and amplifyAuth.js import aws-amplify', () => {
  const offenders = sourceFiles(src)
    .filter((file) => [...staticSpecifiers(read(file)), ...dynamicSpecifiers(read(file))].some((spec) => AMPLIFY.test(spec)))
    .map(norm)
    .filter((file) => !allowed.has(file));
  assert.deepEqual(offenders, []);
});

test('the static import graph from the entry never reaches amplify', () => {
  const seen = new Set();
  const queue = [join(src, 'main.jsx')];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of staticSpecifiers(read(file))) {
      assert.ok(!AMPLIFY.test(spec), `${norm(file)} statically imports ${spec}`);
      if (spec.startsWith('.')) {
        const target = resolveLocal(file, spec);
        if (target && /\.(js|jsx)$/.test(target)) queue.push(target);
      }
    }
  }
  const reached = [...seen].map(norm);
  assert.ok(reached.includes('src/auth/session.js'), 'the walk should reach session.js');
  for (const file of allowed) assert.ok(!reached.includes(file), `${file} is reachable statically from the entry`);
});

test('amplifyAuth.js is only ever pulled in by the dynamic import in session.js', () => {
  const users = sourceFiles(src).filter((file) => {
    const code = read(file);
    return [...staticSpecifiers(code), ...dynamicSpecifiers(code)].some((spec) => /(^|\/)amplifyAuth(\.js)?$/.test(spec));
  }).map(norm);
  assert.deepEqual(users, ['src/auth/session.js']);
  assert.deepEqual(dynamicSpecifiers(read(join(src, 'auth/session.js'))), ['./amplifyAuth.js']);
  assert.deepEqual(staticSpecifiers(read(join(src, 'auth/session.js'))), []);
});

test('amplify.js (the Amplify.configure call) is only imported by amplifyAuth.js', () => {
  const users = sourceFiles(src)
    .filter((file) => staticSpecifiers(read(file)).some((spec) => /(^|\/)amplify(\.js)?$/.test(spec)))
    .map(norm);
  assert.deepEqual(users, ['src/auth/amplifyAuth.js']);
});
