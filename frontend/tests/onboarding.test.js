import test from 'node:test';
import assert from 'node:assert/strict';
import { GAMES } from '../src/games/registry.js';
import { buildChecklist, checklistProgress, FIRST_STEPS, nextStep, pickFirstLevel, recommendedStep } from '../src/onboarding/firstLevels.js';
import { dismissWelcome, isWelcomeDismissed, readState, showChecklist, showWelcome, storageKey } from '../src/onboarding/storage.js';

const memory = (initial = {}) => {
  const data = new Map(Object.entries(initial));
  return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => { data.set(k, String(v)); }, data };
};
const levelTrack = (id, statuses, extra = {}) => ({
  id, title: id.toUpperCase(), difficulty: id, total: statuses.length, solved: statuses.filter((s) => s === 'solved').length,
  levels: statuses.map((status, i) => ({ id: `${id}${i + 1}`, n: i + 1, title: `Level ${i + 1}`, status })), ...extra,
});
const raws = (over = {}) => ({
  terminal: { raw: [
    { mode: 'hard', title: 'Root Vault', codes: 10, solved: 0 },
    { mode: 'easy', title: 'Guest Shell', codes: 6, solved: 0 },
    { mode: 'medium', title: 'Staff Box', codes: 8, solved: 0 },
  ] },
  cipherlab: { raw: { tracks: [levelTrack('medium', ['open', 'locked']), levelTrack('easy', ['solved', 'open', 'locked'].map((s, i) => (i === 0 ? 'open' : 'locked')))] } },
  weblab: { raw: { tracks: [{ id: 'easy', difficulty: 'easy', solved: 0, total: 2, labs: [{ slug: 'cookie-tamper', title: 'Cookie Tamper', solved: false, locked: false, available: true }, { slug: 'b', solved: false, locked: true, available: true }] }] } },
  forensics: { raw: [{ id: 'easy', difficulty: 'easy', caseTitle: 'The Midnight Login', stages: 4, solved: 0, seeded: true }] },
  crackme: { raw: { tracks: [levelTrack('easy', ['open', 'locked'])] } },
  osint: { raw: [{ id: 'easy', difficulty: 'easy', caseTitle: 'Lost Dog Lane', questions: 4, solved: 0, seeded: true }] },
  ...over,
});
const stepOf = (steps, id) => steps.find((s) => s.id === id);

test('pickFirstLevel chooses the first open level of the easiest track in every category', () => {
  const r = raws();
  assert.equal(pickFirstLevel('terminal', r.terminal.raw).href, '/terminal/easy');
  assert.equal(pickFirstLevel('cipherlab', r.cipherlab.raw).href, '/cipherlab/easy1');
  assert.equal(pickFirstLevel('weblab', r.weblab.raw).href, '/weblab/cookie-tamper');
  assert.equal(pickFirstLevel('forensics', r.forensics.raw).href, '/forensics/easy');
  assert.equal(pickFirstLevel('crackme', r.crackme.raw).href, '/reversing/easy1');
  assert.equal(pickFirstLevel('osint', r.osint.raw).href, '/osint/easy');
});

test('pickFirstLevel skips solved and locked levels and falls forward to the next track', () => {
  const raw = { tracks: [levelTrack('easy', ['solved', 'solved']), levelTrack('medium', ['locked', 'locked']), levelTrack('hard', ['open'])] };
  assert.equal(pickFirstLevel('cipherlab', raw).href, '/cipherlab/hard1');
  const second = { tracks: [levelTrack('easy', ['solved', 'open', 'locked'])] };
  assert.equal(pickFirstLevel('crackme', second).href, '/reversing/easy2');
});

test('pickFirstLevel ignores unseeded, empty, finished and garbage input', () => {
  assert.equal(pickFirstLevel('weblab', { tracks: [{ id: 'easy', labs: [{ slug: 'x', available: false, locked: false }] }] }), null);
  assert.equal(pickFirstLevel('forensics', [{ id: 'easy', difficulty: 'easy', stages: 3, solved: 0, seeded: false }]), null);
  assert.equal(pickFirstLevel('osint', [{ id: 'easy', questions: 4, solved: 4, seeded: true }]), null);
  assert.equal(pickFirstLevel('terminal', [{ mode: 'easy', codes: 0, solved: 0 }]), null);
  assert.equal(pickFirstLevel('cipherlab', { tracks: [] }), null);
  for (const id of ['terminal', 'cipherlab', 'weblab', 'forensics', 'crackme', 'osint', 'nope']) {
    for (const junk of [null, undefined, 'x', 42, {}, [null, 3], { tracks: 'no' }]) assert.equal(pickFirstLevel(id, junk), null);
  }
});

test('pickFirstLevel encodes ids so a path cannot be injected', () => {
  const raw = { tracks: [{ id: 'easy', difficulty: 'easy', levels: [{ id: '../x?y', title: 'T', status: 'open' }] }] };
  assert.equal(pickFirstLevel('cipherlab', raw).href, '/cipherlab/..%2Fx%3Fy');
});

test('checklist has six steps in the documented order, all open for a brand new player', () => {
  const steps = buildChecklist(raws(), GAMES);
  assert.deepEqual(steps.map((s) => s.id), ['terminal', 'cipherlab', 'weblab', 'forensics', 'crackme', 'osint']);
  assert.deepEqual(FIRST_STEPS.map((s) => s.id), steps.map((s) => s.id));
  assert.ok(steps.every((s) => s.status === 'open' && s.href && s.minutes > 0 && s.objective));
  assert.equal(checklistProgress(steps).text, '0 of 6 first flags captured');
  assert.equal(recommendedStep(steps).id, 'terminal');
});

test('copy never contains the word game or a flag', () => {
  for (const step of FIRST_STEPS) assert.doesNotMatch(`${step.title} ${step.objective}`, /game|CTF\{/i);
});

test('captured means any solved flag in the category', () => {
  const r = raws({ cipherlab: { raw: { tracks: [levelTrack('easy', ['solved', 'open'])] } }, osint: { raw: [{ id: 'easy', caseTitle: 'X', difficulty: 'easy', questions: 4, solved: 1 }] } });
  const steps = buildChecklist(r, GAMES);
  assert.equal(stepOf(steps, 'cipherlab').status, 'captured');
  assert.equal(stepOf(steps, 'osint').status, 'captured');
  assert.equal(checklistProgress(steps).done, 2);
  assert.equal(nextStep(steps).id, 'terminal');
});

test('all six captured gives a cleared meter and no next step', () => {
  const done = {
    terminal: { raw: [{ mode: 'easy', codes: 2, solved: 2 }] },
    cipherlab: { raw: { tracks: [levelTrack('easy', ['solved'])] } },
    weblab: { raw: { tracks: [{ id: 'easy', total: 1, solved: 1, labs: [{ slug: 'a', solved: true }] }] } },
    forensics: { raw: [{ id: 'easy', stages: 3, solved: 3 }] },
    crackme: { raw: { tracks: [levelTrack('easy', ['solved'])] } },
    osint: { raw: [{ id: 'easy', questions: 4, solved: 4 }] },
  };
  const steps = buildChecklist(done, GAMES);
  const progress = checklistProgress(steps);
  assert.equal(progress.done, 6);
  assert.equal(progress.loaded, true);
  assert.equal(nextStep(steps), null);
});

test('a failing category is unavailable and never blocks the others', () => {
  const steps = buildChecklist(raws({ weblab: { error: true } }), GAMES);
  assert.equal(stepOf(steps, 'weblab').status, 'unavailable');
  assert.equal(stepOf(steps, 'weblab').failed, true);
  assert.equal(steps.filter((s) => s.status === 'open').length, 5);
  assert.equal(checklistProgress(steps).failed, 1);
});

test('an unseeded category is unavailable but not marked as failed', () => {
  const steps = buildChecklist(raws({ forensics: { raw: [{ id: 'easy', difficulty: 'easy', stages: 3, solved: 0, seeded: false }] }, weblab: { raw: { tracks: [] } } }), GAMES);
  assert.equal(stepOf(steps, 'forensics').status, 'unavailable');
  assert.equal(stepOf(steps, 'forensics').failed, false);
  assert.equal(stepOf(steps, 'weblab').status, 'unavailable');
  assert.equal(steps.filter((s) => s.status === 'open').length, 4);
});

test('categories still loading are marked loading and the meter is not loaded', () => {
  const steps = buildChecklist({ terminal: raws().terminal }, GAMES);
  assert.equal(stepOf(steps, 'terminal').status, 'open');
  assert.equal(stepOf(steps, 'osint').status, 'loading');
  assert.equal(checklistProgress(steps).loaded, false);
  assert.equal(buildChecklist(undefined, GAMES).every((s) => s.status === 'loading'), true);
});

test('recommendedStep falls back when the terminal is unavailable', () => {
  const steps = buildChecklist(raws({ terminal: { error: true } }), GAMES);
  assert.equal(recommendedStep(steps).id, 'cipherlab');
  const none = buildChecklist(Object.fromEntries(GAMES.map((g) => [g.id, { error: true }])), GAMES);
  assert.equal(recommendedStep(none), null);
});

test('storage keys are per user, case-insensitive, and empty when signed out', () => {
  assert.equal(storageKey('A@B.com '), 'ctf.onboarding.v1:a@b.com');
  for (const none of ['', '  ', null, undefined, 5]) assert.equal(storageKey(none), '');
});

test('dismissal is stored per user and survives a reload of the state', () => {
  const storage = memory();
  assert.equal(isWelcomeDismissed('a@x.com', storage), false);
  assert.equal(dismissWelcome('a@x.com', storage), true);
  assert.equal(isWelcomeDismissed('A@x.com', storage), true);
  assert.equal(isWelcomeDismissed('b@x.com', storage), false);
  assert.equal(dismissWelcome('', storage), false);
  assert.equal(storage.data.size, 1);
});

test('corrupt or hostile localStorage values read as not dismissed', () => {
  for (const value of ['{not json', 'null', '[]', '"yes"', '42', '{"welcomeDismissed":"true"}', '{"welcomeDismissed":1}', '']) {
    const storage = memory({ 'ctf.onboarding.v1:a@x.com': value });
    assert.deepEqual(readState('a@x.com', storage).welcomeDismissed ?? false, false, value);
    assert.equal(isWelcomeDismissed('a@x.com', storage), false, value);
  }
  // A corrupt value is overwritten by a fresh dismissal.
  const storage = memory({ 'ctf.onboarding.v1:a@x.com': '{oops' });
  assert.equal(dismissWelcome('a@x.com', storage), true);
  assert.equal(isWelcomeDismissed('a@x.com', storage), true);
});

test('blocked storage never throws', () => {
  const blocked = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); } };
  assert.equal(isWelcomeDismissed('a@x.com', blocked), false);
  assert.equal(dismissWelcome('a@x.com', blocked), false);
  assert.equal(isWelcomeDismissed('a@x.com', undefined), false);
});

test('welcome card shows only for a signed-in player who is new, loaded and not dismissed', () => {
  const player = { email: 'a@x.com', role: 'player' };
  const fresh = buildChecklist(raws(), GAMES);
  assert.equal(showWelcome({ user: player, steps: fresh, dismissed: false }), true);
  assert.equal(showWelcome({ user: player, steps: fresh, dismissed: true }), false);
  assert.equal(showWelcome({ user: null, steps: fresh, dismissed: false }), false);
  assert.equal(showWelcome({ user: { email: '', role: 'player' }, steps: fresh, dismissed: false }), false);
  assert.equal(showWelcome({ user: { email: 'a@x.com', role: 'admin' }, steps: fresh, dismissed: false }), false);
  const captured = buildChecklist(raws({ terminal: { raw: [{ mode: 'easy', codes: 2, solved: 1 }] } }), GAMES);
  assert.equal(showWelcome({ user: player, steps: captured, dismissed: false }), false);
  const failing = buildChecklist(raws({ osint: { error: true } }), GAMES);
  assert.equal(showWelcome({ user: player, steps: failing, dismissed: false }), false);
  const loading = buildChecklist({ terminal: raws().terminal }, GAMES);
  assert.equal(showWelcome({ user: player, steps: loading, dismissed: false }), false);
  assert.equal(showWelcome({ user: player, steps: [], dismissed: false }), false);
  assert.equal(showWelcome({ user: player, steps: undefined, dismissed: false }), false);
});

test('the checklist is for signed-in players only', () => {
  assert.equal(showChecklist({ email: 'a@x.com', role: 'player' }), true);
  assert.equal(showChecklist({ email: 'a@x.com', role: 'admin' }), false);
  assert.equal(showChecklist(null), false);
});
