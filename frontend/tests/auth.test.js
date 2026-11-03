import test from 'node:test';
import assert from 'node:assert/strict';
import { roleFromGroups, userFromSession, signInPath, returnPath, authMessage, missingAuthVariables } from '../src/auth/logic.js';
import viteConfig from '../vite.config.js';

test('Vite reads the root env while retaining the browser prefix restriction', () => {
  assert.equal(viteConfig.envDir, '..');
  assert.equal(viteConfig.envPrefix, 'VITE_');
  assert.equal(viteConfig.define, undefined);
});

test('only an exact admin group in an array grants admin', () => {
  assert.equal(roleFromGroups(['player', 'admin']), 'admin');
  for (const groups of [undefined, null, [], ['player'], ['Admin'], ['superadmin'], 'admin', { admin: true }]) {
    assert.equal(roleFromGroups(groups), 'player');
  }
});

test('identity comes from the ID token, never the access token', () => {
  assert.equal(userFromSession({ tokens: { accessToken: { payload: { email: 'access@example.com', 'cognito:groups': ['admin'] } } } }), null);
  assert.deepEqual(userFromSession({ tokens: { idToken: { payload: { email: 'player@example.com', 'cognito:groups': ['player'] } } } }), { email: 'player@example.com', role: 'player' });
  assert.equal(userFromSession(null), null);
});

test('sign-in next steps map to TOTP setup, code and confirmation pages', () => {
  for (const [signInStep, path] of Object.entries({ CONTINUE_SIGN_IN_WITH_TOTP_SETUP: '/mfa-setup', CONFIRM_SIGN_IN_WITH_TOTP_CODE: '/mfa', CONFIRM_SIGN_UP: '/confirm' })) {
    assert.equal(signInPath({ signInStep }), path);
  }
  assert.equal(signInPath(null), '/login');
});

test('return destinations preserve internal paths and reject external paths', () => {
  assert.equal(returnPath({ pathname: '/team', search: '?tab=members', hash: '#top' }), '/team?tab=members#top');
  for (const pathname of ['https://example.com', '//example.com', '/\\example.com', 'team']) assert.equal(returnPath({ pathname }), '/');
  assert.equal(returnPath(null), '/');
});

test('missing configuration reports variable names only', () => {
  assert.deepEqual(missingAuthVariables({ VITE_COGNITO_REGION: 'test-region', VITE_COGNITO_USER_POOL_ID: ' ', PRIVATE_SECRET: 'never expose' }), ['VITE_COGNITO_USER_POOL_ID', 'VITE_COGNITO_CLIENT_ID']);
});

test('auth errors are friendly and never echo raw errors or codes', () => {
  for (const name of ['NotAuthorizedException', 'CodeMismatchException', 'ExpiredCodeException', 'TooManyRequestsException', 'UserNotConfirmedException']) {
    assert.notEqual(authMessage({ name }), authMessage({ name: 'Unknown' }));
  }
  assert.equal(authMessage({ message: 'sensitive code or token' }), 'Unable to complete this request. Please try again.');
});
