import test from 'node:test';
import assert from 'node:assert/strict';
import { GENERIC_FAILURE, SERVER_TROUBLE, parseApiResponse } from '../src/api/response.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const html = (status) => new Response('<html><body>Bad Gateway</body></html>', { status, headers: { 'content-type': 'text/html' } });

test('a JSON success resolves with the parsed body', async () => {
  assert.deepEqual(await parseApiResponse(json({ ok: true })), { ok: true });
});

test('a JSON error keeps the server message, status and code', async () => {
  await assert.rejects(parseApiResponse(json({ error: { code: 'TEAM_FULL', message: 'The team is full.' } }, 409)), (error) => {
    assert.equal(error.message, 'The team is full.');
    assert.equal(error.status, 409);
    assert.equal(error.code, 'TEAM_FULL');
    return true;
  });
});

test('a JSON error without a message falls back to the old text', async () => {
  await assert.rejects(parseApiResponse(json({}, 400)), (error) => error.message === 'The API request failed.' && error.status === 400);
});

test('an HTML 502 becomes a friendly BAD_RESPONSE error, not a SyntaxError', async () => {
  await assert.rejects(parseApiResponse(html(502)), (error) => {
    assert.equal(error.name, 'Error');
    assert.equal(error.message, SERVER_TROUBLE);
    assert.equal(error.status, 502);
    assert.equal(error.code, 'BAD_RESPONSE');
    return true;
  });
});

test('a non-JSON 4xx gets the generic message', async () => {
  await assert.rejects(parseApiResponse(html(404)), (error) => error.message === GENERIC_FAILURE && error.code === 'BAD_RESPONSE' && error.status === 404);
});

test('an HTML body on a 200 is a bad response too', async () => {
  await assert.rejects(parseApiResponse(new Response('<html></html>', { status: 200 })), (error) => error.code === 'BAD_RESPONSE');
});

test('an empty 204 resolves with null', async () => {
  assert.equal(await parseApiResponse(new Response(null, { status: 204 })), null);
});
