// Small pure helpers for the terminal views: timer text, difficulty pips, HUD code rows and the boot typing.

/** 75000 -> "1:15", 3725000 -> "1:02:05". Never negative. */
export function formatElapsed(ms) {
  const total = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}

const LEVELS = { easy: 1, medium: 2, hard: 3 };
/** Filled pips out of three. Unknown difficulties count as one. */
export const difficultyLevel = (difficulty) => LEVELS[String(difficulty).toLowerCase()] ?? 1;

/** Sum of the points of solved codes. */
export const sumPoints = (solved) => (Array.isArray(solved) ? solved : []).reduce((sum, item) => sum + (Number(item.points) || 0), 0);

/**
 * Rows for the HUD code list: [{ n, solved, title, points, firstBlood }]. Unsolved codes show "???" and a points
 * estimate (the server only reports points of solved codes): from the remaining list when it has them, otherwise the
 * mode's base points shared evenly over its codes.
 */
export function buildCodeRows(progress, info) {
  const solvedItems = progress?.solved ?? [];
  const total = Math.max(progress?.total ?? info?.codes ?? 0, ...solvedItems.map((item) => item.n), 0);
  const byNumber = new Map(solvedItems.map((item) => [item.n, item]));
  const remainingCount = Math.max(0, total - byNumber.size);
  const modePoints = Number(info?.points);
  // Earned points include first-blood bonuses, so dividing what is left would under-count. Every mode's codes are worth
  // the same base value, so the base total shared over all codes is the right estimate.
  const even = remainingCount > 0 && total > 0 && Number.isFinite(modePoints) && modePoints > 0
    ? Math.round(modePoints / total) : null;
  const hinted = new Map((progress?.remainingItems ?? []).map((item) => [item.n, item.points]));

  return Array.from({ length: total }, (_, index) => {
    const n = index + 1;
    const done = byNumber.get(n);
    if (done) return { n, solved: true, title: done.title, points: done.points, firstBlood: done.firstBlood };
    return { n, solved: false, title: '???', points: hinted.get(n) ?? even, firstBlood: false };
  });
}

/** Earned and total points for the HUD. */
export function pointsSummary(progress, info) {
  const solvedItems = progress?.solved ?? [];
  const earned = progress ? sumPoints(solvedItems) : Number(info?.pointsEarned) || 0;
  return { earned, total: Number(info?.points) || 0 };
}

/**
 * Typing effect for the boot text: the lines revealed after `count` characters (each line costs its length + 1 for
 * the newline). The last returned line may be partial.
 */
export function revealLines(lines, count) {
  const shown = [];
  let left = count;
  for (const line of lines) {
    if (left <= 0) break;
    if (left >= line.length + 1) {
      shown.push(line);
      left -= line.length + 1;
    } else {
      shown.push(line.slice(0, left));
      left = 0;
    }
  }
  return shown;
}

export const bootLength = (lines) => lines.reduce((sum, line) => sum + line.length + 1, 0);

/** The text typed on boot: the mode's lore, then the closing hint. */
export function bootLines(lore) {
  const lines = Array.isArray(lore) ? lore : [];
  return [...lines, ...(lines.length > 0 ? [''] : []), 'Type help to begin.'];
}
