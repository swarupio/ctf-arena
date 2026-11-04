import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

// Compares fixed-length digests so lengths never differ and nothing leaks via timing.
function safeEqualHex(a, b) {
  const left = Buffer.from(String(a), 'utf8');
  const right = Buffer.from(String(b), 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

export function hashSubmission(flag) {
  return sha256(`submission:${flag}`);
}

// CTF{<slug_with_underscores>_<first 12 hex of HMAC-SHA256(secret, teamId:challengeId)>}
export function dynamicFlag({ secret, slug, teamId, challengeId }) {
  const digest = createHmac('sha256', secret).update(`${teamId}:${challengeId}`).digest('hex').slice(0, 12);
  return `CTF{${slug.replaceAll('-', '_')}_${digest}}`;
}

export function hashStaticFlag(flag) {
  const flagSalt = randomBytes(16).toString('hex');
  return { flagSalt, flagHash: sha256(`${flagSalt}:${flag}`) };
}

export function verifyStaticFlag({ flagHash, flagSalt }, submitted) {
  if (!flagHash || !flagSalt) { return false; }
  return safeEqualHex(sha256(`${flagSalt}:${submitted}`), flagHash);
}

export function expectedFlagFor(challenge, { secret, teamId }) {
  return dynamicFlag({
    secret, slug: challenge.slug, teamId: String(teamId), challengeId: String(challenge._id),
  });
}

// Docker and terminal challenges have no stored flag: it is derived per team from the secret.
const hasDynamicFlag = (challenge) => challenge.type === 'docker' || challenge.type === 'terminal';

export function verifyFlag(challenge, { secret, teamId, submitted }) {
  const flag = String(submitted).trim();
  if (hasDynamicFlag(challenge)) {
    return safeEqualHex(sha256(flag), sha256(expectedFlagFor(challenge, { secret, teamId })));
  }
  return verifyStaticFlag(challenge, flag);
}

// Compares a submission against the team's expected flag of several dynamic challenges (terminal modes).
// Returns the matching challenge or null. Every candidate is always compared (no early exit), so the time
// taken does not reveal which challenge matched or how far down the list it was.
export function matchDynamicFlag(challenges, { secret, teamId, submitted }) {
  const digest = sha256(String(submitted).trim());
  let match = null;
  for (const challenge of challenges) {
    const equal = safeEqualHex(digest, sha256(expectedFlagFor(challenge, { secret, teamId })));
    if (equal && !match) { match = challenge; }
  }
  return match;
}
