import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { FRAMEWORKS, SKILLS, SKILL_BY_ID, skillLabel } from '../src/skills/taxonomy.js';
import { CATALOGUE } from '../src/skills/levelSkills.js';
import {
  computeCoverage, filterRows, flattenCatalogue, groupByFramework, levelKey, levelPath, summarize,
} from '../src/skills/coverage.js';
import { CATEGORY_IDS, loadCategory, mergeProgress } from '../src/skills/progress.js';
import { GAMES } from '../src/games/registry.js';
import { LEVELS as CIPHER_LEVELS, TRACKS as CIPHER_TRACKS } from '../../backend/src/games/cipherlab/levels.js';
import { LEVELS as CRACKME_LEVELS, TRACKS as CRACKME_TRACKS } from '../../backend/src/games/crackme/levels.js';
import { TRACKS as WEBLAB_TRACKS } from '../../backend/src/games/weblab/index.js';
import { TRACKS as FORENSICS_TRACKS } from '../../backend/src/forensics/tracks.js';
import { TRACKS as OSINT_TRACKS } from '../../backend/src/osint/cases.js';
import { MODES } from '../../backend/src/terminal/modes/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// ---- taxonomy -------------------------------------------------------------------------------------------------

test('taxonomy: frameworks and skills have unique ids and the required fields', () => {
  const frameworkIds = new Set(FRAMEWORKS.map((framework) => framework.id));
  assert.equal(frameworkIds.size, FRAMEWORKS.length);
  for (const framework of FRAMEWORKS) {
    assert.ok(framework.name && framework.short && framework.owner && framework.note, framework.id);
  }
  assert.equal(new Set(SKILLS.map((skill) => skill.id)).size, SKILLS.length);
  for (const skill of SKILLS) {
    assert.ok(skill.id && skill.name, skill.id);
    assert.ok(frameworkIds.has(skill.framework), `${skill.id}: unknown framework`);
    assert.equal(skill.id, skill.id.toLowerCase());
    assert.equal(skill.id.startsWith(`${skill.framework}-`), true, `${skill.id}: id must start with its framework`);
  }
});

test('taxonomy: official identifiers have the published shape and URLs are well formed', () => {
  for (const framework of FRAMEWORKS) {
    if (framework.id === 'area') { assert.equal(framework.url, null); continue; }
    assert.match(framework.url, /^https:\/\/[a-z0-9.-]+\/\S*$/, `${framework.id} needs an official https source`);
    assert.doesNotThrow(() => new URL(framework.url));
  }
  const shape = { owasp: /^A(0[1-9]|10):2021$/, attack: /^T\d{4}(\.\d{3})?$/, nice: /^(SP|OM|OV|PR|AN|CO|IN)$/ };
  for (const skill of SKILLS) {
    if (skill.framework === 'area') { assert.equal(skill.code, null); continue; }
    assert.match(skill.code, shape[skill.framework], skill.id);
    if (skill.url) {
      assert.doesNotThrow(() => new URL(skill.url));
      assert.match(skill.url, /^https:\/\/attack\.mitre\.org\/techniques\/T\d{4}(\/\d{3})?\/$/);
    }
  }
});

test('taxonomy: OWASP lists exactly A01 to A10 and NICE the seven Rev. 1 categories', () => {
  const owasp = SKILLS.filter((skill) => skill.framework === 'owasp');
  assert.deepEqual(owasp.map((skill) => skill.code), Array.from({ length: 10 }, (_, i) => `A${String(i + 1).padStart(2, '0')}:2021`));
  assert.deepEqual(SKILLS.filter((skill) => skill.framework === 'nice').map((skill) => skill.name).sort(), [
    'Analyze', 'Collect and Operate', 'Investigate', 'Operate and Maintain', 'Oversee and Govern', 'Protect and Defend', 'Securely Provision',
  ]);
});

test('taxonomy: wording never claims certification and copy avoids the banned word', () => {
  const copy = JSON.stringify([FRAMEWORKS, SKILLS]);
  assert.doesNotMatch(copy, /certified|covers the exam|exam prep/i);
  assert.doesNotMatch(JSON.stringify(CATALOGUE), /games?/i);
  assert.equal(skillLabel(SKILL_BY_ID.get('attack-t1078')), 'T1078 Valid Accounts');
  assert.equal(skillLabel(SKILL_BY_ID.get('area-crypto')), 'Cryptography');
});

// ---- mapping --------------------------------------------------------------------------------------------------

const entries = flattenCatalogue(CATALOGUE);

test('mapping: every level has 1 to 3 known, distinct skills and every key is unique', () => {
  assert.ok(entries.length >= 90);
  assert.equal(new Set(entries.map((entry) => entry.key)).size, entries.length);
  for (const entry of entries) {
    assert.ok(entry.skills.length >= 1 && entry.skills.length <= 3, `${entry.key}: ${entry.skills.length} skills`);
    assert.equal(new Set(entry.skills).size, entry.skills.length, `${entry.key}: duplicate skill`);
    for (const id of entry.skills) assert.ok(SKILL_BY_ID.has(id), `${entry.key}: unknown skill ${id}`);
  }
});

test('mapping: every category is a registry category or the challenge list', () => {
  const known = new Set([...GAMES.map((game) => game.id), 'challenges']);
  assert.deepEqual(new Set(CATALOGUE.map((category) => category.id)), known);
  assert.deepEqual([...CATEGORY_IDS].sort(), [...known].sort());
});

// The expected list is built from the real definitions; the catalogue must match it exactly (ids and titles).
const expected = [
  ...Object.values(MODES).flatMap((mode) => mode.codes.map((code) => [`terminal:${mode.mode}:${code.n}`, code.title])),
  ...CIPHER_LEVELS.map((level) => [`cipherlab:${level.track}:${level.id}`, level.title]),
  ...WEBLAB_TRACKS.flatMap((track) => track.labs.map((lab) => [`weblab:${track.id}:${lab.id}`, lab.title])),
  ...Object.values(FORENSICS_TRACKS).flatMap((track) => track.stages.map((stage) => [`forensics:${track.id}:${stage.n}`, stage.title])),
  ...CRACKME_LEVELS.map((level) => [`crackme:${level.track}:${level.id}`, level.title]),
  ...Object.values(OSINT_TRACKS).flatMap((track) => track.stages.map((stage) => [`osint:${track.id}:${stage.n}`, stage.title])),
];

test('mapping: ids and titles match the backend definitions exactly', () => {
  const mapped = new Map(entries.map((entry) => [entry.key, entry.title]));
  for (const [key, title] of expected) {
    assert.ok(mapped.has(key), `${key} (${title}) is missing from the catalogue`);
    assert.equal(mapped.get(key), title, `${key}: title differs from the definition`);
  }
  const games = entries.filter((entry) => entry.category !== 'challenges');
  assert.equal(games.length, expected.length, 'the catalogue lists a level the definitions do not have');
});

test('mapping: track titles match the definitions', () => {
  const titles = new Map(CATALOGUE.flatMap((category) => category.tracks.map((track) => [`${category.id}:${track.id}`, track.title])));
  for (const mode of Object.values(MODES)) assert.equal(titles.get(`terminal:${mode.mode}`), mode.title);
  for (const track of CIPHER_TRACKS) assert.equal(titles.get(`cipherlab:${track.id}`), track.title);
  for (const track of CRACKME_TRACKS) assert.equal(titles.get(`crackme:${track.id}`), track.title);
  for (const track of WEBLAB_TRACKS) assert.equal(titles.get(`weblab:${track.id}`), track.company.name);
  for (const track of Object.values(FORENSICS_TRACKS)) assert.equal(titles.get(`forensics:${track.id}`), track.caseTitle);
  for (const track of Object.values(OSINT_TRACKS)) assert.equal(titles.get(`osint:${track.id}`), track.caseTitle);
});

test('mapping: challenges match the seeded challenge definitions (sanity-check is the one deliberate omission)', () => {
  const dir = path.join(root, 'challenges');
  const definitions = readdirSync(dir, { withFileTypes: true })
    .filter((item) => item.isDirectory() && !item.name.startsWith('_'))
    .map((item) => JSON.parse(readFileSync(path.join(dir, item.name, 'challenge.json'), 'utf8')))
    .filter((definition) => definition.slug !== 'sanity-check');
  const mapped = new Map(entries.filter((entry) => entry.category === 'challenges').map((entry) => [entry.id, entry]));
  assert.equal(mapped.size, definitions.length);
  for (const definition of definitions) {
    const entry = mapped.get(definition.slug);
    assert.ok(entry, `${definition.slug} is not mapped`);
    assert.equal(entry.track, definition.type);
    assert.equal(entry.title, definition.title);
  }
});

test('mapping: skill labels agree with what the levels teach (spot checks)', () => {
  const skills = (key) => entries.find((entry) => entry.key === key).skills;
  assert.ok(skills('weblab:easy:sqli-login').includes('owasp-a03'));
  assert.ok(skills('weblab:easy:idor-statements').includes('owasp-a01'));
  assert.ok(skills('weblab:hard:race-refill').includes('owasp-a04'));
  assert.ok(skills('forensics:hard:3').includes('attack-t1027-003'));
  assert.ok(skills('forensics:easy:1').includes('attack-t1110'));
  assert.ok(skills('terminal:hard:5').includes('attack-t1548-003'));
  assert.ok(skills('cipherlab:hard:h1').includes('area-crypto'));
});

// ---- coverage -------------------------------------------------------------------------------------------------

const fixture = [
  { key: 'a:x:1', category: 'a', categoryTitle: 'A', track: 'x', trackTitle: 'X', id: '1', title: 'One', skills: ['area-crypto', 'owasp-a02'] },
  { key: 'a:x:2', category: 'a', categoryTitle: 'A', track: 'x', trackTitle: 'X', id: '2', title: 'Two', skills: ['area-crypto'] },
  { key: 'b:y:1', category: 'b', categoryTitle: 'B', track: 'y', trackTitle: 'Y', id: '1', title: 'Three', skills: ['area-crypto', 'area-web', 'ghost-skill'] },
];
const rowOf = (rows, id) => rows.find((row) => row.skill.id === id);

test('coverage: counts taught and captured flags per skill', () => {
  const rows = computeCoverage({ entries: fixture, captured: new Set(['a:x:1', 'b:y:1', 'unrelated:key']) });
  assert.equal(rows.length, SKILLS.length);
  const crypto = rowOf(rows, 'area-crypto');
  assert.equal(crypto.total, 3);
  assert.equal(crypto.captured, 2);
  assert.equal(crypto.percent, 67);
  assert.deepEqual(crypto.entries.map((entry) => entry.state), ['captured', 'open', 'captured']);
  assert.equal(rowOf(rows, 'owasp-a02').captured, 1);
  assert.equal(rowOf(rows, 'owasp-a02').percent, 100);
  assert.equal(rowOf(rows, 'owasp-a01').total, 0);
  assert.equal(rowOf(rows, 'owasp-a01').percent, 0);
  assert.equal(rows.some((row) => row.skill.id === 'ghost-skill'), false);
});

test('coverage: without progress (admin, signed out) counts the catalogue and shows no captured numbers', () => {
  const rows = computeCoverage({ entries: fixture, captured: null });
  const crypto = rowOf(rows, 'area-crypto');
  assert.equal(crypto.total, 3);
  assert.equal(crypto.captured, null);
  assert.deepEqual(new Set(crypto.entries.map((entry) => entry.state)), new Set(['unknown']));
});

test('coverage: a failed category keeps its flags as taught but unknown, and never as captured', () => {
  const rows = computeCoverage({ entries: fixture, captured: new Set(['a:x:1']), failed: ['b'] });
  const crypto = rowOf(rows, 'area-crypto');
  assert.equal(crypto.total, 3);
  assert.equal(crypto.captured, 1);
  assert.equal(crypto.unknown, 1);
  assert.equal(rowOf(rows, 'area-web').captured, 0);
  assert.equal(rowOf(rows, 'area-web').unknown, 1);
});

test('coverage: a skill listed twice on one flag counts once; bad input is tolerated', () => {
  const rows = computeCoverage({ entries: [{ ...fixture[0], skills: ['area-crypto', 'area-crypto'] }], captured: new Set() });
  assert.equal(rowOf(rows, 'area-crypto').total, 1);
  assert.equal(computeCoverage({ entries: undefined, captured: undefined }).length, SKILLS.length);
  assert.deepEqual(flattenCatalogue(null), []);
});

test('filter: by framework and by show mode', () => {
  const rows = computeCoverage({ entries: fixture, captured: new Set(['a:x:1']) });
  assert.equal(filterRows(rows).length, SKILLS.length);
  assert.ok(filterRows(rows, { framework: 'owasp' }).every((row) => row.skill.framework === 'owasp'));
  assert.equal(filterRows(rows, { framework: 'owasp' }).length, 10);
  assert.deepEqual(filterRows(rows, { show: 'taught' }).map((row) => row.skill.id).sort(), ['area-crypto', 'area-web', 'owasp-a02']);
  assert.deepEqual(filterRows(rows, { show: 'shown' }).map((row) => row.skill.id).sort(), ['area-crypto', 'owasp-a02']);
  assert.equal(filterRows(rows, { show: 'gaps' }).length, SKILLS.length - 3);
  assert.deepEqual(filterRows(rows, { framework: 'nice', show: 'taught' }), []);
  assert.deepEqual(filterRows(computeCoverage({ entries: fixture, captured: null }), { show: 'shown' }), []);
  assert.deepEqual(filterRows(null), []);
});

test('groupByFramework keeps framework order and drops empty groups; summarize totals', () => {
  const rows = computeCoverage({ entries: fixture, captured: new Set(['a:x:1']) });
  const groups = groupByFramework(filterRows(rows, { show: 'taught' }));
  assert.deepEqual(groups.map((group) => group.framework.id), ['owasp', 'area']);
  assert.deepEqual(summarize(rows), { skills: SKILLS.length, taught: 3, shown: 2, flags: 3 });
});

test('real catalogue: every flag is counted and the headline numbers are consistent', () => {
  const rows = computeCoverage({ entries, captured: new Set(entries.slice(0, 10).map((entry) => entry.key)) });
  const totals = summarize(rows);
  assert.equal(totals.flags, entries.length);
  assert.ok(totals.taught > 20 && totals.taught < totals.skills);
  assert.ok(rows.every((row) => row.captured <= row.total));
});

test('levelPath uses the real routes of each category', () => {
  const at = (key) => entries.find((entry) => entry.key === key);
  assert.equal(levelPath(at('terminal:medium:2')), '/terminal/medium');
  assert.equal(levelPath(at('cipherlab:hard:h2')), '/cipherlab/h2');
  assert.equal(levelPath(at('weblab:easy:sqli-login')), '/weblab/weblab-sqli-login');
  assert.equal(levelPath(at('forensics:insane:3')), '/forensics/insane');
  assert.equal(levelPath(at('crackme:insane:i4')), '/reversing/i4');
  assert.equal(levelPath(at('osint:hard:2')), '/osint/hard');
  assert.equal(levelPath(at('challenges:docker:cookie-monster'), { 'cookie-monster': 'abc123' }), '/challenges/abc123');
  assert.equal(levelPath(at('challenges:docker:cookie-monster')), '/challenges');
  assert.equal(levelKey('terminal', 'easy', 1), 'terminal:easy:1');
});

// ---- progress loading -----------------------------------------------------------------------------------------

test('progress: reads captured flags from each category overview shape', async () => {
  const answers = {
    '/cipherlab/overview': { tracks: [{ id: 'easy', levels: [{ id: 'e1', status: 'solved' }, { id: 'e2', status: 'open' }, { id: 'e3', status: 'locked' }] }] },
    '/crackme/overview': { tracks: [{ id: 'hard', levels: [{ id: 'h2', status: 'solved' }] }] },
    '/weblab/labs': { tracks: [{ id: 'easy', labs: [{ id: 'sqli-login', solved: true }, { id: 'cookie-tamper', solved: false }] }] },
    '/forensics/tracks': [{ id: 'easy', solved: 2 }, { id: 'medium', solved: 0 }],
    '/forensics/tracks/easy': { stages: [{ n: 1, solved: true }, { n: 2, solved: true }, { n: 3, solved: false }] },
    '/osint/cases': [{ id: 'hard', solved: 1 }],
    '/osint/cases/hard': { questions: [{ n: 2, solved: true }] },
    '/terminal/modes': [{ mode: 'easy', solved: 1 }, { mode: 'hard', solved: 0 }],
    '/terminal/easy/progress': { solved: [{ n: 3 }] },
    '/challenges': [
      { id: 'id1', slug: 'caesar-says', type: 'static', solvedByMyTeam: true },
      { id: 'id2', slug: 'robots-rule', type: 'docker', solvedByMyTeam: false },
      { id: 'id3', slug: 'x', type: 'weblab', solvedByMyTeam: true },
    ],
  };
  const requested = [];
  const get = async (route) => { requested.push(route); if (!(route in answers)) throw new Error(`unexpected ${route}`); return answers[route]; };
  const results = await Promise.all(CATEGORY_IDS.map((id) => loadCategory(id, get)));
  const merged = mergeProgress(results);
  assert.deepEqual([...merged.captured].sort(), [
    'challenges:static:caesar-says', 'cipherlab:easy:e1', 'crackme:hard:h2', 'forensics:easy:1', 'forensics:easy:2',
    'osint:hard:2', 'terminal:easy:3', 'weblab:easy:sqli-login',
  ]);
  assert.deepEqual(merged.challengeIds, { 'caesar-says': 'id1', 'robots-rule': 'id2' });
  assert.deepEqual(merged.failed, []);
  assert.equal(requested.includes('/forensics/tracks/medium'), false, 'cases without captured flags are not fetched');
  for (const key of merged.captured) assert.ok(entries.some((entry) => entry.key === key), `${key} is not in the catalogue`);
});

test('progress: one failing category does not blank the others', async () => {
  const get = async (route) => {
    if (route === '/weblab/labs') throw new Error('boom');
    if (route === '/forensics/tracks') return [{ id: 'easy', solved: 1 }];
    if (route === '/forensics/tracks/easy') throw new Error('detail failed');
    if (route === '/cipherlab/overview') return { tracks: [{ id: 'easy', levels: [{ id: 'e1', status: 'solved' }] }] };
    return [];
  };
  const merged = mergeProgress(await Promise.all(CATEGORY_IDS.map((id) => loadCategory(id, get))));
  assert.deepEqual(merged.failed.sort(), ['forensics', 'weblab']);
  assert.ok(merged.captured.has('cipherlab:easy:e1'));
  assert.deepEqual(mergeProgress(undefined).failed, []);
});

test('frameworkSummary counts shown skills among the taught ones, null without progress', async () => {
  const { frameworkSummary } = await import('../src/skills/coverage.js');
  const row = (total, captured) => ({ total, captured });
  assert.deepEqual(frameworkSummary([row(2, 1), row(1, 0), row(0, 0), row(3, 3)]), { shown: 2, taught: 3, percent: 67 });
  assert.equal(frameworkSummary([row(2, null)]), null);
  assert.equal(frameworkSummary([row(0, 0)]), null);
  assert.equal(frameworkSummary([]), null);
});

test('portfolioStatus is incomplete when any category failed to load', async () => {
  const { portfolioStatus } = await import('../src/skills/coverage.js');
  assert.deepEqual(portfolioStatus([]), { complete: true, note: '' });
  assert.deepEqual(portfolioStatus(undefined), { complete: true, note: '' });
  assert.equal(portfolioStatus(['osint']).note, 'Progress incomplete: 1 category failed to load');
  assert.equal(portfolioStatus(['a', 'b']).complete, false);
  assert.equal(portfolioStatus(['a', 'b']).note, 'Progress incomplete: 2 categories failed to load');
});
