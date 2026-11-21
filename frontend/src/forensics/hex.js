// Hex and encoding helpers shared by the hex editor, the packet viewer and the decoder tool. All pure.
export function hexToBytes(hex) {
  const clean = String(hex).replace(/[^0-9a-f]/gi, '');
  const length = Math.floor(clean.length / 2);
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) { bytes[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16); }
  return bytes;
}

// Printable ASCII stays, everything else becomes '.', as in every hex dump.
export const printable = (byte) => (byte >= 32 && byte < 127 ? String.fromCharCode(byte) : '.');
export const bytesToAscii = (bytes) => Array.from(bytes, printable).join('');

// Payload text for the packet viewer: CR/LF kept so HTTP reads naturally.
export function hexToText(hex) {
  const bytes = hexToBytes(hex);
  let out = '';
  for (const byte of bytes) { out += byte === 10 || byte === 13 ? String.fromCharCode(byte) : printable(byte); }
  return out;
}

// [{ offset, hex: ['ff', ...], ascii }] rows of `perRow` bytes; `base` is the offset of the first byte.
export function hexRows(hex, base = 0, perRow = 16) {
  const bytes = hexToBytes(hex);
  const rows = [];
  for (let i = 0; i < bytes.length; i += perRow) {
    const chunk = bytes.subarray(i, i + perRow);
    rows.push({ offset: base + i, hex: Array.from(chunk, (b) => b.toString(16).padStart(2, '0')), ascii: bytesToAscii(chunk) });
  }
  return rows;
}

export const offsetLabel = (offset) => offset.toString(16).padStart(8, '0');

// Decoders of the lab's decoder tool. Each returns { ok, text } and never throws.
export function decodeBase64(input) {
  const clean = String(input).trim().replace(/\s+/g, '');
  if (clean === '' || !/^[A-Za-z0-9+/_-]*={0,2}$/.test(clean)) { return { ok: false, text: 'Not valid base64.' }; }
  try {
    const raw = atob(clean.replaceAll('-', '+').replaceAll('_', '/'));
    return { ok: true, text: Array.from(raw, (ch) => (ch === '\n' ? ch : printable(ch.charCodeAt(0)))).join('') };
  } catch { return { ok: false, text: 'Not valid base64.' }; }
}

export function decodeHexText(input) {
  const clean = String(input).trim().replace(/^0x/i, '').replace(/\s+/g, '');
  if (clean === '' || clean.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(clean)) { return { ok: false, text: 'Not valid hex.' }; }
  return { ok: true, text: bytesToAscii(hexToBytes(clean)) };
}

export function rot13(input) {
  return String(input).replace(/[a-z]/gi, (ch) => {
    const base = ch <= 'Z' ? 65 : 97;
    return String.fromCharCode(((ch.charCodeAt(0) - base + 13) % 26) + base);
  });
}
