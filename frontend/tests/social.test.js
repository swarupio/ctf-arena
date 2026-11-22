import test from 'node:test';
import assert from 'node:assert/strict';
import {
  announce, celebrationFor, confettiPieces, describeEvent, eventTag, prefersReducedMotion, shareText,
  socialErrorMessage, sortBadges, streakLabel, timeAgo, unlockedBadges, visibleEvents, CELEBRATE_EVENT,
} from '../src/pages/socialHelpers.js';

test('events read as short sentences and unknown events are dropped', () => {
  assert.equal(describeEvent({ type: 'solve', team: 'Zion', challenge: 'Warmup' }), 'Zion solved Warmup');
  assert.equal(describeEvent({ type: 'first_blood', team: 'Zion', challenge: 'Warmup' }), 'Zion took first blood on Warmup');
  assert.equal(describeEvent({ type: 'badge', team: 'Zion', badge: 'Hat Trick' }), 'Zion earned the Hat Trick badge');
  assert.equal(describeEvent({ type: 'team', team: 'Zion' }), 'Team Zion joined the arena');
  assert.equal(describeEvent({ type: 'other' }), '');
  assert.equal(eventTag({ type: 'badge' }), 'BADGE');
  const list = visibleEvents([{ type: 'x' }, { type: 'team', team: 'A' }, { type: 'team', team: 'B' }], 1);
  assert.deepEqual(list.map((event) => event.team), ['A']);
  assert.deepEqual(visibleEvents(null), []);
});

test('timeAgo buckets', () => {
  const now = Date.UTC(2026, 10, 3, 12, 0, 0);
  const ago = (seconds) => new Date(now - seconds * 1000).toISOString();
  assert.equal(timeAgo(ago(5), now), 'just now');
  assert.equal(timeAgo(ago(120), now), '2 min ago');
  assert.equal(timeAgo(ago(7200), now), '2 h ago');
  assert.equal(timeAgo(ago(3 * 86_400), now), '3 days ago');
  assert.equal(timeAgo(ago(86_400), now), '1 day ago');
  assert.equal(timeAgo(new Date(now + 5000).toISOString(), now), 'just now');
});

test('celebrations only for first blood, a first flag or a new badge', () => {
  assert.equal(celebrationFor(null), null);
  assert.equal(celebrationFor({ correct: false, firstBlood: true }), null);
  assert.equal(celebrationFor({ correct: true, alreadySolved: true, firstBlood: true }), null);
  assert.equal(celebrationFor({ correct: true, firstBlood: false }), null);
  assert.equal(celebrationFor({ correct: true, firstBlood: true }).title, 'First blood!');
  const first = celebrationFor({ correct: true, badges: [{ key: 'first-solve', name: 'First Flag' }] });
  assert.equal(first.title, 'Your first flag!');
  assert.deepEqual(first.badges, ['First Flag']);
  assert.equal(celebrationFor({ correct: true, badges: [{ key: 'solves-3', name: 'Hat Trick' }] }).title, 'New badge!');
  assert.equal(celebrationFor({ correct: true, badges: [{ key: 'a', name: 'A' }, { key: 'b', name: 'B' }] }).title, '2 new badges!');
});

test('announce dispatches a window event only when there is something to celebrate', () => {
  const seen = [];
  const target = { dispatchEvent: (event) => seen.push(event) };
  assert.equal(announce({ correct: true }, target), null);
  assert.equal(seen.length, 0);
  announce({ correct: true, firstBlood: true }, target);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].type, CELEBRATE_EVENT);
  assert.equal(seen[0].detail.title, 'First blood!');
});

test('reduced motion is read from the media query and defaults to false', () => {
  assert.equal(prefersReducedMotion(undefined), false);
  assert.equal(prefersReducedMotion({}), false);
  assert.equal(prefersReducedMotion({ matchMedia: () => ({ matches: true }) }), true);
  assert.equal(prefersReducedMotion({ matchMedia: () => ({ matches: false }) }), false);
});

test('confetti layout is deterministic and bounded', () => {
  const a = confettiPieces(40);
  assert.deepEqual(a, confettiPieces(40));
  assert.equal(a.length, 40);
  assert.ok(a.every((piece) => piece.x >= 0 && piece.x < 100 && piece.duration > 0));
});

test('streak label and badge ordering', () => {
  assert.match(streakLabel({ current: 0, best: 4 }), /No streak/);
  assert.equal(streakLabel({ current: 3, best: 3 }), '3-day streak (your best)');
  assert.equal(streakLabel({ current: 2, best: 5 }), '2-day streak');
  assert.match(streakLabel(undefined), /No streak/);
  const badges = [
    { key: 'a', unlocked: false }, { key: 'b', unlocked: true, awardedAt: '2026-11-01T00:00:00Z' },
    { key: 'c', unlocked: true, awardedAt: '2026-11-02T00:00:00Z' }, { key: 'd', unlocked: false },
  ];
  assert.deepEqual(sortBadges(badges).map((badge) => badge.key), ['c', 'b', 'a', 'd']);
  assert.equal(unlockedBadges(badges).length, 2);
  assert.deepEqual(sortBadges(undefined), []);
});

test('share text carries only public fields', () => {
  const text = shareText({
    displayName: 'neo', solves: 1, team: { name: 'Zion' }, streak: { current: 2, best: 2 },
    badges: [{ unlocked: true }, { unlocked: false }],
  });
  assert.equal(text, 'neo on CTF Arena | 1 solve | 1/2 badges | 2-day streak | team Zion');
  assert.equal(shareText(null), 'A player on CTF Arena | 0 solves | 0/0 badges');
});

test('error messages are friendly', () => {
  assert.match(socialErrorMessage({ status: 404 }), /not found/);
  assert.match(socialErrorMessage({ status: 401 }), /log in/);
  assert.match(socialErrorMessage(new Error('x')), /Something went wrong/);
});
