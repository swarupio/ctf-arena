import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHALLENGES, LIMITS, NODES, STEPS, TEAMS, TOTAL, stateAt,
} from '../src/demo/demoScript.js';

const PHASES = ['Sign in', 'Team', 'Play', 'Defence', 'Result'];
const ACTORS = ['Alpha', 'Beta', 'Admin', 'System'];
const REPLICAS = ['backend1', 'backend2', 'backend3'];
const LOG_KINDS = ['req', 'db', 'docker', 'ok', 'warn', 'err'];
const BADGE_KINDS = ['ok', 'bad', 'info'];
const STOP_REASONS = ['solved', 'expired', 'killed', 'stopped'];
const teamIds = TEAMS.map((team) => team.id);

// Independent copy of the real rule (backend scoringService): points = base, first blood adds floor(10%).
const award = (slug, firstBlood) => CHALLENGES[slug].points + (firstBlood ? Math.floor(CHALLENGES[slug].points * 0.1) : 0);
const scoreEffects = (step) => step.effects.filter((effect) => effect.type === 'score');
const allEffects = STEPS.flatMap((step, index) => step.effects.map((effect) => ({ ...effect, index })));
const texts = (step) => [
  step.id, step.title, step.narration, step.screen.title,
  ...step.screen.rows.flatMap((row) => [row.label, row.value]),
  ...(step.screen.badge ? [step.screen.badge.text] : []),
  ...step.log.map((line) => line.text),
];

test('the script is non-empty, sized for a demo, and TOTAL matches', () => {
  assert.ok(STEPS.length > 0);
  assert.equal(TOTAL, STEPS.length);
  assert.ok(TOTAL >= 18 && TOTAL <= 24, `unexpected step count ${TOTAL}`);
  assert.equal(new Set(STEPS.map((step) => step.id)).size, TOTAL, 'step ids are unique');
});

test('constants match the contract and the real platform defaults', () => {
  assert.deepEqual(NODES, ['browser', 'cognito', 'nginx', 'backend1', 'backend2', 'backend3', 'mongo', 'docker']);
  assert.deepEqual(TEAMS, [{ id: 'alpha', name: 'Demo Alpha' }, { id: 'beta', name: 'Demo Beta' }]);
  assert.deepEqual(CHALLENGES, {
    'sanity-check': { title: 'Sanity Check', points: 25, type: 'static' },
    'caesar-says': { title: 'Caesar Says', points: 75, type: 'static' },
    'cookie-monster': { title: 'Cookie Monster', points: 100, type: 'docker' },
    'robots-rule': { title: 'Robots Rule', points: 100, type: 'docker' },
    'login-bypass': { title: 'Login Bypass', points: 200, type: 'docker' },
  });
  assert.deepEqual(LIMITS, {
    memoryMb: 128, cpu: 0.25, pids: 64, ttlMinutes: 30, maxPerTeam: 2, capDrop: 'ALL', noNewPrivileges: true, readOnlyRoot: true,
  });
});

test('every step has all required fields with valid types and enums', () => {
  for (const step of STEPS) {
    const where = `step ${step.id}`;
    assert.equal(typeof step.id, 'string', where);
    assert.ok(PHASES.includes(step.phase), `${where}: phase`);
    assert.equal(typeof step.title, 'string', where);
    assert.ok(step.title.length > 0 && step.title.length <= 48, `${where}: title length ${step.title.length}`);
    assert.equal(typeof step.narration, 'string', where);
    assert.ok(step.narration.length > 20 && step.narration.length <= 420, `${where}: narration length`);
    assert.ok(Number.isInteger(step.minute), `${where}: minute`);
    assert.ok(ACTORS.includes(step.actor), `${where}: actor`);
    assert.ok(Number.isInteger(step.duration), `${where}: duration`);
    assert.ok(Array.isArray(step.flow), `${where}: flow`);
    assert.ok(Array.isArray(step.effects), `${where}: effects`);

    assert.equal(typeof step.screen, 'object', where);
    assert.equal(typeof step.screen.title, 'string', where);
    assert.ok(step.screen.rows.length >= 2, `${where}: screen rows`);
    for (const row of step.screen.rows) {
      assert.equal(typeof row.label, 'string', where);
      assert.equal(typeof row.value, 'string', where);
      assert.ok(row.mono === undefined || typeof row.mono === 'boolean', `${where}: mono`);
    }
    if (step.screen.badge) {
      assert.ok(BADGE_KINDS.includes(step.screen.badge.kind), `${where}: badge kind`);
      assert.equal(typeof step.screen.badge.text, 'string', where);
    }

    assert.ok(step.log.length >= 2 && step.log.length <= 5, `${where}: log has ${step.log.length} lines`);
    for (const line of step.log) {
      assert.ok(LOG_KINDS.includes(line.kind), `${where}: log kind ${line.kind}`);
      assert.ok(typeof line.text === 'string' && line.text.length > 0 && line.text.length <= 140, `${where}: log text`);
    }
  }
});

test('narrations are one or two plain sentences', () => {
  for (const step of STEPS) {
    const sentences = step.narration.split(/[.!?](?:\s+|$)/).filter((part) => part.trim().length > 0);
    assert.ok(sentences.length >= 1 && sentences.length <= 2, `${step.id}: ${sentences.length} sentences`);
  }
});

test('phases run in order without going back, and the story starts and ends sensibly', () => {
  const order = STEPS.map((step) => PHASES.indexOf(step.phase));
  for (let i = 1; i < order.length; i += 1) {
    assert.ok(order[i] >= order[i - 1], `phase goes backwards at ${STEPS[i].id}`);
  }
  assert.equal(STEPS[0].phase, 'Sign in');
  assert.equal(STEPS[TOTAL - 1].phase, 'Result');
  for (const phase of PHASES) { assert.ok(STEPS.some((step) => step.phase === phase), `phase ${phase} is used`); }
});

test('game minutes never go backwards and start at zero', () => {
  assert.equal(STEPS[0].minute, 0);
  for (let i = 1; i < STEPS.length; i += 1) {
    assert.ok(STEPS[i].minute >= STEPS[i - 1].minute, `minute decreases at ${STEPS[i].id}`);
  }
  // The reaper step needs the game to run past the 30 minute TTL of the earliest idle container.
  assert.ok(STEPS[TOTAL - 1].minute <= 40);
});

test('flow edges use valid node ids and servedBy is a replica or null', () => {
  for (const step of STEPS) {
    for (const edge of step.flow) {
      assert.ok(Array.isArray(edge) && edge.length === 2, `${step.id}: edge shape`);
      assert.ok(NODES.includes(edge[0]) && NODES.includes(edge[1]), `${step.id}: unknown node in ${edge}`);
      assert.notEqual(edge[0], edge[1], `${step.id}: self edge`);
    }
    assert.ok(step.servedBy === null || REPLICAS.includes(step.servedBy), `${step.id}: servedBy`);
    if (step.servedBy) {
      assert.ok(step.flow.some((edge) => edge.includes(step.servedBy)), `${step.id}: flow passes through ${step.servedBy}`);
    }
  }
});

test('durations are in range and load is spread over all replicas', () => {
  for (const step of STEPS) {
    assert.ok(step.duration >= 3500 && step.duration <= 6500, `${step.id}: duration ${step.duration}`);
  }
  const used = new Set(STEPS.map((step) => step.servedBy).filter(Boolean));
  assert.deepEqual([...used].sort(), REPLICAS);
});

test('stateAt(-1) is the all-zero state before the start', () => {
  const state = stateAt(-1);
  assert.equal(state.index, -1);
  assert.equal(state.minute, 0);
  assert.equal(state.step, null);
  assert.deepEqual(state.lines, []);
  assert.deepEqual(state.instances, []);
  assert.deepEqual(state.activeEdges, []);
  assert.equal(state.servedBy, null);
  assert.equal(state.teams.length, TEAMS.length);
  for (const team of state.teams) {
    assert.equal(team.score, 0);
    assert.equal(team.solveCount, 0);
    assert.deepEqual(team.solves, []);
    assert.equal(team.delta, 0);
    assert.equal(team.banned, false);
  }
  assert.deepEqual(state.teams.map((team) => team.rank), [1, 2]);
  assert.deepEqual(stateAt(-5), state, 'anything below -1 behaves like -1');
  assert.deepEqual(stateAt(TOTAL + 50), stateAt(TOTAL - 1), 'indexes past the end are clamped');
});

test('state shape matches the contract at every step', () => {
  for (let i = 0; i < TOTAL; i += 1) {
    const state = stateAt(i);
    assert.equal(state.index, i);
    assert.equal(state.minute, STEPS[i].minute);
    assert.equal(state.step, STEPS[i]);
    assert.equal(state.servedBy, STEPS[i].servedBy);
    assert.deepEqual(state.activeEdges, STEPS[i].flow);
    assert.equal(state.lines.length, STEPS.slice(0, i + 1).reduce((sum, step) => sum + step.log.length, 0));
    assert.ok(state.instances.length <= 8);
    for (const team of state.teams) {
      assert.deepEqual(Object.keys(team).sort(), ['banned', 'delta', 'id', 'name', 'rank', 'score', 'solveCount', 'solves']);
    }
    // Hard rule: flags and flag hashes never appear in state.
    assert.ok(!/flag/i.test(JSON.stringify(state.instances)), 'instances never carry flags');
  }
});

test('scores change only through score effects and equal base plus first blood', () => {
  const expected = Object.fromEntries(teamIds.map((id) => [id, 0]));
  for (let i = 0; i < TOTAL; i += 1) {
    const gained = Object.fromEntries(teamIds.map((id) => [id, 0]));
    for (const effect of scoreEffects(STEPS[i])) {
      assert.ok(teamIds.includes(effect.team));
      assert.ok(CHALLENGES[effect.challenge], `unknown challenge ${effect.challenge}`);
      assert.equal(typeof effect.firstBlood, 'boolean');
      gained[effect.team] += award(effect.challenge, effect.firstBlood);
    }
    const state = stateAt(i);
    for (const id of teamIds) {
      expected[id] += gained[id];
      const team = state.teams.find((item) => item.id === id);
      assert.equal(team.score, expected[id], `${id} score after ${STEPS[i].id}`);
      assert.equal(team.delta, gained[id], `${id} delta at ${STEPS[i].id}`);
    }
    if (scoreEffects(STEPS[i]).length === 0) {
      assert.deepEqual(state.teams.map((team) => team.delta), [0, 0], `no points move in ${STEPS[i].id}`);
    }
  }
});

test('real-rule spot checks: floor of 10% first blood', () => {
  assert.equal(award('sanity-check', true), 27);
  assert.equal(award('caesar-says', true), 82);
  assert.equal(award('cookie-monster', true), 110);
  assert.equal(award('login-bypass', true), 220);
  assert.equal(award('sanity-check', false), 25);
});

test('first blood goes to the first solver of a challenge, once, and nobody solves twice', () => {
  const solvedBy = new Map();
  for (const effect of allEffects.filter((item) => item.type === 'score')) {
    const key = `${effect.team}:${effect.challenge}`;
    assert.ok(!solvedBy.has(key), `${key} solved twice`);
    const earlier = [...solvedBy.keys()].filter((existing) => existing.endsWith(`:${effect.challenge}`));
    solvedBy.set(key, effect.firstBlood);
    assert.equal(effect.firstBlood, earlier.length === 0, `${key}: first blood must be ${earlier.length === 0}`);
  }
  for (const slug of Object.keys(CHALLENGES)) {
    const solves = allEffects.filter((effect) => effect.type === 'score' && effect.challenge === slug);
    assert.ok(solves.filter((effect) => effect.firstBlood).length <= 1, `${slug}: more than one first blood`);
  }
});

test('start and stop effects are consistent: known ids, unique ports, per-team limit', () => {
  const instances = new Map();
  const ports = new Set();
  for (let i = 0; i < TOTAL; i += 1) {
    for (const effect of STEPS[i].effects) {
      if (effect.type === 'start') {
        assert.ok(!instances.has(effect.id), `${effect.id} started twice`);
        assert.ok(teamIds.includes(effect.team));
        assert.equal(CHALLENGES[effect.challenge]?.type, 'docker', `${effect.id}: only docker challenges get containers`);
        assert.ok(Number.isInteger(effect.port) && effect.port >= 30000 && effect.port <= 30100, `${effect.id}: port`);
        assert.ok(!ports.has(effect.port), `port ${effect.port} reused`);
        ports.add(effect.port);
        instances.set(effect.id, { ...effect, running: true });
      } else if (effect.type === 'stop') {
        const instance = instances.get(effect.id);
        assert.ok(instance, `stop references unknown instance ${effect.id}`);
        assert.ok(instance.running, `${effect.id} stopped twice`);
        assert.ok(STOP_REASONS.includes(effect.reason), `${effect.id}: reason`);
        instance.running = false;
      }
    }
    const running = [...instances.values()].filter((instance) => instance.running);
    assert.equal(new Set(running.map((instance) => instance.port)).size, running.length, 'running ports are unique');
    for (const id of teamIds) {
      const count = running.filter((instance) => instance.team === id).length;
      assert.ok(count <= LIMITS.maxPerTeam, `${id} runs ${count} instances after ${STEPS[i].id}`);
    }
  }
});

test('a docker solve needs an earlier container for that team and challenge, and the solve stops it', () => {
  const started = new Set();
  for (const step of STEPS) {
    for (const effect of step.effects) {
      if (effect.type === 'start') { started.add(`${effect.team}:${effect.challenge}`); }
    }
    for (const effect of scoreEffects(step)) {
      if (CHALLENGES[effect.challenge].type !== 'docker') { continue; }
      assert.ok(started.has(`${effect.team}:${effect.challenge}`), `${effect.team} solves ${effect.challenge} without a container`);
      const stopped = step.effects.find((item) => {
        if (item.type !== 'stop' || item.reason !== 'solved') { return false; }
        const start = allEffects.find((candidate) => candidate.type === 'start' && candidate.id === item.id);
        return start.team === effect.team && start.challenge === effect.challenge;
      });
      assert.ok(stopped, `${step.id}: the solve must stop the team container for ${effect.challenge}`);
    }
  }
});

test('the story covers the reaper, an admin kill, rate limiting and a replica failure', () => {
  const reasons = allEffects.filter((effect) => effect.type === 'stop').map((effect) => effect.reason);
  assert.ok(reasons.includes('expired'), 'reaper expiry');
  assert.ok(reasons.includes('killed'), 'admin kill');
  assert.ok(reasons.includes('solved'), 'auto stop after a solve');
  const logs = STEPS.flatMap((step) => step.log.map((line) => line.text)).join('\n');
  assert.match(logs, /429 RATE_LIMITED/);
  assert.match(logs, /--cap-drop ALL/);
  assert.match(logs, /no-new-privileges/);
  assert.match(logs, /docker stop backend2/);
  assert.match(logs, /unique partial index/);
  const killStep = STEPS.find((step) => step.effects.some((effect) => effect.reason === 'killed'));
  assert.equal(killStep.actor, 'Admin');
  const expiryStep = STEPS.find((step) => step.effects.some((effect) => effect.reason === 'expired'));
  const startOfExpired = allEffects.find((effect) => effect.type === 'start' && effect.id === expiryStep.effects[0].id);
  assert.ok(expiryStep.minute - STEPS[startOfExpired.index].minute >= LIMITS.ttlMinutes, 'expiry only after the full TTL');
});

test('instances list stays visible after they stop, with computed minutesLeft', () => {
  const afterStart = stateAt(STEPS.findIndex((step) => step.id === 'alpha-start-cookie'));
  const cookie = afterStart.instances.find((instance) => instance.id === 'inst-01');
  assert.equal(cookie.status, 'running');
  assert.equal(cookie.minutesLeft, 30);
  assert.deepEqual(cookie.limits, { memoryMb: 128, cpu: 0.25, pids: 64 });
  assert.equal(cookie.title, 'Cookie Monster');

  const solvedIndex = STEPS.findIndex((step) => step.id === 'alpha-cookie-solve');
  const solved = stateAt(solvedIndex).instances.find((instance) => instance.id === 'inst-01');
  assert.equal(solved.status, 'solved');
  assert.equal(solved.minutesLeft, 0);

  const idleIndex = STEPS.findIndex((step) => step.id === 'alpha-wrong-flag');
  const idle = stateAt(idleIndex).instances.find((instance) => instance.id === 'inst-02');
  assert.equal(idle.minutesLeft, 30 - (STEPS[idleIndex].minute - idle.startedMinute));

  const end = stateAt(TOTAL - 1).instances;
  assert.deepEqual(end.map((instance) => instance.status).sort(), ['expired', 'killed', 'solved', 'solved', 'solved']);
  assert.ok(end.every((instance) => instance.minutesLeft === 0));
});

test('the final state ranks two teams 1 and 2 with a clear winner and a lead change on the way', () => {
  const final = stateAt(TOTAL - 1);
  assert.equal(final.teams.length, 2);
  assert.deepEqual(final.teams.map((team) => team.rank), [1, 2]);
  assert.ok(final.teams[0].score > final.teams[1].score, 'clear winner');
  assert.ok(final.teams[1].score > 0);
  assert.equal(final.teams[0].id, 'alpha');
  assert.equal(final.teams[0].score, 357);
  assert.equal(final.teams[1].score, 217);
  assert.deepEqual(final.teams[0].solves, ['sanity-check', 'cookie-monster', 'login-bypass']);
  assert.deepEqual(final.teams[1].solves, ['robots-rule', 'sanity-check', 'caesar-says']);

  const leaders = new Set();
  for (let i = 0; i < TOTAL; i += 1) {
    const [first, second] = stateAt(i).teams;
    if (first.score > second.score) { leaders.add(first.id); }
  }
  assert.deepEqual([...leaders].sort(), ['alpha', 'beta'], 'both teams lead at some point');
});

test('ranks are computed: sorted by score, ties broken by the earlier last solve', () => {
  for (let i = -1; i < TOTAL; i += 1) {
    const { teams } = stateAt(i);
    assert.deepEqual(teams.map((team) => team.rank), teams.map((_, position) => position + 1));
    for (let j = 1; j < teams.length; j += 1) { assert.ok(teams[j - 1].score >= teams[j].score); }
  }
});

test('the final-board screen shows exactly the scores the reducer computes', () => {
  const index = STEPS.findIndex((step) => step.id === 'final-board');
  const { teams } = stateAt(index);
  const rows = STEPS[index].screen.rows;
  teams.forEach((team) => {
    const row = rows.find((item) => item.label.includes(team.name));
    assert.ok(row, `row for ${team.name}`);
    assert.ok(row.label.startsWith(`${team.rank}.`), `${team.name} rank in label`);
    assert.ok(row.value.includes(`${team.score} pts`), `${team.name} score in value`);
    assert.ok(row.value.includes(`${team.solveCount} solves`), `${team.name} solve count in value`);
  });
  assert.ok(STEPS[index].narration.includes(`${teams[0].score} to ${teams[1].score}`));
});

test('team totals shown on score screens match the reducer', () => {
  for (let i = 0; i < TOTAL; i += 1) {
    const row = STEPS[i].screen.rows.find((item) => item.label === 'Team total');
    if (!row) { continue; }
    const scorer = scoreEffects(STEPS[i]).at(-1);
    assert.ok(scorer, `${STEPS[i].id}: Team total shown on a step without a score`);
    const team = stateAt(i).teams.find((item) => item.id === scorer.team);
    assert.equal(row.value, String(team.score), `${STEPS[i].id}: Team total`);
  }
});

test('stateAt is pure: repeatable, does not mutate STEPS, and returns fresh objects', () => {
  const snapshot = structuredClone(STEPS);
  for (let i = -1; i < TOTAL; i += 1) {
    assert.deepEqual(stateAt(i), stateAt(i), `stateAt(${i}) repeats`);
  }
  assert.deepEqual(STEPS, snapshot, 'STEPS untouched');

  const state = stateAt(8);
  const copy = structuredClone(state);
  state.teams[0].score = -1;
  state.teams[0].solves.push('hacked');
  state.instances.length = 0;
  state.lines.push({ stepIndex: 99 });
  state.activeEdges[0][0] = 'mongo';
  assert.deepEqual(stateAt(8), copy, 'mutating a result does not leak into the next call');
  assert.deepEqual(STEPS, snapshot, 'STEPS still untouched');
  assert.equal(stateAt(8.9).index, 8, 'non-integer index is truncated');
  assert.equal(stateAt(Number.NaN).index, -1);
});

test('log lines accumulate in order and carry the step index and minute', () => {
  const state = stateAt(TOTAL - 1);
  let cursor = 0;
  STEPS.forEach((step, stepIndex) => {
    for (const line of step.log) {
      assert.deepEqual(state.lines[cursor], { stepIndex, minute: step.minute, kind: line.kind, text: line.text });
      cursor += 1;
    }
  });
  assert.equal(cursor, state.lines.length);
});

test('no secrets or control characters anywhere in the script text', () => {
  const secretPatterns = [
    /password\s*[:=]\s*\S/i,
    /passwd\s*[:=]/i,
    /secret\s*[:=]\s*\S/i,
    /eyJ[A-Za-z0-9_-]{8,}/,
    /AKIA[0-9A-Z]{12,}/,
    /-----BEGIN/,
    /bearer\s+[A-Za-z0-9._-]{16,}/i,
    /mongodb(\+srv)?:\/\//i,
    /\b[0-9a-f]{24,}\b/i,
  ];
  for (const step of STEPS) {
    for (const text of texts(step)) {
      assert.match(text, /^[\x20-\x7E]+$/, `${step.id}: only printable ASCII allowed in "${text}"`);
      for (const pattern of secretPatterns) {
        assert.doesNotMatch(text, pattern, `${step.id}: "${text}" looks like a secret`);
      }
    }
  }
});

test('every flag shown is an obviously fake demo flag, never a real seeded one', () => {
  const realFlags = ['welcome_to_the_arena', 'caesar_was_here', 'c00kies_are_tasty_a1b2c3', 'local_test_flag'];
  const everything = STEPS.flatMap(texts).join('\n');
  const flags = everything.match(/CTF\{[^}]*\}/g) ?? [];
  assert.ok(flags.length > 0);
  for (const flag of flags) {
    assert.match(flag, /^CTF\{(demo_[a-z_]+|[a-z_]+_(?:[0-9a-f]{12}))\}$/, `${flag} must be demo-shaped`);
    for (const real of realFlags) { assert.ok(!flag.includes(real), `${flag} reuses a real flag`); }
  }
  assert.ok(everything.includes('CTF{cookie_monster_9f3a1c7e2b40}'));
});
