import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthLoader, hasStoredSession } from '../src/auth/session.js';
import { authMessage } from '../src/auth/logic.js';

function fakeStorage(keys) {
  return { length: keys.length, key: (index) => keys[index] ?? null };
}

test('a stored Cognito token key means a session may exist', () => {
  for (const key of ['CognitoIdentityServiceProvider.abc123.LastAuthUser', 'CognitoIdentityServiceProvider.abc123.user@example.com.idToken']) {
    assert.equal(hasStoredSession(() => fakeStorage(['theme', key])), true);
  }
});

test('no Cognito keys, wrong prefixes and empty storage mean signed out', () => {
  assert.equal(hasStoredSession(() => fakeStorage([])), false);
  assert.equal(hasStoredSession(() => fakeStorage(['theme', 'arena:event', 'CognitoIdentityServiceProviderX', 'amplify-signin-with-hostedUI'])), false);
  assert.equal(hasStoredSession(() => fakeStorage(['cognitoidentityserviceprovider.abc.LastAuthUser'])), false);
});

test('blocked or throwing storage errs towards loading amplify', () => {
  assert.equal(hasStoredSession(() => { throw new Error('SecurityError'); }), true);
  assert.equal(hasStoredSession(() => ({ get length() { throw new Error('denied'); }, key: () => null })), true);
  assert.equal(hasStoredSession(() => null), true);
});

test('concurrent callers share one in-flight import', async () => {
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const auth = { fetchAuthSession() {} };
  const loader = createAuthLoader(async () => { calls += 1; await gate; return auth; });
  const first = loader.load();
  const second = loader.load();
  assert.equal(first, second);
  assert.equal(loader.isLoaded(), false);
  release();
  assert.equal(await first, auth);
  assert.equal(await loader.load(), auth);
  assert.equal(calls, 1);
  assert.equal(loader.isLoaded(), true);
});

test('a failed import rejects every waiter, is not cached, and the next call retries', async () => {
  let calls = 0;
  const auth = { signIn() {} };
  const loader = createAuthLoader(async () => {
    calls += 1;
    if (calls === 1) throw new TypeError('Failed to fetch dynamically imported module');
    return auth;
  });
  const first = loader.load();
  const second = loader.load();
  const results = await Promise.allSettled([first, second]);
  assert.deepEqual(results.map((result) => result.status), ['rejected', 'rejected']);
  assert.equal(results[0].reason.name, 'NetworkError');
  assert.ok(results[0].reason.cause instanceof TypeError);
  assert.equal(loader.isLoaded(), false);
  assert.equal(await loader.load(), auth);
  assert.equal(calls, 2);
  assert.equal(loader.isLoaded(), true);
});

test('a synchronously throwing importer is also a retryable rejection', async () => {
  let calls = 0;
  const loader = createAuthLoader(() => { calls += 1; if (calls === 1) throw new Error('boom'); return { ok: true }; });
  await assert.rejects(loader.load(), { name: 'NetworkError' });
  assert.deepEqual(await loader.load(), { ok: true });
});

test('a failed library download reaches the UI as the connection message', async () => {
  const loader = createAuthLoader(async () => { throw new Error('offline'); });
  const error = await loader.load().catch((caught) => caught);
  assert.equal(authMessage(error), 'Unable to connect. Check your connection and try again.');
});

test('every Cognito error the sign-in pages can meet has its own message', () => {
  const generic = authMessage(new Error('x'));
  const names = [
    'NotAuthorizedException', 'UserNotFoundException', 'UserNotConfirmedException', 'CodeMismatchException', 'ExpiredCodeException',
    'EnableSoftwareTokenMFAException', 'LimitExceededException', 'TooManyRequestsException', 'TooManyFailedAttemptsException',
    'UsernameExistsException', 'InvalidPasswordException', 'NetworkError', 'SignInException', 'UnexpectedSignInStep',
  ];
  for (const name of names) assert.notEqual(authMessage({ name }), generic, name);
  assert.match(authMessage({ name: 'UserNotConfirmedException' }), /Confirm your email/);
  assert.match(authMessage({ name: 'NotAuthorizedException' }), /incorrect/);
  assert.match(authMessage({ name: 'CodeMismatchException' }), /code is incorrect/);
  assert.match(authMessage({ name: 'LimitExceededException' }), /Too many attempts/);
  assert.match(authMessage({ name: 'NetworkError' }), /Unable to connect/);
  assert.equal(authMessage(undefined), generic);
  assert.equal(authMessage({ name: 'SomethingNew' }), generic);
});
