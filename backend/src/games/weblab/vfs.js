// A hardcoded virtual file tree. Paths are resolved lexically here; the host filesystem is never touched.
import { LIMITS } from './limits.js';

export function resolvePath(base, relative) {
  const parts = `${base}/${relative}`.split('/');
  if (parts.length > LIMITS.SEGMENTS * 4) { return null; }
  const stack = [];
  for (const part of parts) {
    if (part === '' || part === '.') { continue; }
    if (part === '..') { stack.pop(); } else { stack.push(part); }
  }
  return `/${stack.join('/')}`;
}

export class VirtualTree {
  constructor(files) { this.files = new Map(Object.entries(files)); }

  read(path) {
    if (this.files.has(path)) { return { type: 'file', content: this.files.get(path) }; }
    const prefix = path === '/' ? '/' : `${path}/`;
    const entries = new Set();
    for (const name of this.files.keys()) {
      if (name.startsWith(prefix)) { entries.add(name.slice(prefix.length).split('/')[0]); }
    }
    return entries.size ? { type: 'dir', entries: [...entries].sort() } : null;
  }
}

// The "filter" the vulnerable apps share: removes the literal sequence "../" once, left to right, without
// re-scanning (so "....//" survives as "../"). A simulation of the classic naive sanitiser.
export function stripDotDotOnce(text) {
  return text.replaceAll('../', '');
}
