// A small Wireshark-like display filter. No eval and no regular expressions from the player.
//   ip.addr == 10.0.1.21        ip.src != x     ip.dst == x     port == 443     proto == dns
//   eth.addr == 02:aa:bb:cc:dd:ee   eth.src == x   eth.dst == x   (simulated MAC addresses)
//   frame.len > 100             info contains "beacon"          payload contains "X-Task"
//   dns  http  tls  tcp  udp  icmp  ntp (protocol tests)      frame contains "text" (info and payload)
//   a bare word searches every column;  terms combine with && (or "and"), || (or "or") and ! / not.
import { hexToText } from './hex.js';

// Payload text is decoded once per packet, not once per evaluation.
const textCache = new WeakMap();
const textOf = (p) => {
  let text = textCache.get(p);
  if (text === undefined) { text = hexToText(p.hex ?? '').toLowerCase(); textCache.set(p, text); }
  return text;
};
const UDP_LABELS = new Set(['DNS', 'NTP', 'UDP']);
const PROTO_WORDS = {
  dns: (p) => p.proto === 'DNS',
  http: (p) => p.proto === 'HTTP',
  tls: (p) => p.proto === 'TLS',
  icmp: (p) => p.proto === 'ICMP',
  ntp: (p) => p.proto === 'NTP',
  udp: (p) => UDP_LABELS.has(p.proto),
  tcp: (p) => p.proto !== 'ICMP' && !UDP_LABELS.has(p.proto),
};

const FIELDS = {
  'ip.addr': (p) => [p.src, p.dst],
  'ip.src': (p) => [p.src],
  'ip.dst': (p) => [p.dst],
  port: (p) => [String(p.sp), String(p.dp)],
  'tcp.port': (p) => (p.proto === 'UDP' || p.proto === 'DNS' || p.proto === 'NTP' ? [] : [String(p.sp), String(p.dp)]),
  'udp.port': (p) => (p.proto === 'DNS' || p.proto === 'NTP' ? [String(p.sp), String(p.dp)] : []),
  'eth.addr': (p) => [p.sm, p.dm].filter(Boolean),
  'eth.src': (p) => (p.sm ? [p.sm] : []),
  'eth.dst': (p) => (p.dm ? [p.dm] : []),
  proto: (p) => [String(p.proto ?? '').toLowerCase()],
  'frame.len': (p) => [String(p.len)],
  'frame.number': (p) => [String(p.n)],
  info: (p) => [String(p.info ?? '').toLowerCase()],
  payload: (p) => [textOf(p)],
  frame: (p) => [`${String(p.info ?? '').toLowerCase()} ${textOf(p)}`],
};

const TOKEN = /\s*(?:("(?:[^"\\]|\\.)*")|(&&|\|\||!=|==|>=|<=|[!()<>])|([^\s()!=<>&|"]+))/y;

function tokenize(source) {
  const tokens = [];
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < source.length) {
    const start = TOKEN.lastIndex;
    const match = TOKEN.exec(source);
    if (!match) {
      if (source.slice(start).trim() === '') { break; }
      const rest = source.slice(start).trimStart();
      if (rest.startsWith('"')) { throw new Error('Unterminated quote: add the closing ".'); }
      if (rest[0] === '&' || rest[0] === '|') { throw new Error(`Use ${rest[0]}${rest[0]} to combine terms.`); }
      if (rest[0] === '=') { throw new Error('Use == to compare.'); }
      throw new Error(`Unexpected character near "${rest.slice(0, 8)}"`);
    }
    if (tokens.length > 60) { throw new Error('Filter too long.'); }
    if (match[1] !== undefined) {
      let value;
      try { value = JSON.parse(match[1]); } catch { throw new Error('Bad escape inside the quoted text.'); }
      tokens.push({ type: 'str', value });
    }
    else if (match[2] !== undefined) { tokens.push({ type: 'op', value: match[2] }); }
    else {
      const word = match[3];
      const lowered = word.toLowerCase();
      if (lowered === 'and') { tokens.push({ type: 'op', value: '&&' }); }
      else if (lowered === 'or') { tokens.push({ type: 'op', value: '||' }); }
      else if (lowered === 'not') { tokens.push({ type: 'op', value: '!' }); }
      else if (lowered === 'contains') { tokens.push({ type: 'op', value: 'contains' }); }
      else { tokens.push({ type: 'word', value: word }); }
    }
  }
  return tokens;
}

function compare(values, op, rawValue) {
  const wanted = String(rawValue).toLowerCase();
  const numeric = Number(wanted);
  const test = (value) => {
    if (op === '==') { return value === wanted; }
    if (op === 'contains') { return value.includes(wanted); }
    if (!Number.isFinite(numeric)) { return false; }
    const n = Number(value);
    return { '>': n > numeric, '<': n < numeric, '>=': n >= numeric, '<=': n <= numeric }[op] ?? false;
  };
  if (op === '!=') { return values.every((value) => value !== wanted); }
  return values.some(test);
}

// Returns { ok: true, test } or { ok: false, error }. An empty filter matches everything.
export function parseFilter(source) {
  if (typeof source !== 'string' || source.trim() === '') { return { ok: true, test: () => true, empty: true }; }
  if (source.length > 200) { return { ok: false, error: 'Filter too long.' }; }
  let tokens;
  try { tokens = tokenize(source); } catch (error) { return { ok: false, error: error.message }; }
  let at = 0;
  const peek = () => tokens[at];
  const take = () => tokens[at++];
  const fail = (message) => { throw new Error(message); };

  function primary() {
    const token = take();
    if (!token) { fail('The filter ends too early.'); }
    if (token.type === 'op' && token.value === '(') {
      const inner = orExpr();
      if (take()?.value !== ')') { fail('Missing closing parenthesis.'); }
      return inner;
    }
    if (token.type === 'op' && token.value === '!') {
      const inner = primary();
      return (p) => !inner(p);
    }
    if (token.type === 'str') { return (p) => haystack(p).includes(token.value.toLowerCase()); }
    if (token.type !== 'word') { fail(`Unexpected "${token.value}".`); }
    const next = peek();
    const field = token.value.toLowerCase();
    if (next?.type === 'op' && ['==', '!=', '>', '<', '>=', '<=', 'contains'].includes(next.value)) {
      take();
      const value = take();
      if (!value || (value.type !== 'word' && value.type !== 'str')) { fail(`Missing value after ${next.value}.`); }
      if (!Object.hasOwn(FIELDS, field)) { fail(`Unknown field "${token.value}".`); }
      const read = FIELDS[field];
      return (p) => compare(read(p), next.value, value.value);
    }
    const bare = token.value.toLowerCase();
    if (Object.hasOwn(PROTO_WORDS, bare)) { return PROTO_WORDS[bare]; }
    if (Object.hasOwn(FIELDS, bare)) { fail(`"${token.value}" needs a comparison, for example ${bare} == 80 or ${bare} contains "text".`); }
    return (p) => haystack(p).includes(bare);
  }
  function andExpr() {
    let left = primary();
    while (peek()?.value === '&&') { take(); const l = left; const r = primary(); left = (p) => l(p) && r(p); }
    return left;
  }
  function orExpr() {
    let left = andExpr();
    while (peek()?.value === '||') { take(); const l = left; const r = andExpr(); left = (p) => l(p) || r(p); }
    return left;
  }
  try {
    const test = orExpr();
    if (at < tokens.length) { fail(`Unexpected "${tokens[at].value}".`); }
    return { ok: true, test };
  } catch (error) { return { ok: false, error: error.message }; }
}

const haystack = (p) => `${p.n} ${p.src} ${p.dst} ${p.sp} ${p.dp} ${p.proto} ${String(p.info ?? '').toLowerCase()} ${textOf(p)}`.toLowerCase();

export function filterPackets(packets, parsed, limit = 5000) {
  const out = [];
  for (const packet of packets) {
    if (parsed.test(packet)) { out.push(packet); if (out.length >= limit) { break; } }
  }
  return out;
}
