// A small Wireshark-like display filter. No eval and no regular expressions from the player.
//   ip.addr == 10.0.1.21        ip.src != x     ip.dst == x     port == 443     proto == dns
//   frame.len > 100             info contains "beacon"          payload contains "X-Task"
//   a bare word searches every column;  terms combine with && (or "and"), || (or "or") and ! / not.
import { hexToText } from './hex.js';

const FIELDS = {
  'ip.addr': (p) => [p.src, p.dst],
  'ip.src': (p) => [p.src],
  'ip.dst': (p) => [p.dst],
  port: (p) => [String(p.sp), String(p.dp)],
  'tcp.port': (p) => (p.proto === 'UDP' || p.proto === 'DNS' || p.proto === 'NTP' ? [] : [String(p.sp), String(p.dp)]),
  'udp.port': (p) => (p.proto === 'DNS' || p.proto === 'NTP' ? [String(p.sp), String(p.dp)] : []),
  proto: (p) => [p.proto.toLowerCase()],
  'frame.len': (p) => [String(p.len)],
  'frame.number': (p) => [String(p.n)],
  info: (p) => [p.info.toLowerCase()],
  payload: (p) => [hexToText(p.hex).toLowerCase()],
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
      throw new Error(`Unexpected character near "${source.slice(start, start + 8).trim()}"`);
    }
    if (tokens.length > 60) { throw new Error('Filter too long.'); }
    if (match[1] !== undefined) { tokens.push({ type: 'str', value: JSON.parse(match[1]) }); }
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

const haystack = (p) => `${p.n} ${p.src} ${p.dst} ${p.sp} ${p.dp} ${p.proto} ${p.info} ${hexToText(p.hex)}`.toLowerCase();

export function filterPackets(packets, parsed, limit = 5000) {
  const out = [];
  for (const packet of packets) {
    if (parsed.test(packet)) { out.push(packet); if (out.length >= limit) { break; } }
  }
  return out;
}

// "Follow stream": every packet of the conversation the clicked packet belongs to, in capture order.
export const streamKey = (p) => {
  const a = `${p.src}:${p.sp}`;
  const b = `${p.dst}:${p.dp}`;
  return `${p.proto === 'UDP' ? 'u' : 't'}|${a < b ? `${a}|${b}` : `${b}|${a}`}`;
};

export function followStream(packets, packet) {
  const key = streamKey(packet);
  const mine = packets.filter((p) => p.hex && streamKey(p) === key);
  return mine.map((p) => ({ n: p.n, from: `${p.src}:${p.sp}`, outbound: p.src === packet.src && p.sp === packet.sp, text: hexToText(p.hex) }));
}
