// Hand-rolled "JWT-like" token used by the simulated labs only. It is NOT the platform's Cognito verifier and no
// real route ever accepts it. Format: base64url(header).base64url(payload).base64url(HMAC-SHA256(secret, first two)).
import { createHmac, timingSafeEqual } from 'node:crypto';
import { LIMITS } from './limits.js';

const enc = (value) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');

export function signToken(payload, secret, alg = 'HS256') {
  const input = `${enc({ alg, typ: 'JWT' })}.${enc(payload)}`;
  const signature = alg === 'none' ? '' : createHmac('sha256', secret).update(input).digest('base64url');
  return `${input}.${signature}`;
}

function parsePart(text) {
  try {
    const value = JSON.parse(Buffer.from(text, 'base64url').toString('utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch { return null; }
}

export function decodeToken(token) {
  if (typeof token !== 'string' || token.length === 0 || token.length > LIMITS.TOKEN) { return null; }
  const parts = token.split('.');
  if (parts.length !== 3) { return null; }
  const header = parsePart(parts[0]);
  const payload = parsePart(parts[1]);
  if (!header || !payload) { return null; }
  return { header, payload, input: `${parts[0]}.${parts[1]}`, signature: parts[2] };
}

export function checkSignature(decoded, secret) {
  const expected = Buffer.from(createHmac('sha256', secret).update(decoded.input).digest('base64url'));
  const given = Buffer.from(decoded.signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
