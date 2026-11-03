import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isEntryPoint, loadDefinitions } from '../src/scripts/seedChallenges.js';

const scriptUrl = new URL('../src/scripts/seedChallenges.js', import.meta.url);

describe('isEntryPoint (run-directly guard of npm run seed:challenges)', () => {
  it('is true when argv[1] is this very file, however node was started', () => {
    const entry = fileURLToPath(scriptUrl);
    expect(isEntryPoint(scriptUrl.href, entry)).toBe(true);
    // Relative paths are resolved against the working directory, like node does.
    const relative = resolve(entry).slice(resolve('.').length + 1);
    expect(isEntryPoint(scriptUrl.href, relative)).toBe(true);
  });

  it('is false for another script or when there is no entry file', () => {
    expect(isEntryPoint(scriptUrl.href, fileURLToPath(new URL('../src/scripts/seed.js', import.meta.url)))).toBe(false);
    expect(isEntryPoint(scriptUrl.href, undefined)).toBe(false);
    expect(isEntryPoint(scriptUrl.href, '')).toBe(false);
  });

  // Regression: the old guard compared with a hand-built `file:///${argv[1]}`, which on Linux is
  // `file:////app/...` and never matched, so the seed silently did nothing on the Azure VM.
  it.skipIf(process.platform === 'win32')('matches a POSIX path such as the one inside the backend image', () => {
    expect(isEntryPoint('file:///app/src/scripts/seedChallenges.js', '/app/src/scripts/seedChallenges.js')).toBe(true);
    expect(`file:///${'/app/src/scripts/seedChallenges.js'}`).not.toBe(pathToFileURL('/app/src/scripts/seedChallenges.js').href);
  });
});

describe('loadDefinitions', () => {
  it('reads challenge.json from each folder, skipping _template, folders without one and loose files', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ctf-seed-'));
    try {
      await mkdir(join(directory, 'alpha'));
      await writeFile(join(directory, 'alpha', 'challenge.json'), JSON.stringify({ slug: 'alpha', type: 'static', flag: 'CTF{a}' }));
      await mkdir(join(directory, '_template'));
      await writeFile(join(directory, '_template', 'challenge.json'), JSON.stringify({ slug: 'template' }));
      await mkdir(join(directory, 'no-definition'));
      await writeFile(join(directory, 'notes.txt'), 'not a challenge');
      expect(await loadDefinitions(directory)).toEqual([{ slug: 'alpha', type: 'static', flag: 'CTF{a}' }]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('does not swallow a malformed challenge.json', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ctf-seed-'));
    try {
      await mkdir(join(directory, 'broken'));
      await writeFile(join(directory, 'broken', 'challenge.json'), '{ nope');
      await expect(loadDefinitions(directory)).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('finds the starter challenges of the repository by default', async () => {
    const slugs = (await loadDefinitions()).map((definition) => definition.slug).sort();
    expect(slugs).toEqual(expect.arrayContaining(['sanity-check', 'caesar-says', 'robots-rule', 'cookie-monster', 'login-bypass']));
  });
});
