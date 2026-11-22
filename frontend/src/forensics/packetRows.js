// One place that makes a packet row safe to use. The server sends well-formed rows, but a single row with a null protocol or
// address must never blank the viewer, so the rows are normalised once when they are loaded: text fields become strings
// (never null or undefined) and numeric fields become finite numbers.
const text = (value) => (value === null || value === undefined ? '' : String(value));
const number = (value) => {
  const parsed = typeof value === 'string' && value.trim() === '' ? NaN : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export function normalizePacket(raw) {
  const p = raw !== null && typeof raw === 'object' ? raw : {};
  return {
    ...p,
    n: number(p.n), len: number(p.len), sp: number(p.sp), dp: number(p.dp),
    t: Number.isFinite(number(p.t)) && text(p.t).trim() !== '' && Number.isFinite(Number(p.t)) ? p.t : 0, // keeps '0.012' as sent
    src: text(p.src), dst: text(p.dst), proto: text(p.proto), info: text(p.info), hex: text(p.hex),
  };
}

export const normalizePackets = (rows) => (Array.isArray(rows) ? rows : []).map(normalizePacket);
