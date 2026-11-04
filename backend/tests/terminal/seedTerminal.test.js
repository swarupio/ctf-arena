import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Challenge from '../../src/models/Challenge.js';
import { isEntryPoint } from '../../src/scripts/seedChallenges.js';
import { seedTerminal, terminalDefinitions, terminalSlug } from '../../src/scripts/seedTerminal.js';
import { MODE_NAMES, MODES } from '../../src/terminal/modes/index.js';

vi.mock('../../src/models/Challenge.js', () => ({
  default: { findOne: vi.fn(), create: vi.fn(), updateOne: vi.fn() },
}));

let store;
const totalCodes = MODE_NAMES.reduce((sum, name) => sum + MODES[name].codes.length, 0);

beforeEach(() => {
  vi.resetAllMocks();
  store = new Map();
  Challenge.findOne.mockImplementation(async ({ slug }) => store.get(slug) ?? null);
  Challenge.create.mockImplementation(async (doc) => {
    const row = { _id: `id-${store.size + 1}`, solveCount: 0, ...doc };
    store.set(doc.slug, row);
    return row;
  });
  Challenge.updateOne.mockImplementation(async ({ _id }, { $set }) => {
    Object.assign([...store.values()].find((row) => row._id === _id), $set);
  });
});

describe('terminalDefinitions', () => {
  it('has one definition per code of every mode, from the mode definitions', () => {
    const definitions = terminalDefinitions();
    expect(definitions).toHaveLength(totalCodes);
    for (const name of MODE_NAMES) {
      for (const code of MODES[name].codes) {
        const found = definitions.find((definition) => definition.slug === `terminal-${name}-${code.n}`);
        expect(found).toMatchObject({
          title: `Terminal ${name[0].toUpperCase()}${name.slice(1)} #${code.n}`,
          category: 'terminal', type: 'terminal', difficulty: name, points: code.points,
          terminal: { mode: name, code: code.n },
        });
        expect(found.description.length).toBeGreaterThan(10);
        expect(found).not.toHaveProperty('flag');
        expect(found).not.toHaveProperty('flagHash');
      }
    }
    expect(new Set(definitions.map((definition) => definition.slug)).size).toBe(totalCodes);
    expect(terminalSlug('hard', 6)).toBe('terminal-hard-6');
  });

  it('every slug is a valid challenge slug and does not mention a club', () => {
    for (const definition of terminalDefinitions()) {
      expect(definition.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(JSON.stringify(definition).toLowerCase()).not.toContain('gdgc');
    }
  });

  it('accepts a custom registry', () => {
    const modes = { easy: { codes: [{ n: 1, points: 5 }, { n: 2, points: 6 }] } };
    expect(terminalDefinitions(modes, ['easy']).map(({ slug, points }) => [slug, points])).toEqual([['terminal-easy-1', 5], ['terminal-easy-2', 6]]);
  });
});

describe('seedTerminal', () => {
  it('creates every row on the first run and updates them all on the second (idempotent)', async () => {
    expect(await seedTerminal()).toEqual({ created: totalCodes, updated: 0 });
    expect(store.size).toBe(totalCodes);
    const ids = [...store.values()].map((row) => row._id);
    expect([...store.values()].every((row) => row.visible === true && row.solveCount === 0)).toBe(true);

    expect(await seedTerminal()).toEqual({ created: 0, updated: totalCodes });
    expect(store.size).toBe(totalCodes);
    expect([...store.values()].map((row) => row._id)).toEqual(ids);
    expect(Challenge.create).toHaveBeenCalledTimes(totalCodes);
    expect(Challenge.updateOne).toHaveBeenCalledTimes(totalCodes);
  });

  it('keeps solveCount and visible on update and restores the definition fields', async () => {
    await seedTerminal();
    const row = store.get('terminal-easy-1');
    Object.assign(row, { solveCount: 7, visible: false, points: 1, title: 'edited' });
    await seedTerminal();
    expect(store.get('terminal-easy-1')).toMatchObject({
      solveCount: 7, visible: false, points: MODES.easy.codes[0].points, title: 'Terminal Easy #1',
      terminal: { mode: 'easy', code: 1 },
    });
    for (const [, update] of Challenge.updateOne.mock.calls) {
      expect(Object.keys(update.$set)).not.toContain('solveCount');
      expect(Object.keys(update.$set)).not.toContain('visible');
    }
  });

  it('only creates the rows that are missing', async () => {
    await seedTerminal();
    store.delete('terminal-medium-2');
    expect(await seedTerminal()).toEqual({ created: 1, updated: totalCodes - 1 });
  });
});

describe('npm run seed:terminal', () => {
  it('is wired in package.json to the script, which runs only when started directly', async () => {
    const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
    expect(pkg.scripts['seed:terminal']).toBe('node src/scripts/seedTerminal.js');
    const script = new URL('../../src/scripts/seedTerminal.js', import.meta.url);
    expect(isEntryPoint(script.href, fileURLToPath(script))).toBe(true);
    expect(isEntryPoint(script.href, fileURLToPath(new URL('../../src/scripts/seedChallenges.js', import.meta.url)))).toBe(false);
  });
});
