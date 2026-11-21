import test from 'node:test';
import assert from 'node:assert/strict';
import { GAMES } from '../src/games/registry.js';
import { aggregate, difficultyRank, normalizeTrack, percentOf, recommendNext, sumTracks } from '../src/games/progress.js';
import { normalizeSubmit } from '../src/terminal/adapters.js';
import { celebrationFor } from '../src/pages/socialHelpers.js';

const track = (over) => normalizeTrack({ id: 'a', title: 'A', difficulty: 'easy', solved: 0, total: 4, pointsEarned: 0, maxPoints: 40, ...over });

test('registry entries are complete, unique and have absolute paths', () => {
  const ids = new Set();
  for (const game of GAMES) {
    assert.ok(game.id && game.title && game.pitch);
    assert.match(game.path, /^\/[a-z]+$/);
    assert.match(game.overview, /^\//);
    assert.equal(typeof game.summarize, 'function');
    assert.ok(!ids.has(game.id));
    ids.add(game.id);
  }
});

test('each summarize maps its overview shape and tolerates garbage', () => {
  const by = (id) => GAMES.find((game) => game.id === id);
  const terminal = by('terminal').summarize([{ mode: 'easy', title: 'Easy', difficulty: 'easy', codes: 5, solved: 2, points: 50, pointsEarned: 20 }]);
  assert.deepEqual(terminal.tracks[0], { id: 'easy', title: 'Easy', difficulty: 'easy', solved: 2, total: 5, pointsEarned: 20, maxPoints: 50 });
  const cipher = by('cipherlab').summarize({ tracks: [{ id: 'rookie', title: 'Rookie', difficulty: 'easy', total: 6, solved: 1, maxPoints: 60, pointsEarned: 10 }] });
  assert.equal(cipher.tracks[0].total, 6);
  const web = by('weblab').summarize({ tracks: [{ id: 't', title: 'T', difficulty: 'hard', total: 3, solved: 3, points: 90, pointsEarned: 90 }] });
  assert.equal(web.tracks[0].maxPoints, 90);
  const forensics = by('forensics').summarize([{ id: 'f', title: 'F', caseTitle: 'The Case', difficulty: 'medium', stages: 5, solved: 1, maxPoints: 50, pointsEarned: 10 }]);
  assert.equal(forensics.tracks[0].title, 'The Case');
  assert.equal(forensics.tracks[0].total, 5);
  for (const game of GAMES) {
    assert.deepEqual(game.summarize(null).tracks, []);
    assert.deepEqual(game.summarize('nope').tracks, []);
  }
});

test('normalizeTrack clamps solved to total and zeroes bad numbers', () => {
  assert.equal(track({ solved: 9, total: 4 }).solved, 4);
  assert.equal(track({ solved: 'x', total: undefined }).total, 0);
});

test('sumTracks and aggregate add up and skip failed games', () => {
  const a = [track({ solved: 2, total: 4, pointsEarned: 20, maxPoints: 40 }), track({ id: 'b', solved: 1, total: 4, pointsEarned: 10, maxPoints: 80 })];
  assert.deepEqual(sumTracks(a), { solved: 3, total: 8, pointsEarned: 30, maxPoints: 120, percent: 38 });
  const total = aggregate([{ id: 'x', tracks: a }, { id: 'y', error: 'boom' }, { id: 'z', tracks: [track({ solved: 4, total: 4, pointsEarned: 40, maxPoints: 40 })] }]);
  assert.equal(total.solved, 7);
  assert.equal(total.total, 12);
  assert.equal(total.games, 2);
  assert.equal(total.failed, 1);
  assert.deepEqual(aggregate([]), { solved: 0, total: 0, pointsEarned: 0, maxPoints: 0, percent: 0, games: 0, failed: 0 });
  assert.equal(percentOf(1, 0), 0);
});

test('recommendNext picks the first game with work left, easiest track first', () => {
  const done = track({ solved: 4, total: 4 });
  const results = [
    { id: 'one', tracks: [done] },
    { id: 'bad', error: 'x' },
    { id: 'two', tracks: [track({ id: 'h', difficulty: 'hard', solved: 0 }), track({ id: 'm', difficulty: 'medium', solved: 1 }), done] },
    { id: 'three', tracks: [track({ solved: 0 })] },
  ];
  assert.deepEqual(recommendNext(results), { id: 'two', track: results[2].tracks[1] });
  assert.equal(recommendNext([{ id: 'one', tracks: [done] }]), null);
  assert.equal(recommendNext([]), null);
  assert.ok(difficultyRank('easy') < difficultyRank('insane'));
  assert.ok(difficultyRank('weird') > difficultyRank('insane'));
});

test('normalizeSubmit keeps valid badges and drops junk', () => {
  const result = normalizeSubmit({ correct: true, pointsAwarded: 10, badges: [{ key: 'first-solve', name: 'First Solve' }, { key: 'x' }, null, 'str'] });
  assert.deepEqual(result.badges, [{ key: 'first-solve', name: 'First Solve' }]);
  assert.deepEqual(normalizeSubmit({ correct: false }).badges, []);
  assert.deepEqual(normalizeSubmit({ badges: 'no' }).badges, []);
});

test('a terminal submit with badges produces a celebration', () => {
  const result = normalizeSubmit({ correct: true, pointsAwarded: 10, badges: [{ key: 'first-solve', name: 'First Solve' }] });
  assert.deepEqual(celebrationFor(result), { title: 'Your first flag!', badges: ['First Solve'], confetti: true });
  assert.equal(celebrationFor(normalizeSubmit({ correct: true, pointsAwarded: 10 })), null);
});
