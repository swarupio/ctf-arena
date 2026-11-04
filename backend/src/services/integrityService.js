// Fair-play layer (docs/FAIR_PLAY.md): honeypot and canary signals, tainted decoy flags, terminal pacing rules and the
// admin review queries. Design rules:
//  * Evidence only. Nothing here bans anyone; admins read the signals and decide.
//  * Best effort. A failing or slow integrity write never fails the request: signal writes are fire-and-forget
//    (awaitable in tests through flush()), and the one awaited read per exec is capped by a short timeout.
//  * Stateless replicas. Counters live in MongoDB (atomic upserts); this process keeps nothing that matters.
//  * Privacy. No raw IPs (salted SHA-256), no full user agents (a family label), no command text beyond 120 chars.
import { createHash, createHmac } from 'node:crypto';
import mongoose from 'mongoose';
import { getCognitoVerifier } from '../config/cognito.js';
import { env } from '../config/env.js';
import CheatSignal from '../models/CheatSignal.js';
import TaintedFlag from '../models/TaintedFlag.js';
import Team from '../models/Team.js';
import TerminalActivity from '../models/TerminalActivity.js';
import User from '../models/User.js';
import { CANARY_COMMANDS, CANARY_REPLY_LINE } from './integrityBait.js';

// ---- thresholds (documented in docs/FAIR_PLAY.md) ---------------------------------------------------------------
export const MIN_GAP_MS = 300; // two commands closer than this: 429, not counted, no signal
export const MAX_PER_MINUTE = 50; // the 51st command inside one minute: 429 plus a signal
export const CADENCE_MIN_GAPS = 15;
export const CADENCE_MAX_STDDEV_MS = 35;
export const CADENCE_MAX_MEAN_MS = 6000;
export const SLOW_DOWN_MESSAGE = 'Easy there, speed typist. Give each command a moment.';
export const DETAIL_MAX = 120;
export const CANARY_DETAIL_CHARS = 60;
export const RISK_COUNT_CAP = 5;
export const DB_TIMEOUT_MS = 1000;
const MAX_SCAN = 5000; // admin review reads at most this many signal rows (newest first)

export const SEVERITY = Object.freeze({
  'honeypot-endpoint': 2,
  'tainted-flag': 3,
  'terminal-canary': 2,
  'terminal-velocity': 2,
  'terminal-cadence': 2,
  'automation-ua': 1,
});

const AUTOMATION_UA = /curl|wget|python-requests|aiohttp|httpx|axios|node-fetch|undici|got |go-http|okhttp|postmanruntime|java|libwww|headless|puppeteer|playwright/i;
const TIMED_OUT = Symbol('timed-out');
const ALLOW = Object.freeze({});
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

// ---- small pure helpers ---------------------------------------------------------------------------------------
// Control characters and runs of spaces collapse to one space, then the text is cut to `max` characters.
export function clip(text, max = DETAIL_MAX) {
  return String(text ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

// Decoy flag that looks like a real dynamic flag: CTF{<slug_with_underscores>_<12 hex>}. Deterministic per
// (subject, slug), so repeated honeypot hits show the same value and a copied flag is traceable to its recipient.
export function taintedFlagFor({ secret, subjectKey, slug }) {
  const digest = createHmac('sha256', secret).update(`taint:${subjectKey}:${slug}`).digest('hex').slice(0, 12);
  return `CTF{${slug.replaceAll('-', '_')}_${digest}}`;
}

export const isCanaryCommand = (command) => typeof command === 'string' && CANARY_COMMANDS.some((pattern) => pattern.test(command));

// null for ordinary browsers, otherwise a short family label (never the full user agent).
export function automationFamily(userAgent) {
  const text = typeof userAgent === 'string' ? userAgent.trim().slice(0, 512) : '';
  if (!text) { return 'missing'; }
  const match = AUTOMATION_UA.exec(text);
  return match ? match[0].toLowerCase().trim() : null;
}

export function cadenceOf({ n, sum, sumSq }) {
  if (!n) { return { mean: 0, stddev: 0 }; }
  const mean = sum / n;
  return { mean, stddev: Math.sqrt(Math.max(0, sumSq / n - mean * mean)) };
}

// Machine-like rhythm: many gaps inside one minute that are almost identical and short.
export function isRobotCadence(gaps) {
  if (!gaps || gaps.n < CADENCE_MIN_GAPS) { return false; }
  const { mean, stddev } = cadenceOf(gaps);
  return stddev < CADENCE_MAX_STDDEV_MS && mean < CADENCE_MAX_MEAN_MS;
}

export const bucketStart = (nowMs) => Math.floor(nowMs / 60_000) * 60_000;

// One atomic update pipeline for a user-minute document. It reads the previous `lastAt` inside the same operation
// that writes, so concurrent requests on different replicas each see a consistent previous value. A request closer
// than MIN_GAP_MS to the previous one changes nothing (it is rejected and does not count).
export function activityUpdate(at) {
  const hasPrev = { $eq: [{ $type: '$lastAt' }, 'date'] };
  const gap = { $subtract: [at, '$lastAt'] };
  const throttled = { $and: [hasPrev, { $lt: [gap, MIN_GAP_MS] }] };
  const current = (field) => ({ $ifNull: [`$${field}`, 0] });
  const grow = (field, amount) => ({ $cond: [throttled, current(field), { $add: [current(field), amount] }] });
  const onlyWithGap = (value) => ({ $cond: [hasPrev, value, 0] });
  return [{
    $set: {
      count: grow('count', 1),
      gapN: grow('gapN', onlyWithGap(1)),
      gapSum: grow('gapSum', onlyWithGap(gap)),
      gapSumSq: grow('gapSumSq', onlyWithGap({ $multiply: [gap, gap] })),
      lastAt: { $cond: [throttled, '$lastAt', at] },
    },
  }];
}

function isDuplicateKey(error) {
  if (error?.code === 11000) { return true; }
  const errors = error?.writeErrors;
  return Array.isArray(errors) && errors.length > 0 && errors.every((item) => (item?.code ?? item?.err?.code) === 11000);
}

// Integrity needs a live connection. Without one (unit tests, boot, outage) it does nothing instead of letting
// Mongoose buffer commands for 10 seconds.
const active = () => mongoose.connection?.readyState === 1;

function withTimeout(promise, ms = DB_TIMEOUT_MS) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), ms);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// ---- privacy: who is calling -----------------------------------------------------------------------------------
let saltCache;
const ipSalt = () => (saltCache ??= createHmac('sha256', env.FLAG_SECRET).update('integrity:ip-salt').digest('hex'));

export const ipHash = (ip) => sha256(`${ipSalt()}:${ip}`);

// Behind our Nginx the last X-Forwarded-For entry is the address Nginx saw (it overwrites the header, see
// nginx.conf), so earlier, client-forged entries are ignored and cannot be used to mint endless subjects.
export function clientIp(req) {
  const forwarded = req.get?.('x-forwarded-for');
  if (typeof forwarded === 'string' && forwarded.trim()) {
    const last = forwarded.slice(0, 400).split(',').at(-1).trim();
    if (last) { return last; }
  }
  return req.socket?.remoteAddress ?? 'unknown';
}

// Never throws and never fails the request: a missing, invalid or unknown token simply means "anonymous".
async function identifyCaller(req) {
  const anonymous = { subjectKey: `ip:${ipHash(clientIp(req))}`, userId: null };
  try {
    const bearer = /^Bearer ([^\s,]+)$/i.exec(req.get('authorization') ?? '');
    if (!bearer || !active()) { return anonymous; }
    const payload = await withTimeout(Promise.resolve().then(() => getCognitoVerifier().verify(bearer[1])));
    if (payload === TIMED_OUT || typeof payload?.sub !== 'string' || !payload.sub) { return anonymous; }
    const user = await withTimeout(Promise.resolve(User.findOne({ cognitoSub: payload.sub })));
    return user && user !== TIMED_OUT && user._id ? { subjectKey: String(user._id), userId: user._id } : anonymous;
  } catch {
    return anonymous;
  }
}

// ---- best-effort background writes -----------------------------------------------------------------------------
const pending = new Set();
let failing = false;

function background(task) {
  const run = Promise.resolve()
    .then(task)
    .then(() => { failing = false; })
    .catch(() => {
      // Only the first failure of a streak is logged, and never with error text (it could carry connection details).
      if (!failing) { failing = true; process.stderr.write('[integrity] a fair-play write failed; continuing\n'); }
    })
    .finally(() => pending.delete(run));
  pending.add(run);
}

// Resolves when every fire-and-forget write started so far has finished. Tests call it; production does not need to.
async function flush() {
  while (pending.size > 0) { await Promise.allSettled([...pending]); }
}

// Upsert on {subjectKey, kind, detail}: a repeat costs one cheap update and never adds a row.
async function upsertSignal({ subjectKey, userId = null, kind, severity = SEVERITY[kind], detail = '' }) {
  const at = new Date(Date.now());
  const filter = { subjectKey, kind, detail: clip(detail) };
  const update = {
    $inc: { count: 1 },
    $set: { lastAt: at },
    $setOnInsert: { userId, severity, firstAt: at },
  };
  const options = { upsert: true, setDefaultsOnInsert: false };
  try {
    await CheatSignal.updateOne(filter, update, options);
  } catch (error) {
    // Two replicas inserting the same new row at once: the loser retries as a plain update.
    if (!isDuplicateKey(error)) { throw error; }
    await CheatSignal.updateOne(filter, update, options);
  }
}

function recordSignal(signal) {
  if (!active()) { return; }
  background(() => upsertSignal(signal));
}

// ---- tainted flags ----------------------------------------------------------------------------------------------
// Issues one decoy flag per slug for this subject and stores only the hashes (best effort, capped by a timeout).
async function issueTaintedFlags({ subjectKey, slugs }) {
  const flags = slugs.map((slug) => taintedFlagFor({ secret: env.FLAG_SECRET, subjectKey, slug }));
  if (!active()) { return flags; }
  const issuedAt = new Date(Date.now());
  const documents = flags.map((flag, index) => ({ hash: sha256(flag), subjectKey, slug: slugs[index], issuedAt }));
  try {
    await withTimeout(Promise.resolve(TaintedFlag.insertMany(documents, { ordered: false })));
  } catch (error) {
    if (!isDuplicateKey(error)) { background(() => Promise.reject(error)); }
  }
  return flags;
}

// Call only after a WRONG submission. One indexed lookup by hash; a hit means the flag was copied from a honeypot
// or canary reply. The caller answers exactly as for any other incorrect flag: the trap is never revealed.
async function checkSubmittedFlag({ flag, user }) {
  if (!active() || !user?._id || typeof flag !== 'string') { return; }
  try {
    const found = await withTimeout(Promise.resolve(TaintedFlag.findOne({ hash: sha256(flag.trim()) }, 'subjectKey').lean()));
    if (!found || found === TIMED_OUT) { return; }
    const own = String(user._id);
    const source = found.subjectKey === own ? 'self' : (String(found.subjectKey).startsWith('ip:') ? 'anonymous' : found.subjectKey);
    recordSignal({ subjectKey: own, userId: user._id, kind: 'tainted-flag', detail: `from:${source}` });
  } catch {
    // The lookup is best effort; the answer to the player is unaffected.
  }
}

// ---- terminal exec checks ---------------------------------------------------------------------------------------
async function noteExec(userId, nowMs) {
  const at = new Date(nowMs);
  const filter = { userId, bucket: new Date(bucketStart(nowMs)) };
  const options = { upsert: true, returnDocument: 'before', lean: true, setDefaultsOnInsert: false };
  let before;
  try {
    before = await TerminalActivity.findOneAndUpdate(filter, activityUpdate(at), options);
  } catch (error) {
    if (!isDuplicateKey(error)) { throw error; }
    before = await TerminalActivity.findOneAndUpdate(filter, activityUpdate(at), options);
  }
  const previous = before?.lastAt ? new Date(before.lastAt).getTime() : Number.NaN;
  const gap = Number.isNaN(previous) ? null : nowMs - previous;
  if (gap !== null && gap < MIN_GAP_MS) { return { throttled: true }; }
  const extra = gap === null ? 0 : 1;
  return {
    throttled: false,
    count: (before?.count ?? 0) + 1,
    gaps: {
      n: (before?.gapN ?? 0) + extra,
      sum: (before?.gapSum ?? 0) + (gap ?? 0),
      sumSq: (before?.gapSumSq ?? 0) + (gap === null ? 0 : gap * gap),
    },
  };
}

// Decides what the exec route does with a command, BEFORE the engine runs. Returns:
//   {}                              run it normally
//   { slowDown: true, message }     answer 429 SLOW_DOWN
//   { canaryOutput }                answer with the canary reply (the engine is not run)
// Players only: the route does not call this for admins.
async function inspectExec({ req, user, mode, command }) {
  if (!active() || !user?._id) { return ALLOW; }
  const userId = user._id;
  const subjectKey = String(userId);

  let activity = null;
  try {
    const result = await withTimeout(noteExec(userId, Date.now()));
    activity = result === TIMED_OUT ? null : result;
  } catch {
    activity = null; // no counters this time: never block a player because bookkeeping failed
  }
  const slowDown = { slowDown: true, message: SLOW_DOWN_MESSAGE };
  if (activity?.throttled) { return slowDown; }

  const note = (kind, detail) => recordSignal({ subjectKey, userId, kind, detail });
  const family = automationFamily(req.get?.('user-agent'));
  if (family) { note('automation-ua', family); }

  let blocked = false;
  if (activity) {
    if (activity.count > MAX_PER_MINUTE) {
      blocked = true;
      note('terminal-velocity', mode);
    }
    if (isRobotCadence(activity.gaps)) { note('terminal-cadence', mode); }
  }
  if (blocked) { return slowDown; }

  if (isCanaryCommand(command)) {
    note('terminal-canary', `${mode}:${clip(command, CANARY_DETAIL_CHARS)}`);
    const [token] = await issueTaintedFlags({ subjectKey, slugs: [`terminal-${mode}-canary`] });
    return { canaryOutput: `${CANARY_REPLY_LINE}\ntoken: ${token}` };
  }
  return ALLOW;
}

// ---- admin review ----------------------------------------------------------------------------------------------
const FROM_USER = /^from:([0-9a-f]{24})$/i;
const riskOf = (signals) => signals.reduce((total, signal) => total + signal.severity * Math.min(signal.count, RISK_COUNT_CAP), 0);
const byRecent = (a, b) => b.lastAt - a.lastAt;
const publicSignal = ({ kind, detail, count, severity, firstAt, lastAt }) => ({ kind, detail, count, severity, firstAt, lastAt });
const orderSignals = (signals) => [...signals].sort((a, b) => b.severity - a.severity || byRecent(a, b) || a.kind.localeCompare(b.kind));

// Users ranked by risk = sum(severity * min(count, 5)). Anonymous (ip-keyed) rows are merged into one entry with
// counts only. No emails, no ip hashes, no subject keys leave this function.
async function listRisk({ limit = 50 } = {}) {
  const rows = await CheatSignal.find({}, 'userId kind detail count severity firstAt lastAt').sort({ lastAt: -1 }).limit(MAX_SCAN).lean();
  const byUser = new Map();
  const anonymous = new Map();
  for (const row of rows) {
    const signal = { ...row, firstAt: new Date(row.firstAt), lastAt: new Date(row.lastAt) };
    if (row.userId) {
      const key = String(row.userId);
      byUser.set(key, [...(byUser.get(key) ?? []), signal]);
      continue;
    }
    const key = `${row.kind}\u0000${row.detail}`;
    const merged = anonymous.get(key);
    anonymous.set(key, merged ? {
      ...merged,
      count: merged.count + row.count,
      severity: Math.max(merged.severity, row.severity),
      firstAt: new Date(Math.min(merged.firstAt, signal.firstAt)),
      lastAt: new Date(Math.max(merged.lastAt, signal.lastAt)),
    } : signal);
  }

  const referenced = new Set();
  for (const signals of byUser.values()) {
    for (const signal of signals) {
      const from = signal.kind === 'tainted-flag' ? FROM_USER.exec(signal.detail ?? '') : null;
      if (from) { referenced.add(from[1].toLowerCase()); }
    }
  }
  const userIds = [...new Set([...byUser.keys(), ...referenced])];
  const users = userIds.length > 0 ? await User.find({ _id: { $in: userIds } }, 'displayName teamId').lean() : [];
  const userById = new Map(users.map((user) => [String(user._id), user]));
  const teamIds = [...new Set(users.filter((user) => user.teamId).map((user) => String(user.teamId)))];
  const teams = teamIds.length > 0 ? await Team.find({ _id: { $in: teamIds } }, 'name').lean() : [];
  const teamById = new Map(teams.map((team) => [String(team._id), team]));

  const entries = [...byUser].map(([userId, signals]) => {
    const user = userById.get(userId);
    const shown = signals.map((signal) => {
      const from = signal.kind === 'tainted-flag' ? FROM_USER.exec(signal.detail ?? '') : null;
      if (!from) { return signal; }
      return { ...signal, detail: `from:${userById.get(from[1].toLowerCase())?.displayName ?? 'unknown user'}` };
    });
    return {
      userId,
      displayName: user?.displayName ?? '(unknown user)',
      teamName: user?.teamId ? (teamById.get(String(user.teamId))?.name ?? null) : null,
      risk: riskOf(shown),
      signals: orderSignals(shown).map(publicSignal),
      lastAt: Math.max(...shown.map((signal) => signal.lastAt.getTime())),
    };
  });
  if (anonymous.size > 0) {
    const signals = [...anonymous.values()];
    entries.push({
      userId: null,
      displayName: 'anonymous scrapers',
      teamName: null,
      risk: riskOf(signals),
      signals: orderSignals(signals).map(publicSignal),
      lastAt: Math.max(...signals.map((signal) => signal.lastAt.getTime())),
    });
  }
  entries.sort((a, b) => b.risk - a.risk || b.lastAt - a.lastAt || String(a.userId).localeCompare(String(b.userId)));
  return entries.slice(0, limit).map(({ lastAt, ...entry }) => entry);
}

// Dismiss = delete this user's signals. Signals other users earned by reusing this user's decoy flags stay.
async function dismiss(userId) {
  await CheatSignal.deleteMany({ subjectKey: String(userId).toLowerCase() });
}

export const integrityService = {
  active,
  ipHash,
  clientIp,
  identifyCaller,
  recordSignal,
  upsertSignal,
  issueTaintedFlags,
  checkSubmittedFlag,
  inspectExec,
  listRisk,
  dismiss,
  flush,
};
