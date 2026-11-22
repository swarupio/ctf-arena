// Query budgets of the hot endpoints, counted on the fake database (see tests/helpers/queryCounter.js).
// A budget is the number of MongoDB round trips one request may issue; lowering a number is the point of the file,
// raising one needs a reason in docs/QUERY_PERFORMANCE.md. Set QUERY_COUNT_REPORT=1 to print the measured table.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import { buildPuzzle as cipherPuzzle } from '../src/games/cipherlab/game.js';
import { LEVELS as CIPHER_LEVELS } from '../src/games/cipherlab/levels.js';
import { buildPuzzle as crackmePuzzle } from '../src/games/crackme/game.js';
import { LEVELS as CRACKME_LEVELS } from '../src/games/crackme/levels.js';
import { replicaCounter } from '../src/middleware/requestCounter.js';
import { buildCase } from '../src/osint/cases.js';
import { cipherLabDefinitions } from '../src/scripts/seedCipherLab.js';
import { crackmeDefinitions } from '../src/scripts/seedCrackme.js';
import { forensicsDefinitions } from '../src/scripts/seedForensics.js';
import { osintDefinitions } from '../src/scripts/seedOsint.js';
import { weblabDefinitions } from '../src/scripts/seedWebLab.js';
import { answerOf, makeContext } from '../src/forensics/tracks.js';
import { expectedFlagFor } from '../src/services/flagService.js';
import { LABS, labSlug } from '../src/games/weblab/index.js';
import { solveLevel } from './crackme/solvers.js';
import { countQueries } from './helpers/queryCounter.js';
import { database, models } from './security/helpers/fakeDb.js';
import { call, flagOf, seedWorld, terminalFlagOf, verify, world } from './security/helpers/harness.js';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

vi.mock('../src/config/cognito.js', async () => (await import('./security/helpers/harness.js')).cognitoModule());
vi.mock('../src/terminal/shell.js', async () => (await import('./security/helpers/harness.js')).shellModule());
vi.mock('../src/services/dockerService.js', async () => (await import('./security/helpers/fakeDb.js')).fakeDockerModule());
vi.mock('../src/models/User.js', async () => (await import('./security/helpers/fakeDb.js')).modelModule('User'));
vi.mock('../src/models/Team.js', async () => (await import('./security/helpers/fakeDb.js')).modelModule('Team'));
vi.mock('../src/models/Challenge.js', async () => (await import('./security/helpers/fakeDb.js')).modelModule('Challenge'));
vi.mock('../src/models/Instance.js', async () => (await import('./security/helpers/fakeDb.js')).modelModule('Instance'));
vi.mock('../src/models/Solve.js', async () => (await import('./security/helpers/fakeDb.js')).modelModule('Solve'));
vi.mock('../src/models/Submission.js', async () => (await import('./security/helpers/fakeDb.js')).modelModule('Submission'));
vi.mock('../src/models/ReplicaStat.js', async () => (await import('./security/helpers/fakeDb.js')).modelModule('ReplicaStat'));
vi.mock('../src/models/AttemptCounter.js', async () => (await import('./security/helpers/fakeDb.js')).modelModule('AttemptCounter'));
vi.mock('../src/models/CheatSignal.js', async () => (await import('./security/helpers/fakeDb.js')).modelModule('CheatSignal'));
vi.mock('../src/models/TaintedFlag.js', async () => (await import('./security/helpers/fakeDb.js')).modelModule('TaintedFlag'));
vi.mock('../src/models/TerminalActivity.js', async () => (await import('./security/helpers/fakeDb.js')).modelModule('TerminalActivity'));
vi.mock('../src/models/Achievement.js', async () => (await import('./security/helpers/fakeDb.js')).modelModule('Achievement'));
vi.mock('../src/models/CipherHint.js', async () => (await import('./security/helpers/fakeDb.js')).modelModule('CipherHint'));
vi.mock('../src/models/CrackmeHint.js', async () => (await import('./security/helpers/fakeDb.js')).modelModule('CrackmeHint'));
vi.mock('../src/models/CrackmePatch.js', async () => (await import('./security/helpers/fakeDb.js')).modelModule('CrackmePatch'));
vi.mock('../src/models/OsintHint.js', async () => (await import('./security/helpers/fakeDb.js')).modelModule('OsintHint'));
vi.mock('../src/models/AppSetting.js', async () => ({
  default: (await import('./security/helpers/fakeDb.js')).database.collection('AppSetting'),
  ANNOUNCEMENT_LEVELS: ['info', 'warning', 'critical'],
}));
vi.mock('../src/models/AuditLog.js', async () => (await import('./security/helpers/fakeDb.js')).emptyModelModule());
vi.mock('../src/models/OsintBoard.js', async () => ({
  default: (await import('./security/helpers/fakeDb.js')).database.collection('OsintBoard'),
}));

// Budgets: measured counts after the optimisation pass (docs/QUERY_PERFORMANCE.md lists the numbers from before it).
const BUDGET = {
  'POST /challenges/:id/submit (wrong)': 9,
  'POST /challenges/:id/submit (correct)': 21,
  'POST /challenges/:id/submit (correct, badges held)': 16,
  'POST /terminal/:mode/submit (correct)': 22,
  'POST /cipherlab/levels/:id/answer (correct)': 22,
  'POST /crackme/levels/:id/answer (correct)': 22,
  'POST /osint/cases/:track/questions/:n/answer (correct)': 23,
  'POST /forensics/tracks/:track/stages/:n/answer (correct)': 24,
  'POST /weblab/labs/:slug/submit (correct)': 20,
  'GET /leaderboard': 3,
  'GET /leaderboard/timeline': 4,
  'GET /event': 1,
  'GET /announcement': 1,
  'GET /feed': 6,
  'GET /me': 2,
  'GET /challenges': 5,
  'GET /cipherlab/overview': 5,
  'GET /crackme/overview': 6,
  'GET /osint/cases': 4,
  'GET /forensics/tracks': 4,
  'GET /weblab/labs': 4,
  'GET /terminal/modes': 4,
};
const measured = {};

async function measure(label, work) {
  const { result, count, byModel } = await countQueries(work);
  measured[label] = { count, byModel };
  return result;
}

const readyState = Object.getOwnPropertyDescriptor(mongoose.connection, 'readyState');
beforeAll(() => {
  // Pretend to be connected so the guards that skip themselves without a database (settings read, badges) run for real.
  Object.defineProperty(mongoose.connection, 'readyState', { get: () => 1, configurable: true });
});
afterAll(() => {
  if (readyState) { Object.defineProperty(mongoose.connection, 'readyState', readyState); } else { delete mongoose.connection.readyState; }
  replicaCounter.stop();
  if (process.env.QUERY_COUNT_REPORT) {
    const rows = Object.entries(measured).map(([label, { count, byModel }]) => `${String(count).padStart(3)}  ${label}  ${JSON.stringify(byModel)}`);
    process.stdout.write(`\nQUERY COUNTS\n${rows.join('\n')}\n`);
  }
});

const oid = (n) => String(n).padStart(24, '0');
let nextRow = 0;
const addRows = (definitions) => definitions.map((definition) => models.Challenge.insertRaw({
  ...definition, visible: true, solveCount: 0, _id: oid(900000 + (nextRow += 1)),
}));

beforeEach(() => {
  seedWorld();
  verify.mockClear();
  vi.clearAllMocks();
  const settings = database.collection('AppSetting');
  settings.docs = new Map();
  settings.insertRaw({ key: 'platform', registrationOpen: true, submissionsFrozen: false });
  nextRow = 0;
});

const check = (label) => {
  if (!process.env.QUERY_COUNT_REPORT) { expect(measured[label].count, label).toBeLessThanOrEqual(BUDGET[label]); }
};

describe('query budgets: submit paths', () => {
  it('static/docker flag submit', async () => {
    const wrong = 'POST /challenges/:id/submit (wrong)';
    await measure(wrong, () => call('post', `/api/challenges/${world.challenges.docker2._id}/submit`, 'alice', { flag: 'CTF{nope}' }));
    check(wrong);
    const label = 'POST /challenges/:id/submit (correct)';
    const res = await measure(label, () => call('post', `/api/challenges/${world.challenges.docker2._id}/submit`, 'alice', { flag: flagOf(world.challenges.docker2, 'A') }));
    expect(res.status).toBe(200);
    expect(res.body.correct).toBe(true);
    check(label);
  });

  it('flag submit by a player who already holds most badges (the usual case after the first solves)', async () => {
    const solveBefore = models.Solve.all().length;
    for (const key of ['first-solve', 'first-blood', 'category-misc', 'category-web', 'solves-3']) {
      models.Achievement.insertRaw({ userId: world.users.alice._id, key, awardedAt: new Date() });
    }
    const label = 'POST /challenges/:id/submit (correct, badges held)';
    const res = await measure(label, () => call('post', `/api/challenges/${world.challenges.docker2._id}/submit`, 'alice', { flag: flagOf(world.challenges.docker2, 'A') }));
    expect(res.body.correct).toBe(true);
    expect((res.body.badges ?? []).length).toBeLessThanOrEqual(1);
    expect(models.Solve.all().length).toBe(solveBefore + 1);
    check(label);
  });

  it('a static challenge has no instance to stop: no Instance lookup', async () => {
    const free = models.Challenge.insertRaw({
      slug: 'free-static', title: 'Free', category: 'misc', difficulty: 'easy', points: 10, type: 'static', ...(await import('../src/services/flagService.js')).hashStaticFlag('CTF{free_one}'),
    });
    const { byModel } = await countQueries(() => call('post', `/api/challenges/${free._id}/submit`, 'alice', { flag: 'CTF{free_one}' }));
    expect(byModel.Instance).toBeUndefined();
  });

  it('terminal submit', async () => {
    const label = 'POST /terminal/:mode/submit (correct)';
    const res = await measure(label, () => call('post', '/api/terminal/easy/submit', 'alice', { flag: terminalFlagOf('easy', 1, 'A') }));
    expect(res.status).toBe(200);
    expect(res.body.correct).toBe(true);
    check(label);
  });

  it('cipherlab answer', async () => {
    addRows(cipherLabDefinitions());
    const level = CIPHER_LEVELS[0];
    const answer = cipherPuzzle(level, { secret: env.FLAG_SECRET, teamId: world.teams.A._id }).answer;
    const label = 'POST /cipherlab/levels/:id/answer (correct)';
    const res = await measure(label, () => call('post', `/api/cipherlab/levels/${level.id}/answer`, 'alice', { answer }));
    expect(res.body.correct).toBe(true);
    check(label);
  });

  it('crackme answer', async () => {
    addRows(crackmeDefinitions());
    const level = CRACKME_LEVELS[0];
    const { program } = crackmePuzzle(level, { secret: env.FLAG_SECRET, teamId: world.teams.A._id });
    const label = 'POST /crackme/levels/:id/answer (correct)';
    const res = await measure(label, () => call('post', `/api/crackme/levels/${level.id}/answer`, 'alice', { answer: solveLevel(level.id, program) }));
    expect(res.body.correct).toBe(true);
    check(label);
  });

  it('osint answer', async () => {
    addRows(osintDefinitions());
    const answer = buildCase(env.FLAG_SECRET, world.teams.A._id, 'easy').ans[1];
    const label = 'POST /osint/cases/:track/questions/:n/answer (correct)';
    const res = await measure(label, () => call('post', '/api/osint/cases/easy/questions/1/answer', 'alice', { answer }));
    expect(res.body.correct).toBe(true);
    check(label);
  });

  it('forensics answer', async () => {
    addRows(forensicsDefinitions());
    const answer = answerOf(makeContext('easy', env.FLAG_SECRET, world.teams.A._id), 1);
    const label = 'POST /forensics/tracks/:track/stages/:n/answer (correct)';
    const res = await measure(label, () => call('post', '/api/forensics/tracks/easy/stages/1/answer', 'alice', { answer }));
    expect(res.body.correct).toBe(true);
    check(label);
  });

  it('weblab submit', async () => {
    const rows = addRows(weblabDefinitions());
    const lab = LABS[0];
    const row = rows.find((candidate) => candidate.slug === labSlug(lab.id));
    const flag = expectedFlagFor(row, { secret: env.FLAG_SECRET, teamId: world.teams.A._id });
    const label = 'POST /weblab/labs/:slug/submit (correct)';
    const res = await measure(label, () => call('post', `/api/weblab/labs/${row.slug}/submit`, 'alice', { flag }));
    expect(res.body.correct).toBe(true);
    check(label);
  });
});

describe('query budgets: polled and page-load reads', () => {
  const read = async (label, path, token = 'alice') => {
    const res = await measure(label, () => call('get', path, token));
    expect(res.status).toBe(200);
    check(label);
    return res;
  };

  it('leaderboard, timeline and event', async () => {
    await read('GET /leaderboard', '/api/leaderboard');
    await read('GET /leaderboard/timeline', '/api/leaderboard/timeline');
    await read('GET /event', '/api/event');
  });

  it('announcement banner and activity feed', async () => {
    const banner = await measure('GET /announcement', () => call('get', '/api/announcement'));
    expect(banner.status).toBe(200);
    check('GET /announcement');
    await read('GET /feed', '/api/feed');
  });

  it('me and challenges', async () => {
    await read('GET /me', '/api/me');
    await read('GET /challenges', '/api/challenges');
  });

  it('category overviews', async () => {
    addRows(cipherLabDefinitions());
    addRows(crackmeDefinitions());
    addRows(osintDefinitions());
    addRows(forensicsDefinitions());
    addRows(weblabDefinitions());
    await read('GET /cipherlab/overview', '/api/cipherlab/overview');
    await read('GET /crackme/overview', '/api/crackme/overview');
    await read('GET /osint/cases', '/api/osint/cases');
    await read('GET /forensics/tracks', '/api/forensics/tracks');
    await read('GET /weblab/labs', '/api/weblab/labs');
    await read('GET /terminal/modes', '/api/terminal/modes');
  });
});
