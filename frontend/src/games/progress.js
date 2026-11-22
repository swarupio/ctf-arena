// Pure maths for The Range hub. Every category's overview is reduced to the same shape by its registry `summarize`:
// { tracks: [{ id, title, difficulty, solved, total, pointsEarned, maxPoints }] }.

const DIFFICULTY_ORDER = ['easy', 'medium', 'hard', 'insane', 'expert'];

export const difficultyRank = (difficulty) => {
  const index = DIFFICULTY_ORDER.indexOf(String(difficulty ?? '').toLowerCase());
  return index === -1 ? DIFFICULTY_ORDER.length : index;
};

const num = (value) => (Number.isFinite(Number(value)) && value !== null && value !== '' ? Math.max(0, Number(value)) : 0);
const list = (value) => (Array.isArray(value) ? value : []);

export const percentOf = (part, whole) => (whole > 0 ? Math.min(100, Math.round((part / whole) * 100)) : 0);

/** Normalise one track so solved never exceeds total and missing numbers are 0. */
export function normalizeTrack(track, index = 0) {
  const total = num(track?.total);
  return {
    id: String(track?.id ?? track?.mode ?? index),
    title: typeof track?.title === 'string' && track.title !== '' ? track.title : String(track?.id ?? `Track ${index + 1}`),
    difficulty: typeof track?.difficulty === 'string' ? track.difficulty : '',
    solved: Math.min(num(track?.solved), total),
    total,
    pointsEarned: num(track?.pointsEarned),
    maxPoints: num(track?.maxPoints),
  };
}

/** Sum a list of tracks; percent is the share of levels solved (0 when there are none). */
export function sumTracks(tracks) {
  const totals = list(tracks).reduce((sum, track) => ({
    solved: sum.solved + track.solved,
    total: sum.total + track.total,
    pointsEarned: sum.pointsEarned + track.pointsEarned,
    maxPoints: sum.maxPoints + track.maxPoints,
  }), { solved: 0, total: 0, pointsEarned: 0, maxPoints: 0 });
  return { ...totals, percent: percentOf(totals.solved, totals.total) };
}

/**
 * Combine the per-category results ({ id, tracks } or { id, error }) into the arena header numbers.
 * Failed categories are skipped (and counted) so one broken endpoint never zeroes the rest.
 */
export function aggregate(results) {
  const ok = list(results).filter((item) => item && !item.error && Array.isArray(item.tracks));
  return {
    ...sumTracks(ok.flatMap((item) => item.tracks)),
    games: ok.length,
    failed: list(results).filter((item) => item?.error).length,
  };
}

/** First category (registry order) with unsolved levels; inside it the easiest unsolved track. null when nothing is left. */
export function recommendNext(results) {
  for (const item of list(results)) {
    if (!item || item.error || !Array.isArray(item.tracks)) continue;
    const open = item.tracks.filter((track) => track.total > 0 && track.solved < track.total);
    if (open.length === 0) continue;
    const track = [...open].sort((a, b) => difficultyRank(a.difficulty) - difficultyRank(b.difficulty))[0];
    return { id: item.id, track };
  }
  return null;
}
