import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { env } from './env.js';

let verifier;

export function getCognitoVerifier() {
  verifier ??= CognitoJwtVerifier.create({
    userPoolId: env.COGNITO_USER_POOL_ID,
    clientId: env.COGNITO_CLIENT_ID,
    tokenUse: 'id',
  });
  return verifier;
}
