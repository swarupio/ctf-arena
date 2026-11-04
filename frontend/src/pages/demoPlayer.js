// Pure playback helpers for the Demo playoff page (no React, no DOM, so they run under node --test).
// "index" is the step being shown: -1 means "before the first step", TOTAL - 1 is the last step.

export const SPEEDS = Object.freeze([0.5, 1, 2, 4]);
export const MIN_STEP_DELAY_MS = 400;
export const INTRO_DELAY_MS = 1200;
export const FALLBACK_STEP_MS = 4000;

const MIN_SPEED = SPEEDS[0];
const MAX_SPEED = SPEEDS[SPEEDS.length - 1];

function safeTotal(total) {
  const value = Number(total);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

// Keeps an index inside [-1, total - 1]. Anything that is not a number becomes -1 (before start).
export function clampIndex(index, total) {
  const value = Number(index);
  if (Number.isNaN(value)) return -1;
  return Math.min(Math.max(Math.trunc(value), -1), safeTotal(total) - 1);
}

export function nextIndex(index, total) {
  return clampIndex(clampIndex(index, total) + 1, total);
}

// Never goes below -1 (the "before start" state). The page disables Back on step 1 on its own.
export function prevIndex(index) {
  const value = Number(index);
  if (Number.isNaN(value)) return -1;
  return Math.max(Math.trunc(value) - 1, -1);
}

export function isFinished(index, total) {
  const count = safeTotal(total);
  return count > 0 && clampIndex(index, count) >= count - 1;
}

// Any speed is forced into the supported 0.5x..4x range; garbage means normal speed.
export function clampSpeed(speed) {
  const value = Number(speed);
  if (!Number.isFinite(value) || value <= 0) return 1;
  return Math.min(Math.max(value, MIN_SPEED), MAX_SPEED);
}

// How long to stay on a step before autoplay moves on. Faster speed means a shorter wait, never under 400ms.
export function stepDelay(durationMs, speed) {
  const duration = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : FALLBACK_STEP_MS;
  return Math.max(MIN_STEP_DELAY_MS, Math.round(duration / clampSpeed(speed)));
}

// Delay before leaving `index`: the intro pause for -1, otherwise the step's own duration.
export function autoplayDelay(steps, index, speed) {
  if (!(index >= 0)) return stepDelay(INTRO_DELAY_MS, speed);
  return stepDelay(steps?.[index]?.duration, speed);
}

// Contiguous groups of steps that share a phase, with inclusive start/end indexes, for the progress bar.
export function phaseRanges(steps) {
  const ranges = [];
  (Array.isArray(steps) ? steps : []).forEach((step, index) => {
    const phase = step?.phase ?? '';
    const last = ranges[ranges.length - 1];
    if (last && last.phase === phase) last.end = index;
    else ranges.push({ phase, start: index, end: index });
  });
  return ranges;
}

// Share of the demo that has been shown (step 1 of 20 is 5%, the last step is 100%, before start is 0%).
export function progressPercent(index, total) {
  const count = safeTotal(total);
  if (!count) return 0;
  const current = clampIndex(index, count);
  if (current < 0) return 0;
  return Math.round(((current + 1) / count) * 10000) / 100;
}

export function stepCounter(index, total) {
  const count = safeTotal(total);
  return `Step ${Math.max(clampIndex(index, count) + 1, 0)} of ${count}`;
}

// Game clock label such as "T+12:00". Accepts minutes as a number (12.5 is 12:30) or an "mm:ss" string.
export function formatClock(minute) {
  if (typeof minute === 'string') {
    const match = /^(\d+):(\d{2})$/.exec(minute.trim());
    if (match) return `T+${match[1].padStart(2, '0')}:${match[2]}`;
  }
  const minutes = Number(minute);
  const seconds = Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes * 60) : 0;
  const pad = (value) => String(value).padStart(2, '0');
  return `T+${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`;
}

const TEXT_ENTRY_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
const ACTIVATABLE_TAGS = new Set(['BUTTON', 'A', 'SUMMARY']);

// Maps a keydown event to a player action: 'next' | 'prev' | 'toggle' | 'restart' | null.
// Typing controls are never hijacked. Space is left alone on buttons and links (it activates them natively);
// the arrow keys and "r" keep working there so the shortcuts survive after clicking a control.
export function keyAction(event) {
  if (!event || event.ctrlKey || event.metaKey || event.altKey) return null;
  const target = event.target ?? {};
  const tag = String(target.tagName ?? '').toUpperCase();
  if (TEXT_ENTRY_TAGS.has(tag) || target.isContentEditable) return null;
  switch (event.key) {
    case 'ArrowRight': return 'next';
    case 'ArrowLeft': return 'prev';
    case 'r':
    case 'R': return event.repeat ? null : 'restart';
    case ' ':
    case 'Spacebar': return ACTIVATABLE_TAGS.has(tag) || event.repeat ? null : 'toggle';
    default: return null;
  }
}
