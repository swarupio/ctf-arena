// Arena Terminal hint costs end to end below the HTTP layer: the real shell `hint` command, the real ledger and the real
// recordSolve over the in-memory database (docs/HINTS.md "Hint costs", scope 'terminal', key '<mode>:<code>').
import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { database, models } from '../security/helpers/fakeDb.js';

vi.mock('../../src/models/Solve.js', async () => (await import('../security/helpers/fakeDb.js')).modelModule('Solve'));
vi.mock('../../src/models/Challenge.js', async () => (await import('../security/helpers/fakeDb.js')).modelModule('Challenge'));
vi.mock('../../src/models/Submission.js', async () => (await import('../security/helpers/fakeDb.js')).modelModule('Submission'));
vi.mock('../../src/models/HintOpen.js', async () => (await import('../security/helpers/fakeDb.js')).modelModule('HintOpen'));
vi.mock('../../src/models/CipherHint.js', async () => (await import('../security/helpers/fakeDb.js')).modelModule('CipherHint'));
vi.mock('../../src/models/CrackmeHint.js', async () => (await import('../security/helpers/fakeDb.js')).modelModule('CrackmeHint'));
vi.mock('../../src/models/OsintHint.js', async () => (await import('../security/helpers/fakeDb.js')).modelModule('OsintHint'));
vi.mock('../../src/services/attemptLimiter.js', () => ({ consumeAttempt: vi.fn() }));
const platform = { doc: null };
vi.mock('../../src/models/AppSetting.js', () => ({
  default: { findOne: () => ({ lean: async () => platform.doc }) },
  ANNOUNCEMENT_LEVELS: ['info', 'warning', 'critical'],
}));

const { MODES } = await import('../../src/terminal/modes/index.js');
const { execute } = await import('../../src/terminal/shell.js');
const { buildContext, hintInfo, loadModeChallenges, submitFlag, teamSolves } = await import('../../src/services/terminalService.js');
const { expectedFlagFor } = await import('../../src/services/flagService.js');
const { env } = await import('../../src/config/env.js');

const TEAM = 'a'.repeat(24);
const OTHER = 'b'.repeat(24);
const USER = 'c'.repeat(24);
const definition = MODES.easy; // 4 codes of 40 points, 3+ hints each; cap = 16 (40%)
const team = { _id: TEAM };
const user = { _id: USER };

beforeAll(() => { Object.defineProperty(mongoose.connection, 'readyState', { value: 1, configurable: true }); });
afterAll(() => { delete mongoose.connection.readyState; });
beforeEach(() => {
  database.reset();
  platform.doc = null;
  for (const code of definition.codes) {
    models.Challenge.insertRaw({
      title: `t${code.n}`, slug: `terminal-easy-${code.n}`, points: code.points, type: 'terminal', visible: true, solveCount: 0,
      terminal: { mode: 'easy', code: code.n },
    });
  }
});

const rows = () => loadModeChallenges(definition);
const ctxFor = async (who = team) => buildContext({ definition, cwd: definition.home, challenges: await rows(), team: who, user });
const hint = async (command, who = team) => execute(command, await ctxFor(who));
const flagOf = async (n, teamId = TEAM) => expectedFlagFor((await rows()).find((row) => row.terminal.code === n), { secret: env.FLAG_SECRET, teamId });
const submit = async (n) => submitFlag({ definition, challenges: await rows(), team, user, submitted: await flagOf(n) });
const opens = () => models.HintOpen.all();

describe('the hint command records opens server-side', () => {
  it('records scope terminal, key <mode>:<code>, index tier - 1, once per tier however often it is typed', async () => {
    const first = await hint('hint');
    expect(first.output).toContain('[hint 1/');
    await hint('hint');
    await hint('hint 3');
    expect(opens().map((row) => [row.scope, row.key, row.index]).sort()).toEqual([['terminal', 'easy:1', 0], ['terminal', 'easy:1', 2]]);
    expect(opens().every((row) => String(row.teamId) === TEAM)).toBe(true);
  });

  it('records for the lowest unsolved code only, and keeps teams apart', async () => {
    await submit(1);
    await hint('hint 2');
    expect(opens().map((row) => row.key)).toEqual(['easy:2']);
    await hint('hint 1', { _id: OTHER });
    expect(opens().filter((row) => String(row.teamId) === OTHER).map((row) => row.key)).toEqual(['easy:1']);
  });

  it('records nothing for an admin preview (no team) and nothing when the usage is wrong', async () => {
    const admin = await hint('hint', null);
    expect(admin.output).toContain('[hint 1/');
    await hint('hint abc');
    expect(opens()).toHaveLength(0);
  });
});

describe('deduction at solve time', () => {
  it('awards base minus the price of the opened tiers, reports hintCost, and leaves other codes alone', async () => {
    await hint('hint'); // nudge: 5% of 40 = 2
    await hint('hint 2'); // approach: 10% = 4
    const solved = await submit(1);
    expect(solved).toMatchObject({ correct: true, code: 1, pointsAwarded: 34, hintCost: { spent: 6, openedCount: 2, base: 40, awarded: 34 } });
    expect(models.Solve.all()[0].points).toBe(34);
    const clean = await submit(2);
    expect(clean.pointsAwarded).toBe(40);
    expect(clean.hintCost).toBeUndefined();
  });

  it('caps the deduction at 40 percent of the code (3 tiers = 2 + 4 + 10 = 16)', async () => {
    for (const tier of [1, 2, 3]) { await hint(`hint ${tier}`); }
    const solved = await submit(1);
    expect(solved.pointsAwarded).toBe(24);
    expect(solved.hintCost.spent).toBe(16);
  });

  it('a hint opened after the solve costs nothing, and re-submitting the flag does not charge again', async () => {
    await submit(1);
    await hint('hint 1'); // now for code 2
    expect(models.Solve.all()[0].points).toBe(40);
    expect((await submit(1)).alreadySolved).toBe(true);
    expect(models.Solve.all()[0].points).toBe(40);
  });

  it('does not charge when hint costs are switched off or free (totals unchanged)', async () => {
    platform.doc = { hintCosts: { enabled: false, nudge: 5, approach: 10, walkthrough: 25, maxPercent: 40 } };
    await hint('hint 3');
    expect((await submit(1)).pointsAwarded).toBe(40);
    platform.doc = { hintCosts: { enabled: true, nudge: 0, approach: 0, walkthrough: 0, maxPercent: 40 } };
    await hint('hint 3');
    const second = await submit(2);
    expect(second.pointsAwarded).toBe(40);
    expect(second.hintCost).toBeUndefined();
  });
});

describe('hintInfo (progress)', () => {
  it('prices the next code, lists opened tiers (1-based), never text, and is null for admins or when finished', async () => {
    await hint('hint 2');
    const info = await hintInfo({ definition, challenges: await rows(), solves: await teamSolves(team, await rows()), team });
    expect(info).toMatchObject({ code: 1, base: 40, opened: [2], spent: { points: 6, percent: 15, cap: 16 } }); // 15 percent: tier 2 also pays for tier 1
    expect(info.pricing.map((p) => [p.index, p.percent])).toEqual([[0, 0], [2, 25]]);
    for (const text of definition.codes[0].hints) { expect(JSON.stringify(info)).not.toContain(text); }
    expect(await hintInfo({ definition, challenges: await rows(), solves: [], team: null })).toBeNull();
    for (const code of definition.codes) { await submit(code.n); }
    expect(await hintInfo({ definition, challenges: await rows(), solves: await teamSolves(team, await rows()), team })).toBeNull();
  });
});
