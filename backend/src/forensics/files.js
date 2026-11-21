// File artefacts: a hex-viewable image with appended data, an EXIF-like metadata table, LSB steganography pixel grids
// and a virtual disk with deleted files. Each artefact is small (a few KB) and generated on demand from the seed.
import { int, pick } from '../terminal/gen.js';
import { WORDS, pageBounds, rngFor } from './core.js';

export const HEX_PAGE_MAX = 1024;
export const CLUSTER_SIZE = 128;
export const CLUSTER_COUNT = 256;
export const CLUSTERS_PER_REQUEST = 8;
export const STEGO_IMAGES = 4;

const b64 = (text) => Buffer.from(text, 'utf8').toString('base64');
const hexText = (text) => Buffer.from(text, 'utf8').toString('hex');

// ---- hex editor file -------------------------------------------------------------------------------------
export function hexFileBytes(seed, scn) {
  const r = rngFor(seed, 'hexfile');
  const comment = Buffer.from('Created with PicTool 2.1', 'latin1');
  const scan = Buffer.from(Array.from({ length: 1100 + int(r, 0, 200) }, () => int(r, 0, 254)));
  const tail = Buffer.from(`\r\n--tail--\r\n${b64(`passphrase: ${scn.hexPass}`)}\r\n`, 'latin1');
  return Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from('JFIF\0', 'latin1'), Buffer.from([1, 1, 0, 0, 1, 0, 1, 0, 0]),
    Buffer.from([0xff, 0xfe, 0x00, comment.length + 2]), comment, scan, Buffer.from([0xff, 0xd9]), tail,
  ]);
}

export function hexFilePage(seed, scn, offset, limit) {
  const bytes = hexFileBytes(seed, scn);
  const { start, size } = pageBounds(bytes.length, offset, limit, HEX_PAGE_MAX);
  return { name: 'evidence_a.jpg', size: bytes.length, offset: start, hex: bytes.subarray(start, start + size).toString('hex') };
}

// ---- metadata table --------------------------------------------------------------------------------------
export function exifTable(seed, scn) {
  const r = rngFor(seed, 'exif');
  const decoy = `${pick(r, WORDS)}${int(r, 10, 99)}`;
  return {
    name: 'evidence_b.jpg',
    tags: [
      { tag: 'Make', value: 'Nikkon' },
      { tag: 'Model', value: `D${int(r, 3000, 7500)}` },
      { tag: 'Software', value: pick(r, ['PicTool 2.1', 'GIMPish 3.0', 'Lumen 11.4']) },
      { tag: 'Artist', value: decoy },
      { tag: 'Copyright', value: `(c) ${pick(r, WORDS)} studio` },
      { tag: 'DateTimeOriginal', value: '2026:03:09 17:42:11' },
      { tag: 'ModifyDate', value: '2026:03:13 23:58:02' },
      { tag: 'ImageDescription', value: 'Quarterly report, page 1 (scan)' },
      { tag: 'GPSLatitude', value: `${int(r, 30, 60)}.${int(r, 1000, 9999)} N` },
      { tag: 'GPSLongitude', value: `${int(r, 1, 20)}.${int(r, 1000, 9999)} W` },
      { tag: 'ExposureTime', value: '1/125' },
      { tag: 'FNumber', value: '5.6' },
      { tag: 'ISO', value: String(pick(r, [100, 200, 400])) },
      { tag: 'MakerNote', value: b64(`serial: ${int(r, 100000, 999999)}`) },
      { tag: 'UserComment', value: `0x${hexText(`handle: ${scn.handle}`)}` },
      { tag: 'LensModel', value: '50mm f/1.8' },
    ],
  };
}

// ---- LSB pixel grids -------------------------------------------------------------------------------------
export const stegoSize = (level) => (level === 'insane' ? 40 : 32);

export function stegoMessage(scn, level, image) {
  if (level !== 'insane') { return `KEY=${scn.stegoKey}`; }
  return image === scn.imageNo ? `KEY=${scn.stegoKey}` : `VOID=${WORDS[(image * 37 + scn.imageNo) % WORDS.length]}-${image * 111}`;
}

// Hidden bits live in the least significant bit of one channel (scn.stegoChannel), row by row, one byte per 8 pixels,
// ending with a NUL byte. The other channels carry random LSBs.
export function stegoImage(seed, scn, level, image = 1) {
  const size = stegoSize(level);
  const r = rngFor(seed, `stego:${image}`);
  const channel = (scn.stegoChannel + (level === 'insane' ? image : 0)) % 3;
  const message = Buffer.concat([Buffer.from(stegoMessage(scn, level, image), 'latin1'), Buffer.from([0])]);
  const bits = [];
  for (const byte of message) {
    for (let k = 0; k < 8; k += 1) { bits.push(scn.stegoLsbFirst ? (byte >> k) & 1 : (byte >> (7 - k)) & 1); }
  }
  const pixels = Buffer.alloc(size * size * 3);
  for (let p = 0; p < size * size; p += 1) {
    const x = p % size;
    const y = Math.floor(p / size);
    const base = [60 + Math.floor((x / size) * 120), 50 + Math.floor((y / size) * 130), 140 + int(r, 0, 60)];
    for (let c = 0; c < 3; c += 1) {
      const value = (base[c] & 0xfe) | (r() < 0.5 ? 1 : 0);
      pixels[p * 3 + c] = c === channel && p < bits.length ? (value & 0xfe) | bits[p] : value;
    }
  }
  return {
    image, images: level === 'insane' ? STEGO_IMAGES : 1, width: size, height: size, pixels: pixels.toString('base64'),
    encoding: 'rgb-base64',
  };
}

// ---- virtual disk ----------------------------------------------------------------------------------------
const DISK = { hard: { live: 19, junk: 4 }, insane: { live: 31, junk: 8 } };
const LIVE_NAMES = ['notes', 'budget', 'schedule', 'readme', 'draft', 'todo', 'minutes', 'inventory'];
const LIVE_EXT = ['.txt', '.csv', '.md', '.log'];
const FILE_STEMS = ['customer', 'payroll', 'invoices', 'roadmap', 'contracts', 'ledger'];
const pad = (text) => Buffer.concat([Buffer.from(text, 'latin1'), Buffer.alloc(CLUSTER_SIZE * 3)]);

const mtime = (r, day) => `2026-03-${String(day).padStart(2, '0')} ${String(int(r, 7, 21)).padStart(2, '0')}:${String(int(r, 0, 59)).padStart(2, '0')}`;

// Entries plus the cluster map. Entry order is shuffled with the seed, so the answer is never at a fixed row.
export function diskPlan(seed, scn, level) {
  const cfg = DISK[level] ?? DISK.hard;
  const r = rngFor(seed, 'disk');
  const insane = level === 'insane';
  const files = [];
  for (let k = 0; k < cfg.live; k += 1) {
    const name = `${pick(r, LIVE_NAMES)}_${pick(r, WORDS)}${pick(r, LIVE_EXT)}`;
    files.push({ name, deleted: false, mtime: mtime(r, int(r, 1, 12)), text: `${name}\n${pick(r, WORDS)} ${pick(r, WORDS)} ${pick(r, WORDS)} ${int(r, 10, 99)}\n` });
  }
  // Deleted decoys: believable notes with look-alike tokens (and one whose clusters were overwritten).
  for (let k = 0; k < cfg.junk; k += 1) {
    const token = `${int(r, 0x1000, 0xffff).toString(16)}-${int(r, 0x1000, 0xffff).toString(16)}`;
    const name = insane
      ? `_${pick(r, FILE_STEMS)}_${pick(r, WORDS)}.tar.gz`
      : `_${pick(r, ['plan', 'memo', 'draft', 'lunch'])}_${pick(r, WORDS)}.txt`;
    files.push({
      name, deleted: true, overwritten: k === 0, mtime: mtime(r, int(r, 2, insane ? 13 : 12)),
      text: `-- scratch --\nTOKEN=${token}\n${insane ? `IMG=img-${int(r, 1, STEGO_IMAGES)}\n` : ''}${pick(r, WORDS)} ${pick(r, WORDS)}\n`,
    });
  }
  const goodName = insane ? `_${scn.exfilFile.slice(1)}` : `_plan_${scn.handle.replace(/\d+$/, '')}.txt`;
  files.push({
    name: goodName, deleted: true, mtime: insane ? mtime(r, 10) : '2026-03-13 23:41',
    text: `-- scratch --\nTOKEN=${scn.deletedToken}\n${insane ? `IMG=img-${scn.imageNo}\n` : ''}burn after reading\n`,
  });
  // Deterministic shuffle (Fisher-Yates driven by r).
  for (let i = files.length - 1; i > 0; i -= 1) {
    const j = int(r, 0, i);
    [files[i], files[j]] = [files[j], files[i]];
  }
  const clusters = new Map();
  let cursor = int(r, 2, 6);
  const entries = files.map((file, index) => {
    const data = pad(file.text);
    const size = file.text.length;
    const count = Math.max(1, Math.ceil(size / CLUSTER_SIZE));
    const start = cursor;
    for (let c = 0; c < count; c += 1) {
      const chunk = data.subarray(c * CLUSTER_SIZE, (c + 1) * CLUSTER_SIZE);
      clusters.set(start + c, file.overwritten ? Buffer.from(Array.from({ length: CLUSTER_SIZE }, () => int(r, 0, 255))) : chunk);
    }
    cursor += count + int(r, 0, 2);
    return { inode: 100 + index, name: file.name, size, mtime: file.mtime, deleted: file.deleted, cluster: start };
  });
  return { entries, clusters, goodName };
}

export function diskListing(seed, scn, level) {
  const { entries } = diskPlan(seed, scn, level);
  return { clusterSize: CLUSTER_SIZE, clusterCount: CLUSTER_COUNT, entries };
}

export function diskClusters(seed, scn, level, first, count) {
  const { clusters } = diskPlan(seed, scn, level);
  const start = Math.min(Math.max(first, 0), CLUSTER_COUNT - 1);
  const size = Math.max(1, Math.min(count, CLUSTERS_PER_REQUEST, CLUSTER_COUNT - start));
  const rows = [];
  for (let n = start; n < start + size; n += 1) {
    const r = rngFor(seed, `fill:${n}`);
    const filler = Buffer.alloc(CLUSTER_SIZE);
    if (r() < 0.3) { for (let i = 0; i < CLUSTER_SIZE; i += 1) { filler[i] = r() < 0.15 ? int(r, 32, 126) : 0; } }
    rows.push({ n, hex: (clusters.get(n) ?? filler).toString('hex') });
  }
  return { clusters: rows };
}
