import { describe, expect, it, vi } from 'vitest';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { getCognitoVerifier } from '../src/config/cognito.js';

vi.mock('../src/config/env.js', () => ({
  env: { COGNITO_USER_POOL_ID: 'ap-south-1_test', COGNITO_CLIENT_ID: 'test-client' },
}));
vi.mock('aws-jwt-verify', () => ({ CognitoJwtVerifier: { create: vi.fn() } }));

describe('Cognito verifier configuration', () => {
  it('creates and reuses an ID-token verifier for the configured pool and client', () => {
    const verifier = { verify: vi.fn() };
    CognitoJwtVerifier.create.mockReturnValueOnce(verifier);
    expect(getCognitoVerifier()).toBe(verifier);
    expect(getCognitoVerifier()).toBe(verifier);
    expect(CognitoJwtVerifier.create).toHaveBeenCalledExactlyOnceWith({
      userPoolId: 'ap-south-1_test', clientId: 'test-client', tokenUse: 'id',
    });
  });
});
