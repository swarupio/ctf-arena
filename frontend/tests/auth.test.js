import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { copyText, copyStatusText, mfaFromAmr, totpEnabled, roleFromGroups, userFromSession, signInPath, returnPath, authMessage, missingAuthVariables } from '../src/auth/logic.js';
import createViteConfig from '../vite.config.js';

test('Vite reads the root env while retaining the browser prefix restriction', () => {
  const viteConfig = createViteConfig({ mode: 'test' });
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
  assert.deepEqual(userFromSession({ tokens: { idToken: { payload: { email: 'player@example.com', 'cognito:groups': ['player'] } } } }), { email: 'player@example.com', role: 'player', mfa: null });
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

test('copyText reports copied or failed without throwing', async () => {
  let written = '';
  assert.equal(await copyText('JBSWY3DP', { writeText: async (value) => { written = value; } }), 'copied');
  assert.equal(written, 'JBSWY3DP');
  assert.equal(await copyText('JBSWY3DP', { writeText: async () => { throw new Error('denied'); } }), 'failed');
  assert.equal(await copyText('JBSWY3DP', undefined), 'failed');
  assert.equal(await copyText('', { writeText: async () => {} }), 'failed');
  assert.equal(copyStatusText('copied'), 'Copied');
  assert.match(copyStatusText('failed'), /Ctrl\+C/);
  assert.equal(copyStatusText(''), '');
});

test('the amr claim only ever reports MFA as proven or unknown, never guessed', () => {
  assert.equal(mfaFromAmr(['pwd', 'otp', 'mfa']), true);
  assert.equal(mfaFromAmr(['pwd']), false);
  for (const amr of [undefined, null, 'mfa', { mfa: true }]) assert.equal(mfaFromAmr(amr), null);
  const payload = (amr) => ({ tokens: { idToken: { payload: { email: 'a@example.com', 'cognito:groups': ['admin'], amr } } } });
  assert.equal(userFromSession(payload(['pwd', 'otp', 'mfa'])).mfa, true);
  assert.equal(userFromSession(payload(['pwd'])).mfa, false);
});

test('two-step status reads the Cognito preference and treats anything unexpected as off', () => {
  assert.equal(totpEnabled({ enabled: ['TOTP'], preferred: 'TOTP' }), true);
  for (const preference of [undefined, null, {}, { enabled: [] }, { enabled: ['SMS'] }, { enabled: 'TOTP' }]) assert.equal(totpEnabled(preference), false);
});

test('sign-up copy no longer requires an authenticator app, mentions the profile setting and that admins need one', () => {
  const page = readFileSync(new URL('../src/pages/AuthPages.jsx', import.meta.url), 'utf8');
  const signup = page.match(/signup: '(Join[^']+)'/)[1];
  assert.match(signup, /optional/i);
  assert.match(signup, /profile settings/);
  assert.match(signup, /Admin accounts must use one/);
  assert.doesNotMatch(signup, /will also set up|a stolen password alone/);
});

test('amplify is told MFA is optional (the pool setting decides, not the client)', () => {
  assert.match(readFileSync(new URL('../src/auth/amplify.js', import.meta.url), 'utf8'), /status: 'optional'/);
});
