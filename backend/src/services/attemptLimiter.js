import AttemptCounter from '../models/AttemptCounter.js';
import { AppError } from '../utils/AppError.js';

const MAX_ROUNDS = 4;

// Fixed-window limiter that lives in MongoDB, so every replica sees the same count (hard rule 4).
// Each call counts as one attempt, whatever its outcome, and uses only atomic single-document updates:
//   1. $inc inside a live window; 2. otherwise reset an expired window; 3. otherwise insert the first attempt.
// Racing replicas that lose step 2 or 3 simply go around again and land in step 1.
// Returns the attempt number inside the window, or throws 429 RATE_LIMITED once it exceeds `limit`.
export async function consumeAttempt(key, { limit, windowMs, message = 'Too many attempts. Try again later.' }) {
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + windowMs);
    let counter = await AttemptCounter.findOneAndUpdate(
      { key, expiresAt: { $gt: now } }, { $inc: { count: 1 } }, { new: true },
    );
    if (!counter) {
      counter = await AttemptCounter.findOneAndUpdate(
        { key, expiresAt: { $lte: now } }, { $set: { count: 1, expiresAt } }, { new: true },
      );
    }
    if (!counter) {
      try {
        counter = await AttemptCounter.create({ key, count: 1, expiresAt });
      } catch (error) {
        if (error?.code === 11000) { continue; }
        throw error;
      }
    }
    if (counter.count > limit) { throw new AppError(429, 'RATE_LIMITED', message); }
    return counter.count;
  }
  // Heavy contention on one key means someone is hammering it: fail closed.
  throw new AppError(429, 'RATE_LIMITED', message);
}
