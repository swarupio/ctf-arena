// Pure helpers for the admin "Fair play" panel (no React, no auth stack) so they can be unit tested.
export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 100;
export const INTEGRITY_REFRESH_MS = 30_000;

// ASSUMPTIONS about the backend payload (adjust here if the API contract differs):
//  - risk is a number on a 0..RISK_MAX scale, shown as RISK_PIPS pips;
//  - severity is 'low' | 'medium' | 'high' (or a number: 1 low, 2 medium, 3 and above high).
export const RISK_MAX = 100;
export const RISK_PIPS = 5;

// The backend names the entry that aggregates callers who were not signed in like this.
export const ANONYMOUS_NAME = 'anonymous scrapers';

export const EVIDENCE_NOTE = 'A signal is evidence to review, not proof.';

export function clampLimit(limit) {
  const value = Math.floor(Number(limit));
  if (!Number.isFinite(value) || value < 1) return DEFAULT_LIMIT;
  return Math.min(value, MAX_LIMIT);
}

// Endpoint paths (relative to /api).
export const INTEGRITY_PATHS = {
  list: (limit = DEFAULT_LIMIT) => `/admin/integrity?limit=${clampLimit(limit)}`,
  dismiss: (userId) => `/admin/integrity/${encodeURIComponent(userId)}`,
};

export const SIGNAL_KINDS = {
  'honeypot-endpoint': {
    label: 'Opened a debug endpoint',
    help: 'Requested a decoy "forgotten" debug endpoint that no page of the site ever calls. '
      + 'Somebody found it by digging through the page source or network traffic, or a tool sent them there.',
  },
  'tainted-flag': {
    label: 'Submitted a leaked decoy flag',
    help: 'Submitted a decoy flag that was only planted where a scraper or a tool reading hidden data would find it. '
      + 'Honest play never produces it.',
  },
  'terminal-canary': {
    label: 'Followed an AI-bait instruction',
    help: 'Did what a hidden instruction planted in the terminal game output asked for. '
      + 'A person reading the screen would not see it; an AI fed the raw text would.',
  },
  'terminal-velocity': {
    label: 'Inhuman command rate',
    help: 'Sent terminal commands faster than a person can type and read the replies.',
  },
  'terminal-cadence': {
    label: 'Machine-regular timing',
    help: 'Commands arrived at suspiciously even intervals, a pattern typical of scripts and not of people.',
  },
  'automation-ua': {
    label: 'Scripted HTTP client',
    help: 'Requests came from a scripted client (curl, python-requests, node-fetch and similar) rather than a browser.',
  },
};

const knownKind = (kind) => typeof kind === 'string' && Object.hasOwn(SIGNAL_KINDS, kind);

// 'some-new-kind' -> 'Some new kind' so a signal type added on the backend still reads sensibly.
function humanizeKind(kind) {
  const text = String(kind ?? '').replace(/[-_]+/g, ' ').trim();
  return text ? text[0].toUpperCase() + text.slice(1) : 'Unknown signal';
}

export const kindLabel = (kind) => (knownKind(kind) ? SIGNAL_KINDS[kind].label : humanizeKind(kind));
export const kindHelp = (kind) => (knownKind(kind) ? SIGNAL_KINDS[kind].help : 'A signal type this page does not know yet.');

// Risk pips: 0 pips for no risk, otherwise 1..RISK_PIPS (a tiny risk still shows one pip).
export function riskPips(risk) {
  const value = Number(risk);
  const filled = !Number.isFinite(value) || value <= 0
    ? 0
    : Math.min(RISK_PIPS, Math.max(1, Math.ceil(value / (RISK_MAX / RISK_PIPS))));
  const level = filled === 0 ? 'none' : filled <= 2 ? 'low' : filled === 3 ? 'medium' : 'high';
  return { filled, total: RISK_PIPS, level };
}

export const riskLabel = ({ filled, total, level }) => `Risk ${filled} of ${total}, ${level}`;

export function riskText(risk) {
  const value = Number(risk);
  return Number.isFinite(value) ? String(Math.round(value)) : '0';
}

export function severityLevel(severity) {
  if (typeof severity === 'string') {
    const text = severity.trim().toLowerCase();
    if (['high', 'critical', 'severe'].includes(text)) return 'high';
    if (['medium', 'med', 'moderate'].includes(text)) return 'medium';
    return 'low';
  }
  const value = Number(severity);
  if (!Number.isFinite(value) || value <= 1) return 'low';
  return value < 3 ? 'medium' : 'high';
}

const SEVERITY_RANK = { low: 1, medium: 2, high: 3 };

const timeOf = (iso) => {
  if (iso === null || iso === undefined) return null;
  const time = new Date(iso).getTime();
  return Number.isNaN(time) ? null : time;
};

// Number of times the signal fired; a missing or broken count means "at least once".
export function signalCount(signal) {
  const value = Math.floor(Number(signal?.count));
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function normalizeSignal(signal) {
  return {
    kind: typeof signal.kind === 'string' ? signal.kind : '',
    detail: typeof signal.detail === 'string' ? signal.detail : '',
    count: signalCount(signal),
    severity: signal.severity,
    firstAt: typeof signal.firstAt === 'string' ? signal.firstAt : null,
    lastAt: typeof signal.lastAt === 'string' ? signal.lastAt : null,
  };
}

const isObject = (value) => value !== null && typeof value === 'object';

// Defensive copy of the API payload: always an array, every entry has a signals array and a numeric risk.
export function normalizeEntries(data) {
  if (!Array.isArray(data)) return [];
  return data.filter(isObject).map((entry) => ({
    userId: entry.userId ? String(entry.userId) : null,
    displayName: typeof entry.displayName === 'string' ? entry.displayName : '',
    teamName: typeof entry.teamName === 'string' ? entry.teamName : '',
    risk: Number.isFinite(Number(entry.risk)) ? Number(entry.risk) : 0,
    signals: Array.isArray(entry.signals) ? entry.signals.filter(isObject).map(normalizeSignal) : [],
  }));
}

export const totalSignals = (entry) => entry.signals.reduce((sum, signal) => sum + signalCount(signal), 0);

export function lastSeen(entry) {
  const times = entry.signals.map((signal) => timeOf(signal.lastAt)).filter((time) => time !== null);
  return times.length ? Math.max(...times) : 0;
}

// Highest risk first; ties go to the player with more recorded signals, then the most recent activity, then name.
export function sortEntries(entries) {
  return [...entries].sort((a, b) => (b.risk - a.risk)
    || (totalSignals(b) - totalSignals(a))
    || (lastSeen(b) - lastSeen(a))
    || entryName(a).localeCompare(entryName(b)));
}

// Most severe first, then most recent.
export function sortSignals(signals) {
  return [...signals].sort((a, b) => (SEVERITY_RANK[severityLevel(b.severity)] - SEVERITY_RANK[severityLevel(a.severity)])
    || ((timeOf(b.lastAt) ?? 0) - (timeOf(a.lastAt) ?? 0))
    || a.kind.localeCompare(b.kind));
}

export const prepareEntries = (data) => sortEntries(normalizeEntries(data)).map((entry) => ({
  ...entry,
  signals: sortSignals(entry.signals),
}));

export const isAnonymous = (entry) => !entry.userId || entry.displayName === ANONYMOUS_NAME;
export const canDismiss = (entry) => Boolean(entry.userId);
export const entryKey = (entry, index) => entry.userId ?? `anonymous:${index}`;

export function entryName(entry) {
  if (entry.displayName) return entry.displayName;
  return isAnonymous(entry) ? ANONYMOUS_NAME : 'Unknown player';
}

export function teamLabel(entry) {
  if (isAnonymous(entry)) return '-';
  return entry.teamName || 'No team';
}

// "5 min ago". Coarse on purpose; a future timestamp (clock skew) counts as "just now".
export function timeAgo(iso, now = Date.now()) {
  const time = timeOf(iso);
  if (time === null) return 'unknown';
  const minutes = Math.floor(Math.max(0, now - time) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days < 60) return `${days} d ago`;
  return new Date(time).toISOString().slice(0, 10);
}

// Absolute UTC time, the same for every admin: "2026-11-04 12:03 UTC".
export function formatWhen(iso) {
  const time = timeOf(iso);
  return time === null ? 'unknown' : `${new Date(time).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

const truncate = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

export function signalTooltip(signal, now = Date.now()) {
  const count = signalCount(signal);
  const detail = signal.detail ? ` Detail: ${truncate(signal.detail, 160)}.` : '';
  return `${kindHelp(signal.kind)}${detail} Seen ${count} ${count === 1 ? 'time' : 'times'}, `
    + `last ${timeAgo(signal.lastAt, now)}. ${EVIDENCE_NOTE}`;
}

export const dismissPrompt = (entry) => `Dismiss the signals recorded for "${entryName(entry)}"? `
  + 'Do this once you have reviewed them and found nothing wrong. They leave this list, '
  + 'and new suspicious activity will show up again. It does not change scores or bans.';
