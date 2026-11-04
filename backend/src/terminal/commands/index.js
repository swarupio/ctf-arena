// Assembles the command registry: core commands first, then the extras agent's commands (core wins on clashes).
import { extraCommands } from '../extras.js';
import { commands as awkCommands } from './awk.js';
import { commands as builtinCommands } from './builtin.js';
import { commands as diffCommands } from './diff.js';
import { commands as encodingCommands } from './encoding.js';
import { commands as findCommands } from './find.js';
import { commands as fsCommands } from './fs.js';
import { commands as grepCommands } from './grep.js';
import { commands as sedCommands } from './sed.js';
import { commands as sudoCommands } from './sudo.js';
import { commands as systemCommands } from './system.js';
import { commands as textCommands } from './text.js';
import { asText } from './util.js';

const MAX_EXTRA_OUTPUT = 65536;

// Extras are pure text generators (docs section 13). We hand them a ctx without `flag` or `seed` and sanitise the result.
function wrapExtra(name, handler) {
  return async (c) => {
    const stdin = c.stdin == null ? null : asText(c.stdin);
    const ctx = { ...c.rc.ctx, cwd: c.rc.cwd, flag: undefined, seed: undefined };
    let result;
    try {
      result = await handler({ args: [...c.args], stdin, ctx });
    } catch {
      c.err(`${name}: internal error\n`);
      return 1;
    }
    const info = result && typeof result === 'object' ? result : {};
    let text = typeof info.stdout === 'string' ? info.stdout : '';
    if (text.length > MAX_EXTRA_OUTPUT) text = text.slice(0, MAX_EXTRA_OUTPUT);
    if (text !== '' && !text.endsWith('\n')) text += '\n';
    c.out(text);
    if (typeof info.effect === 'string' && /^[a-z]{1,16}$/.test(info.effect)) c.effect = info.effect;
    return Number.isInteger(info.exit) ? info.exit : 0;
  };
}

export function buildRegistry() {
  const registry = new Map();
  for (const group of [fsCommands, findCommands, grepCommands, textCommands, sedCommands, awkCommands, diffCommands, encodingCommands, systemCommands, sudoCommands, builtinCommands]) {
    for (const [name, handler] of Object.entries(group)) registry.set(name, handler);
  }
  const extraNames = new Set();
  if (extraCommands && typeof extraCommands === 'object') {
    for (const [name, handler] of Object.entries(extraCommands)) {
      if (!/^[A-Za-z][A-Za-z0-9_-]{0,30}$/.test(name) || registry.has(name) || typeof handler !== 'function') continue;
      registry.set(name, wrapExtra(name, handler));
      extraNames.add(name);
    }
  }
  return { registry, extraNames, hiddenNames: new Set(['[', '.']) };
}
