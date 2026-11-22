import test from 'node:test';
import assert from 'node:assert/strict';
import { replicaLabel } from '../src/layout/replica.js';
import { themeHint } from '../src/theme/theme.js';

test('the replica label names the replica or says none answered yet', () => {
  assert.equal(replicaLabel('replica-2'), 'Replica: replica-2');
  assert.equal(replicaLabel('  Swarup '), 'Replica: Swarup');
  assert.equal(replicaLabel(''), 'Replica: not contacted yet');
  assert.equal(replicaLabel(undefined), 'Replica: not contacted yet');
});

test('the theme hint is one short phrase', () => {
  assert.equal(themeHint('system', 'dark'), 'Auto: now dark.');
  assert.equal(themeHint('system', 'light'), 'Auto: now light.');
  assert.equal(themeHint('dark', 'dark'), 'Dark is set.');
  assert.equal(themeHint('light', 'light'), 'Light is set.');
  assert.equal(themeHint('bogus', 'light'), 'Auto: now light.');
});

test('the compact admin date drops the UTC suffix and keeps the dash for missing dates', async () => {
  const { formatDateCompact } = await import('../src/admin/format.js');
  assert.equal(formatDateCompact('2026-11-22T10:00:30.000Z'), '2026-11-22 10:00');
  assert.equal(formatDateCompact(null), '–');
});
