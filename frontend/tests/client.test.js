import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApiClient } from '../src/api/client.js';
import { getServedBy, setServedBy, subscribe } from '../src/api/servedBy.js';

test('uses /api, attaches no authorization with the token stub, and records the replica', async () => {
  const api = createApiClient({ fetchImpl: async (url, options) => {
    assert.equal(url, '/api/health');
    assert.equal(options.headers.has('Authorization'), false);
    return Response.json({ status: 'ok', db: 'up' }, { headers: { 'X-Served-By': 'test-replica-1' } });
  } });
  assert.deepEqual(await api('/health'), { status: 'ok', db: 'up' });
  assert.equal(getServedBy(), 'test-replica-1');
});

test('supports an API base URL, asynchronous token provider, and JSON request body', async () => {
  const api = createApiClient({ baseUrl: 'https://example.com/api/', tokenProvider: async () => 'id-token',
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://example.com/api/me');
      assert.equal(options.headers.get('Authorization'), 'Bearer id-token');
      assert.equal(options.headers.get('Content-Type'), 'application/json');
      assert.equal(options.method, 'PATCH');
      assert.equal(options.body, '{"displayName":"Alice"}');
      return Response.json({ displayName: 'Alice' });
    },
  });
  await api('/me', { method: 'PATCH', body: { displayName: 'Alice' } });
});

test('throws the standard API error and records its replica header', async () => {
  const api = createApiClient({ fetchImpl: async () => Response.json({
    error: { code: 'VALIDATION_ERROR', message: 'Display name is too short.' },
  }, { status: 400, headers: { 'X-Served-By': 'test-replica-2' } }) });
  await assert.rejects(api('/me'), { name: 'ApiError', status: 400, code: 'VALIDATION_ERROR', message: 'Display name is too short.' });
  assert.equal(getServedBy(), 'test-replica-2');
});

test('handles proxy HTML errors without exposing the response body', async () => {
  const api = createApiClient({ fetchImpl: async () => new Response('<html>private upstream details</html>', { status: 502 }) });
  await assert.rejects(api('/health'), { status: 502, code: 'HTTP_ERROR', message: 'The request failed (HTTP 502).' });
});

test('handles empty success responses and rejects invalid JSON success responses', async () => {
  const empty = createApiClient({ fetchImpl: async () => new Response(null, { status: 204 }) });
  assert.equal(await empty('/teams/me/leave'), null);
  const invalid = createApiClient({ fetchImpl: async () => new Response('<html>wrong server</html>') });
  await assert.rejects(invalid('/health'), { code: 'INVALID_RESPONSE', status: 200 });
});

test('wraps network errors and preserves request cancellation', async () => {
  const offline = createApiClient({ fetchImpl: async () => { throw new TypeError('private network details'); } });
  await assert.rejects(offline('/health'), { code: 'NETWORK_ERROR', status: 0, message: 'Unable to reach the arena. Please try again.' });
  const aborted = new DOMException('Aborted', 'AbortError');
  const controller = new AbortController();
  controller.abort();
  const api = createApiClient({ fetchImpl: async (url, { signal }) => {
    assert.equal(signal, controller.signal);
    throw aborted;
  } });
  await assert.rejects(api('/health', { signal: controller.signal }), (error) => error === aborted);
});

test('the replica store notifies subscribers, retains the latest header, and unsubscribes', () => {
  let calls = 0;
  const unsubscribe = subscribe(() => { calls += 1; });
  setServedBy('test-replica-3');
  setServedBy('test-replica-3');
  setServedBy(null);
  assert.equal(calls, 1);
  assert.equal(getServedBy(), 'test-replica-3');
  unsubscribe();
  setServedBy('test-replica-4');
  assert.equal(calls, 1);
});
