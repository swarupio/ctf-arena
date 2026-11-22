import Challenge from '../models/Challenge.js';
import Solve from '../models/Solve.js';
import { netPoints } from './hintCost.js';

export const FIRST_BLOOD_RATE = 0.1;

export const firstBloodBonus = (points) => Math.floor(points * FIRST_BLOOD_RATE);

// Fixed points, plus a 10% bonus for the first team to solve a challenge.
export function awardFor(points, firstBlood) {
  return firstBlood ? points + firstBloodBonus(points) : points;
}

export async function teamScore(teamId) {
  const [row] = await Solve.aggregate([
    { $match: { teamId } },
    { $group: { _id: null, score: { $sum: '$points' } } },
  ]);
  return row?.score ?? 0;
}

// Only classic challenges (a shared static flag or one shared Docker target) have a race to be "first" at. Games and the
// terminal give every team its own puzzle values and flags, and their mode/track totals are a hard cap shown in the UI
// (docs/ARENA_TERMINAL.md section 8), so they are worth exactly their listed points. An allowlist keeps any future game
// type from silently picking up the bonus.
const FIRST_BLOOD_TYPES = new Set(['static', 'docker']);
export const hasFirstBloodBonus = (challenge) => FIRST_BLOOD_TYPES.has(challenge?.type);

// Records one solve. Returns null when the team already solved it (unique index),
// otherwise { points, firstBlood } plus `hintCost: { spent, openedCount, base, awarded }` when hints cost something.
// `hint: { scope, key }` names the level in the hint ledger (services/hintLedger.js): the points stored on the Solve are the
// base minus the hint spend (never below 1), re-read once after the insert so a hint opened meanwhile is charged too. Loaded lazily so routes that never charge hints do not import the ledger.
// Safe against double clicks on any replica. No team score is returned: no caller used it and computing it cost one aggregation per solve (read it with teamScore when it is really needed).
export async function recordSolve({ challenge, teamId, userId, hint }) {
  let hintCost = null;
  let base = challenge.points;
  let spent = 0;
  const spendOf = async () => {
    const { spentForLevel } = await import('./hintLedger.js');
    return spentForLevel({ teamId, scope: hint.scope, key: hint.key, base: challenge.points });
  };
  const costFor = (level) => ({ spent: challenge.points - base, openedCount: level.openedCount, base: challenge.points, awarded: base });
  if (hint) {
    const first = await spendOf();
    spent = first.spent;
    if (spent > 0) {
      base = netPoints(challenge.points, spent);
      hintCost = costFor(first);
    }
  }
  let created;
  try {
    created = await Solve.create({
      teamId, challengeId: challenge._id, userId, points: base, firstBlood: false,
    });
  } catch (error) {
    if (error.code === 11000) { return null; }
    throw error;
  }
  if (hint) {
    // A hint opened on another replica between the first read and the insert would otherwise go free: read the spend once
    // more and, if it grew, lower the stored points atomically (only ever lowered, never below 1).
    const again = await spendOf();
    if (again.spent > spent) {
      base = netPoints(challenge.points, again.spent);
      hintCost = costFor(again);
      await Solve.updateOne({ _id: created._id, points: { $gt: base } }, { $set: { points: base } });
    }
  }
  // Atomic counter: exactly one team observes solveCount === 1.
  const updated = await Challenge.findOneAndUpdate(
    { _id: challenge._id }, { $inc: { solveCount: 1 } }, { new: true, projection: 'solveCount', lean: true },
  );
  const firstBlood = hasFirstBloodBonus(challenge) && updated?.solveCount === 1;
  const points = awardFor(base, firstBlood);
  if (firstBlood) {
    await Solve.updateOne({ teamId, challengeId: challenge._id }, { $set: { points, firstBlood: true } });
  }
  return hintCost ? { points, firstBlood, hintCost } : { points, firstBlood };
}
