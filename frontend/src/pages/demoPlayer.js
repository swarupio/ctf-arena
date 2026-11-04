// Pure playback helpers for the Demo playoff page (no React, no DOM, so they run under node --test).
// "index" is the step being shown: -1 means "before the first step", TOTAL - 1 is the last step.
// Every step plays as numbered HOPS (one request hop at a time). "hop" is the 0-based hop inside the step, and a
// playback position is the pair { index, hop }.

export const SPEEDS = Object.freeze([0.5, 1, 2, 4]);
export const MIN_STEP_DELAY_MS = 400;
export const INTRO_DELAY_MS = 1200;
export const FALLBACK_STEP_MS = 4000;
export const MIN_HOP_MS = 1500;
export const HOP_DWELL = 0.6;

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

function asSteps(steps) {
  return Array.isArray(steps) ? steps : [];
}

function validEdge(edge) {
  return Array.isArray(edge) && edge.length >= 2 && typeof edge[0] === 'string' && typeof edge[1] === 'string'
    ? [edge[0], edge[1]]
    : null;
}

function realHops(step) {
  return Array.isArray(step?.hops) ? step.hops.filter((hop) => hop && typeof hop === 'object') : [];
}

// True when the step carries its own hops (so the page can tell real hops from the synthesized fallback).
export function hasHops(step) {
  return realHops(step).length > 0;
}

// The hops of a step as { edge, title, text, lines }, never an empty list: a step without hops becomes one
// hop that shows the whole narration and every log line, so the page keeps working on older script data.
export function hopsOf(step) {
  const own = realHops(step);
  if (own.length) {
    return own.map((hop) => ({
      ...hop,
      edge: validEdge(hop.edge),
      title: String(hop.title ?? 'Step'),
      text: String(hop.text ?? ''),
      lines: Array.isArray(hop.lines) ? hop.lines.filter((line) => Number.isInteger(line) && line >= 0) : [],
    }));
  }
  const logCount = Array.isArray(step?.log) ? step.log.length : 0;
  return [{
    edge: null,
    title: 'Step',
    text: String(step?.narration ?? ''),
    lines: Array.from({ length: logCount }, (_, i) => i),
  }];
}

// Keeps a hop number inside [0, count - 1]. Anything that is not a number (or an empty step) becomes hop 0.
export function clampHop(hop, count) {
  const value = Number(hop);
  const last = safeTotal(count) - 1;
  if (Number.isNaN(value) || last < 0) return 0;
  return Math.min(Math.max(Math.trunc(value), 0), last);
}

// "Hop 2 of 4" label for the control bar.
export function hopCounter(hop, count) {
  const total = Math.max(safeTotal(count), 1);
  return `Hop ${clampHop(hop, total) + 1} of ${total}`;
}

// How long one hop stays on screen: the step's time split over its hops, at least 1.5s at normal speed
// (that is what makes the request readable), then scaled by speed and never under 400ms.
export function hopDelay(step, speed) {
  const count = hopsOf(step).length;
  const duration = Number.isFinite(step?.duration) && step.duration > 0 ? step.duration : FALLBACK_STEP_MS;
  return Math.max(MIN_STEP_DELAY_MS, Math.round(Math.max(MIN_HOP_MS, duration / count) / clampSpeed(speed)));
}

// Delay before leaving the position { index, hop }: the intro pause before the first step, otherwise the hop
// delay. The last hop of a step gets an extra dwell (0.6x) so its result can be read before the next step.
export function playbackDelay(steps, pos, speed) {
  const list = asSteps(steps);
  const index = clampIndex(pos?.index, list.length);
  if (index < 0) return stepDelay(INTRO_DELAY_MS, speed);
  const step = list[index];
  const count = hopsOf(step).length;
  const delay = hopDelay(step, speed);
  return clampHop(pos?.hop, count) >= count - 1 ? Math.round(delay * (1 + HOP_DWELL)) : delay;
}

// The position after { index, hop }: next hop in the step, else hop 0 of the next step, else null at the very
// end. From "before start" (index -1) it is the first hop of the first step; an empty script has no positions.
export function advance(pos, steps) {
  const list = asSteps(steps);
  if (!list.length) return null;
  const index = clampIndex(pos?.index, list.length);
  if (index < 0) return { index: 0, hop: 0 };
  const count = hopsOf(list[index]).length;
  const hop = clampHop(pos?.hop, count);
  if (hop < count - 1) return { index, hop: hop + 1 };
  if (index < list.length - 1) return { index: index + 1, hop: 0 };
  return null;
}

// The position before { index, hop }: previous hop, else the last hop of the previous step, else null at the
// first hop of the first step (and before start).
export function retreat(pos, steps) {
  const list = asSteps(steps);
  if (!list.length) return null;
  const index = clampIndex(pos?.index, list.length);
  if (index < 0) return null;
  const hop = clampHop(pos?.hop, hopsOf(list[index]).length);
  if (hop > 0) return { index, hop: hop - 1 };
  if (index > 0) return { index: index - 1, hop: hopsOf(list[index - 1]).length - 1 };
  return null;
}

// True on the last hop of the last step: nothing is left to play.
export function isAtEnd(pos, steps) {
  const list = asSteps(steps);
  const index = clampIndex(pos?.index, list.length);
  if (index < 0 || index !== list.length - 1) return false;
  const count = hopsOf(list[index]).length;
  return clampHop(pos?.hop, count) >= count - 1;
}

// The replica to mark "answering" at this hop: only from the hop where the request first touches it, so the badge
// does not spoil the load balancer hop. If no hop names that replica, it shows for the whole step.
export function servedByAt(step, hops, hop) {
  const served = step?.servedBy;
  if (!served) return null;
  const list = Array.isArray(hops) ? hops : hopsOf(step);
  const first = list.findIndex((item) => Array.isArray(item?.edge) && item.edge.includes(served));
  return first <= clampHop(hop, list.length) ? served : null;
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

// Maps a keydown event to a player action: 'next' | 'prev' (by step), 'nextHop' | 'prevHop' (by hop, keys "." and
// ","), 'toggle' | 'restart' | null.
// Typing controls are never hijacked. Space is left alone on buttons and links (it activates them natively);
// the arrow keys, the hop keys and "r" keep working there so the shortcuts survive after clicking a control.
export function keyAction(event) {
  if (!event || event.ctrlKey || event.metaKey || event.altKey) return null;
  const target = event.target ?? {};
  const tag = String(target.tagName ?? '').toUpperCase();
  if (TEXT_ENTRY_TAGS.has(tag) || target.isContentEditable) return null;
  switch (event.key) {
    case 'ArrowRight': return 'next';
    case 'ArrowLeft': return 'prev';
    case '.':
    case '>': return 'nextHop';
    case ',':
    case '<': return 'prevHop';
    case 'r':
    case 'R': return event.repeat ? null : 'restart';
    case ' ':
    case 'Spacebar': return ACTIVATABLE_TAGS.has(tag) || event.repeat ? null : 'toggle';
    default: return null;
  }
}
