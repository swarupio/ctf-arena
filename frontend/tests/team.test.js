import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeInviteCode, validInviteCode, validTeamName, teamErrorMessage } from '../src/pages/teamHelpers.js';
import { fetchTeamState } from '../src/api/teams.js';

test('invite codes are trimmed and uppercased without silently changing characters', () => {
  assert.equal(normalizeInviteCode('  ab2c3d  '), 'AB2C3D');
  assert.equal(normalizeInviteCode(''), '');
  assert.equal(normalizeInviteCode('ab cd!'), 'AB CD!');
  assert.equal(validInviteCode('ab2c3d'), true);
  for (const code of ['ABC', 'ABCDEFG', 'ABCIO1', 'ABC0DE', 'AB CD!']) assert.equal(validInviteCode(code), false);
});

test('team names validate their trimmed length at both boundaries', () => {
  for (const name of ['  abc  ', 'a'.repeat(24)]) assert.equal(validTeamName(name), true);
  for (const name of ['   ', 'ab', 'a'.repeat(25)]) assert.equal(validTeamName(name), false);
});

test('all documented team errors have friendly messages; unknown errors retain the server message', () => {
  assert.match(teamErrorMessage({ code: 'CONFLICT' }, 'create'), /name is taken/);
  assert.match(teamErrorMessage({ code: 'CONFLICT' }, 'join'), /already belong/);
  assert.match(teamErrorMessage({ code: 'TEAM_FULL' }), /3 members/);
  assert.match(teamErrorMessage({ code: 'NOT_FOUND' }), /invite code/);
  assert.match(teamErrorMessage({ code: 'VALIDATION_ERROR' }), /3–24/);
  assert.match(teamErrorMessage({ code: 'NO_TEAM' }), /not in a team/);
  assert.equal(teamErrorMessage({ code: 'SERVER_ERROR', message: 'Please try later.' }), 'Please try later.');
  assert.match(teamErrorMessage(null), /try again/);
});

test('team refresh reads the documented team and identity endpoints', async () => {
  const team = { id: 'team-a', name: 'Packet Pilots' };
  const profile = { displayName: 'Mira', team };
  const paths = [];
  const snapshot = await fetchTeamState(async (path) => { paths.push(path); return path === '/me' ? profile : team; });
  assert.deepEqual(paths, ['/teams/me', '/me']);
  assert.deepEqual(snapshot, { team, profile });
});

test('NO_TEAM or an explicit null membership produces the create/join state', async () => {
  for (const [code, membership] of [['NO_TEAM', { id: 'old-team' }], ['SERVER_ERROR', null]]) {
    const snapshot = await fetchTeamState(async (path) => {
      if (path === '/me') return { displayName: 'Mira', team: membership };
      throw Object.assign(new Error('Team unavailable'), { code });
    });
    assert.equal(snapshot.team, null);
    assert.equal(snapshot.profile.team, null);
  }
});

test('a failed refresh does not pretend an existing team is absent', async () => {
  const failure = Object.assign(new Error('Try later'), { code: 'SERVER_ERROR' });
  await assert.rejects(fetchTeamState(async (path) => {
    if (path === '/me') return { team: { id: 'team-a' } };
    throw failure;
  }), (error) => error === failure);
  await assert.rejects(fetchTeamState(async (path) => {
    if (path === '/me') throw failure;
    return { id: 'team-a' };
  }), (error) => error === failure);
});

test('an explicit null profile membership takes precedence over a stale team response', async () => {
  const state = await fetchTeamState(async (path) => path === '/me'
    ? { displayName: 'Mira', team: null }
    : { id: 'old-team', name: 'Old team' });
  assert.equal(state.team, null);
  assert.equal(state.profile.team, null);
});
