// Pure helpers of the Forensics Desk pages: timer badges, labels, error messages and progress maths.
export const DIFFICULTY_LABEL = { easy: 'Easy', medium: 'Medium', hard: 'Hard', insane: 'Insane' };
export const DIFFICULTY_LEVEL = { easy: 1, medium: 2, hard: 3, insane: 4 };

// Cosmetic only: the clock runs in this browser (localStorage) and never reaches the server or the score.
export const TIMER_PREFIX = 'forensics-timer:';

export function formatElapsed(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

// Par times in minutes per track; the badge is a playful rank for a completed case.
const PAR = { easy: 15, medium: 30, hard: 60, insane: 120 };
export function timerBadge(trackId, elapsedMs) {
  const par = (PAR[trackId] ?? 60) * 60_000;
  if (elapsedMs <= par * 0.5) { return { id: 'ace', label: 'Ace detective', note: 'Lightning fast.' }; }
  if (elapsedMs <= par) { return { id: 'sharp', label: 'Sharp eye', note: 'Right on the clock.' }; }
  if (elapsedMs <= par * 2) { return { id: 'steady', label: 'Steady sleuth', note: 'Thorough and patient.' }; }
  return { id: 'cold-case', label: 'Cold-case closer', note: 'Slow and unstoppable.' };
}

export function readStart(storage, trackId, now = Date.now()) {
  try {
    const value = Number(storage?.getItem(`${TIMER_PREFIX}${trackId}`));
    if (Number.isFinite(value) && value > 0 && value <= now) { return value; }
  } catch { /* storage may be blocked */ }
  return null;
}

export function writeStart(storage, trackId, now = Date.now()) {
  try { storage?.setItem(`${TIMER_PREFIX}${trackId}`, String(now)); } catch { /* ignore */ }
  return now;
}

export function clearStart(storage, trackId) {
  try { storage?.removeItem(`${TIMER_PREFIX}${trackId}`); } catch { /* ignore */ }
}

export function progressPercent(solved, total) {
  return total > 0 ? Math.round((Math.min(solved, total) / total) * 100) : 0;
}

export function nextOpenStage(stages) {
  return stages.find((stage) => !stage.solved && !stage.locked)?.n ?? null;
}

export function describeForensicsError(error) {
  const code = error?.code;
  if (code === 'NO_TEAM') { return 'Join or create a team first: cases are scored per team.'; }
  if (code === 'TEAM_BANNED') { return 'Your team has been banned from the arena.'; }
  if (code === 'FORENSICS_NOT_SEEDED') { return 'The Forensics Desk is not set up yet. Ask an admin to run npm run seed:forensics.'; }
  if (code === 'STAGE_LOCKED') { return 'Confirm the evidence from the other stages before naming the culprit.'; }
  if (code === 'RATE_LIMITED' || error?.status === 429) { return 'Too many attempts on this stage. Take a break and think it over.'; }
  if (error?.status === 403) { return error.message || 'That action is not allowed here.'; }
  return error?.message || 'Something went wrong. Try again.';
}

// Groups the evidence cards for the board: the confirmed value per solved stage, in stage order.
export function evidenceCards(evidence, stages) {
  const byStage = new Map(evidence.map((item) => [item.n, item]));
  return stages.filter((stage) => !stage.whodunit).map((stage) => ({
    n: stage.n, title: stage.title, value: byStage.get(stage.n)?.value ?? null, confirmed: byStage.has(stage.n),
  }));
}
