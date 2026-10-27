import { z } from 'zod';
import { getCognitoVerifier } from '../config/cognito.js';
import { AppError } from '../utils/AppError.js';

const authorizationSchema = z.string().regex(/^Bearer [^\s,]+$/i);
const identitySchema = z.object({
  sub: z.string().min(1),
  email: z.string().email(),
  'cognito:groups': z.array(z.string()).optional(),
});

export function createAuthMiddleware(verifier) {
  return async function authenticate(req, res, next) {
    const authorization = authorizationSchema.safeParse(req.get('Authorization'));
    if (!authorization.success) {
      return next(new AppError(401, 'UNAUTHENTICATED', 'A valid Bearer token is required.'));
    }

    let identity;
    try {
      const token = authorization.data.slice(7);
      const payload = await (verifier ?? getCognitoVerifier()).verify(token);
      identity = identitySchema.parse(payload);
    } catch {
      return next(new AppError(401, 'UNAUTHENTICATED', 'Invalid or expired token.'));
    }

    req.user = {
      cognitoSub: identity.sub,
      email: identity.email,
      role: identity['cognito:groups']?.includes('admin') ? 'admin' : 'player',
    };
    return next();
  };
}

export const auth = createAuthMiddleware();
