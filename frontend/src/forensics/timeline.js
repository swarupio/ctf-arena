// Pure helpers of the Forensics Desk timeline board: pins, ordering, storage and the contradiction checker.
// The checker reads ONLY the pinned items (log lines and packets the player already sees in the viewers). It never
// looks at the suspect board, the answers or any server data, so it cannot reveal anything the player does not hold.
export const TIMELINE_PREFIX = 'forensics-timeline:';
export const MAX_PINS = 40;
const MAX_TEXT = 400;

// The capture of the server starts at this instant (`start` of every capture page); packet times are offsets from it.
export const CAPTURE_START = Date.UTC(2026, 2, 14, 3, 0, 0);

const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
const ISO_LINE = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) (\S+) /;
const CLF_LINE = /\[(\d{2})\/([A-Z][a-z]{2})\/(\d{4}):(\d{2}):(\d{2}):(\d{2}) [+-]\d{4}\]/;

// Timestamp (ms since epoch, UTC) of a log line, or null when the line carries none.
export function logTime(text) {
  const iso = ISO_LINE.exec(text);
  if (iso) { return Date.UTC(+iso[1], +iso[2] - 1, +iso[3], +iso[4], +iso[5], +iso[6]); }
  const clf = CLF_LINE.exec(text);
  if (clf && clf[2] in MONTHS) { return Date.UTC(+clf[3], MONTHS[clf[2]], +clf[1], +clf[4], +clf[5], +clf[6]); }
  return null;
}

export const clockOf = (ms) => new Date(ms).toISOString().slice(11, 19);

// ---- pins ----------------------------------------------------------------------------------------------------
const cut = (value) => String(value ?? '').slice(0, MAX_TEXT);
export const logPin = (line) => ({ id: `log:${line.n}`, kind: 'log', n: line.n, text: cut(line.text) });
export const packetPin = (p) => ({
  id: `packet:${p.n}`, kind: 'packet', n: p.n, t: cut(p.t), src: cut(p.src), sp: Number(p.sp) || 0, dst: cut(p.dst), dp: Number(p.dp) || 0,
  proto: cut(p.proto), info: cut(p.info),
});

export function pinTime(pin) {
  if (pin.kind === 'log') { return logTime(pin.text); }
  const offset = Number(pin.t);
  return Number.isFinite(offset) ? CAPTURE_START + Math.round(offset * 1000) : null;
}

export function pinLabel(pin) {
  return pin.kind === 'log' ? `Log line ${pin.n}` : `Packet ${pin.n}`;
}

export function pinSummary(pin) {
  return pin.kind === 'log' ? pin.text : `${pin.src}:${pin.sp} -> ${pin.dst}:${pin.dp} ${pin.proto} ${pin.info}`;
}

// Oldest first. Items without a time and ties keep their kind and number order, so the result is stable.
export function sortByTime(pins) {
  return [...pins].sort((a, b) => {
    const ta = pinTime(a);
    const tb = pinTime(b);
    if (ta !== tb) { return (ta ?? Infinity) - (tb ?? Infinity) || 0; }
    return a.kind === b.kind ? a.n - b.n : a.kind.localeCompare(b.kind);
  });
}

// ---- state ---------------------------------------------------------------------------------------------------
export const emptyTimeline = () => ({ v: 1, pins: [], manual: false, hunter: false });

export function addPin(state, pin) {
  if (state.pins.some((p) => p.id === pin.id) || state.pins.length >= MAX_PINS) { return state; }
  const pins = [...state.pins, pin];
  return { ...state, pins: state.manual ? pins : sortByTime(pins) };
}

export const removePin = (state, id) => ({ ...state, pins: state.pins.filter((p) => p.id !== id) });

// Moves one pin up (-1) or down (+1). A manual move switches the board from "sorted by time" to "my order".
export function movePin(state, id, delta) {
  const from = state.pins.findIndex((p) => p.id === id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= state.pins.length) { return state; }
  const pins = [...state.pins];
  [pins[from], pins[to]] = [pins[to], pins[from]];
  return { ...state, pins, manual: true };
}

// Drag and drop: puts `id` where `targetId` is.
export function dropPin(state, id, targetId) {
  const from = state.pins.findIndex((p) => p.id === id);
  const to = state.pins.findIndex((p) => p.id === targetId);
  if (from < 0 || to < 0 || from === to) { return state; }
  const pins = [...state.pins];
  const [item] = pins.splice(from, 1);
  pins.splice(to, 0, item);
  return { ...state, pins, manual: true };
}

export const resortByTime = (state) => ({ ...state, pins: sortByTime(state.pins), manual: false });

// ---- contradictions ------------------------------------------------------------------------------------------
const VPN_LINE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} vpn01 openvpn\[\d+\]: (\S+)\/(10\.8\.\d+\.\d+) session (opened|closed)$/;
const POOL_LOGIN = /sshd\[\d+\]: Accepted \w+ for (\S+) from (10\.8\.\d+\.\d+) port \d+/;
const DNS_QUERY = /^Standard query (0x[0-9a-f]+) A (\S+)$/;
const DNS_REPLY = /^Standard query response (0x[0-9a-f]+) A (\S+) /;
const REQUEST = /^(GET|POST) \S+ HTTP\/1\.\d$/;
const RESPONSE = /^HTTP\/1\.\d \d{3}/;
const flowKey = (src, sp, dst, dp) => `${src}:${sp}>${dst}:${dp}`;

const finding = (rule, a, b, message) => ({ id: `${a.id}~${b.id}`, rule, a: a.id, b: b.id, message });

// Rules for a pair of log lines (a is the one with the lower line number).
function logRules(a, b) {
  const ta = logTime(a.text);
  const tb = logTime(b.text);
  if (ta === null || tb === null) { return null; }
  const vpnA = VPN_LINE.exec(a.text);
  const vpnB = VPN_LINE.exec(b.text);
  const loginA = POOL_LOGIN.exec(a.text);
  const loginB = POOL_LOGIN.exec(b.text);
  const pairs = [[loginA, vpnB, ta, tb], [loginB, vpnA, tb, ta]];
  for (const [login, vpn, loginAt, vpnAt] of pairs) {
    if (!login || !vpn || login[1] !== vpn[1] || login[2] !== vpn[2]) { continue; }
    if (vpn[3] === 'opened' && loginAt < vpnAt) {
      return finding('login-before-session', a, b,
        `${login[1]} logged in at ${clockOf(loginAt)} from the VPN pool address ${login[2]}, but the VPN session only opened at ${clockOf(vpnAt)}.`);
    }
    if (vpn[3] === 'closed' && loginAt > vpnAt) {
      return finding('login-after-session', a, b,
        `${login[1]} logged in at ${clockOf(loginAt)} from the VPN pool address ${login[2]}, but the VPN session had closed at ${clockOf(vpnAt)}.`);
    }
  }
  if (vpnA && vpnB && vpnA[1] === vpnB[1] && vpnA[2] === vpnB[2] && vpnA[3] !== vpnB[3]) {
    const [open, close] = vpnA[3] === 'opened' ? [ta, tb] : [tb, ta];
    if (close < open) { return finding('closed-before-opened', a, b, `The VPN session of ${vpnA[1]} closed at ${clockOf(close)} before it opened at ${clockOf(open)}.`); }
  }
  if (a.n < b.n && ta > tb) {
    return finding('line-order', a, b, `Line ${a.n} is stamped ${clockOf(ta)} but the later line ${b.n} is stamped ${clockOf(tb)}: the log clock jumped back.`);
  }
  return null;
}

// Rules for a pair of packets (a is the one with the lower number).
function packetRules(a, b) {
  const ta = pinTime(a);
  const tb = pinTime(b);
  if (ta === null || tb === null) { return null; }
  const secs = (x, y) => `${(Math.abs(x - y) / 1000).toFixed(1)} s`;
  // DNS: an answer cannot be sent before the question with the same id and name.
  for (const [x, y] of [[a, b], [b, a]]) {
    const q = DNS_QUERY.exec(x.info);
    const reply = DNS_REPLY.exec(y.info);
    if (q && reply && q[1] === reply[1] && q[2] === reply[2] && pinTime(y) < pinTime(x)) {
      return finding('reply-before-request', a, b, `The DNS answer for ${q[2]} (packet ${y.n}) is stamped ${secs(pinTime(x), pinTime(y))} before the question (packet ${x.n}).`);
    }
  }
  // Adjacent request and reply frames of one connection: the reply cannot be stamped before its request.
  if (b.n === a.n + 1 && REQUEST.test(a.info) && RESPONSE.test(b.info)
    && flowKey(a.src, a.sp, a.dst, a.dp) === flowKey(b.dst, b.dp, b.src, b.sp) && tb < ta) {
    return finding('reply-before-request', a, b,
      `Packet ${b.n} answers packet ${a.n} but is stamped ${secs(ta, tb)} earlier: one of the two clocks is skewed.`);
  }
  // A connection is closed before it was opened.
  const flags = (p) => /\[([A-Z, ]+)\]/.exec(p.info)?.[1] ?? '';
  for (const [x, y] of [[a, b], [b, a]]) {
    const opens = /\bSYN\b/.test(flags(x)) && !/\bACK\b/.test(flags(x));
    if (opens && /\bFIN\b/.test(flags(y)) && flowKey(x.src, x.sp, x.dst, x.dp) === flowKey(y.src, y.sp, y.dst, y.dp) && pinTime(y) < pinTime(x)) {
      return finding('fin-before-syn', a, b, `The connection is closed (packet ${y.n}) before it was opened (packet ${x.n}).`);
    }
  }
  if (a.n < b.n && ta > tb) {
    return finding('packet-order', a, b, `Packet ${a.n} is stamped ${secs(ta, tb)} later than packet ${b.n}, which was captured after it: a clock is skewed.`);
  }
  return null;
}

// All contradictions between pairs of pinned items. Deterministic: depends only on the pins, never on their order.
// At most one finding per pair (the most specific rule wins).
export function findContradictions(pins) {
  const logs = pins.filter((p) => p.kind === 'log').sort((x, y) => x.n - y.n);
  const packets = pins.filter((p) => p.kind === 'packet').sort((x, y) => x.n - y.n);
  const out = [];
  for (const [list, rules] of [[logs, logRules], [packets, packetRules]]) {
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const hit = rules(list[i], list[j]);
        if (hit) { out.push(hit); }
      }
    }
  }
  return out;
}

// ---- storage -------------------------------------------------------------------------------------------------
export const timelineKey = (email, trackId) => `${TIMELINE_PREFIX}${String(email ?? 'anonymous').toLowerCase()}:${trackId}`;

const isLogPin = (p) => p.kind === 'log' && typeof p.text === 'string' && Number.isInteger(p.n) && p.n > 0 && p.id === `log:${p.n}`;
const isPacketPin = (p) => p.kind === 'packet' && Number.isInteger(p.n) && p.n > 0 && p.id === `packet:${p.n}`
  && ['t', 'src', 'dst', 'proto', 'info'].every((k) => typeof p[k] === 'string');

// Whatever is in localStorage is only trusted after it has been rebuilt field by field.
export function sanitizeTimeline(raw) {
  if (!raw || typeof raw !== 'object' || raw.v !== 1 || !Array.isArray(raw.pins)) { return emptyTimeline(); }
  const seen = new Set();
  const pins = [];
  for (const p of raw.pins) {
    if (!p || typeof p !== 'object') { continue; }
    const clean = isLogPin(p) ? logPin(p) : isPacketPin(p) ? packetPin(p) : null;
    if (clean && !seen.has(clean.id) && pins.length < MAX_PINS) { seen.add(clean.id); pins.push(clean); }
  }
  return { v: 1, pins, manual: raw.manual === true, hunter: raw.hunter === true };
}

export function readTimeline(storage, key) {
  try { return sanitizeTimeline(JSON.parse(storage?.getItem(key) ?? 'null')); } catch { return emptyTimeline(); }
}

export function writeTimeline(storage, key, state) {
  try { storage?.setItem(key, JSON.stringify(state)); } catch { /* storage may be blocked or full */ }
}
