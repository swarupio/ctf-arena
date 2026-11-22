import test from 'node:test';
import assert from 'node:assert/strict';
import { challengePanels, gateFromError } from '../src/pages/challengeHelpers.js';

const docker = { role: 'player', type: 'docker', dockerAvailable: true, hasTeam: true, banned: false };
const stat = { ...docker, type: 'static' };

test('admin gets one preview card and no instance or submit panel, for docker and static', () => {
  for (const type of ['docker', 'static']) {
    assert.deepEqual(challengePanels({ ...docker, role: 'admin', type }), { gate: 'admin-preview', instance: null, submit: 'hidden' });
  }
  assert.equal(challengePanels({ ...docker, role: 'admin', dockerAvailable: false }).gate, 'admin-preview');
});

test('banned beats no team, a missing team gets the join card', () => {
  assert.equal(challengePanels({ ...docker, banned: true, hasTeam: false }).gate, 'banned');
  assert.equal(challengePanels({ ...docker, hasTeam: false }).gate, 'no-team');
  assert.equal(challengePanels({ ...stat, hasTeam: false }).gate, 'no-team');
});

test('a banned team gets the ban card from /me, before any server refusal', () => {
  const panels = challengePanels({ ...docker, teamBanned: true });
  assert.deepEqual(panels, { gate: 'banned', instance: null, submit: 'hidden' });
  assert.equal(challengePanels({ ...stat, teamBanned: true }).gate, 'banned');
  assert.equal(challengePanels({ ...docker, teamBanned: true, hasTeam: false }).gate, 'banned');
  assert.equal(challengePanels({ ...docker, role: 'admin', teamBanned: true }).gate, 'admin-preview');
  assert.equal(challengePanels({ ...docker, teamBanned: false }).gate, null);
  assert.equal(challengePanels({ ...docker, teamBanned: undefined }).gate, null);
});

test('unknown team state (profile still loading) shows the normal player panels', () => {
  const panels = challengePanels({ role: 'player', type: 'docker', dockerAvailable: true });
  assert.deepEqual(panels, { gate: null, instance: 'ready', submit: 'form' });
});

test('player on a docker challenge: ready, running, no-docker', () => {
  assert.deepEqual(challengePanels(docker), { gate: null, instance: 'ready', submit: 'form' });
  assert.deepEqual(challengePanels({ ...docker, hasInstance: true }), { gate: null, instance: 'running', submit: 'form' });
  assert.deepEqual(challengePanels({ ...docker, dockerAvailable: false }), { gate: null, instance: 'no-docker', submit: 'hidden' });
  // dockerAvailable missing (older API) counts as available
  assert.equal(challengePanels({ ...docker, dockerAvailable: undefined }).instance, 'ready');
});

test('static challenge has no instance panel', () => {
  assert.deepEqual(challengePanels(stat), { gate: null, instance: null, submit: 'form' });
  assert.equal(challengePanels({ ...stat, dockerAvailable: false }).instance, null);
});

test('captured: no start button and no submit box, but a running instance can still be stopped', () => {
  assert.deepEqual(challengePanels({ ...docker, solved: true }), { gate: null, instance: null, submit: 'hidden' });
  assert.deepEqual(challengePanels({ ...docker, solved: true, hasInstance: true }), { gate: null, instance: 'running', submit: 'hidden' });
  assert.deepEqual(challengePanels({ ...stat, solved: true }), { gate: null, instance: null, submit: 'hidden' });
});

test('event closed replaces Submit only; frozen and live keep it; instances stay available', () => {
  assert.deepEqual(challengePanels({ ...docker, eventPhase: 'upcoming' }), { gate: null, instance: 'ready', submit: 'event-not-started' });
  assert.deepEqual(challengePanels({ ...stat, eventPhase: 'ended' }), { gate: null, instance: null, submit: 'event-ended' });
  for (const eventPhase of ['live', 'frozen', 'none']) assert.equal(challengePanels({ ...stat, eventPhase }).submit, 'form');
  // no Docker wins over the event note: the instance panel already says the challenge cannot be played here
  assert.equal(challengePanels({ ...docker, dockerAvailable: false, eventPhase: 'ended' }).submit, 'hidden');
});

test('gates can also come from the server refusal code', () => {
  assert.equal(gateFromError({ code: 'NO_TEAM' }), 'no-team');
  assert.equal(gateFromError({ code: 'TEAM_BANNED' }), 'banned');
  assert.equal(gateFromError({ code: 'RATE_LIMITED' }), null);
  assert.equal(gateFromError(null), null);
});
