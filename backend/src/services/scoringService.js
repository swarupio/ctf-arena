import Challenge from '../models/Challenge.js';
import Solve from '../models/Solve.js';

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

// Records one solve. Returns null when the team already solved it (unique index),
// otherwise { points, firstBlood, score }. Safe against double clicks on any replica.
export async function recordSolve({ challenge, teamId, userId }) {
  try {
    await Solve.create({
      teamId, challengeId: challenge._id, userId, points: challenge.points, firstBlood: false,
    });
  } catch (error) {
    if (error.code === 11000) { return null; }
    throw error;
  }
  // Atomic counter: exactly one team observes solveCount === 1.
  const updated = await Challenge.findOneAndUpdate(
    { _id: challenge._id }, { $inc: { solveCount: 1 } }, { new: true },
  );
  const firstBlood = updated?.solveCount === 1;
  const points = awardFor(challenge.points, firstBlood);
  if (firstBlood) {
    await Solve.updateOne({ teamId, challengeId: challenge._id }, { $set: { points, firstBlood: true } });
  }
  return { points, firstBlood, score: await teamScore(teamId) };
}
