// LSB steganography helpers for the pixel-grid canvas: all pure, tested without a browser.
export function base64ToBytes(text) {
  const raw = atob(String(text));
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) { bytes[i] = raw.charCodeAt(i); }
  return bytes;
}

export const CHANNELS = ['red', 'green', 'blue'];

// Reads the least significant bit of one channel, pixel by pixel (row-major), packs 8 bits per byte and stops at a
// NUL byte or after `maxChars`. Returns the characters as text with '.' for non-printable bytes.
export function extractLsb(pixels, { channel = 0, lsbFirst = false, maxChars = 64 } = {}) {
  const count = Math.floor(pixels.length / 3);
  let out = '';
  for (let p = 0; p + 8 <= count && out.length < maxChars; p += 8) {
    let byte = 0;
    for (let k = 0; k < 8; k += 1) {
      const bit = pixels[(p + k) * 3 + channel] & 1;
      byte = lsbFirst ? byte | (bit << k) : (byte << 1) | bit;
    }
    if (byte === 0) { break; }
    out += byte >= 32 && byte < 127 ? String.fromCharCode(byte) : '.';
  }
  return out;
}

// RGBA bytes for canvas.putImageData. view: 'color' (as stored), 'plane' (the LSB of one channel as black/white),
// 'amplify' (all LSBs of all channels pushed to 0 or 255).
export function renderPixels(pixels, { view = 'color', channel = 0 } = {}) {
  const count = Math.floor(pixels.length / 3);
  const rgba = new Uint8ClampedArray(count * 4);
  for (let p = 0; p < count; p += 1) {
    const r = pixels[p * 3];
    const g = pixels[p * 3 + 1];
    const b = pixels[p * 3 + 2];
    if (view === 'plane') {
      const v = (pixels[p * 3 + channel] & 1) * 255;
      rgba.set([v, v, v, 255], p * 4);
    } else if (view === 'amplify') {
      rgba.set([(r & 1) * 255, (g & 1) * 255, (b & 1) * 255, 255], p * 4);
    } else {
      rgba.set([r, g, b, 255], p * 4);
    }
  }
  return rgba;
}

// Index of the pixel under a canvas coordinate (for the hover read-out).
export const pixelAt = (x, y, cell, width) => Math.floor(y / cell) * width + Math.floor(x / cell);
