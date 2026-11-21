import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_NOTES, addFreeNote, describeOsintError, formatStamp, gpsToXY, highlightParts, isPinned, latLonToXY, loadNotes, minutesBetween,
  nextOpenQuestion, parseStamp, pinItem, pointFromClick, progressPercent, removeNote, safeColour, saveNotes, sceneShapes, toCell, xyToLatLon,
} from '../src/osint/helpers.js';

const BOUNDS = { south: 0.5, north: 0.6, west: 0.5, east: 0.6 };
const memory = () => {
  const map = new Map();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => { map.set(k, v); }, map };
};

test('time stamps convert by instant, not by wall clock', () => {
  const stamp = '2031-03-14T22:10:00-05:00';
  assert.equal(formatStamp(stamp, 'utc'), '2031-03-15 03:10:00 UTC');
  assert.equal(formatStamp(stamp, 'local'), '2031-03-14 22:10 (UTC-05:00)');
  assert.equal(formatStamp('2031-03-14T05:30:00+05:30', 'utc'), '2031-03-14 00:00:00 UTC');
  assert.equal(formatStamp('not a date'), 'not a date');
  assert.equal(parseStamp('2031-03-14T22:10:00'), null);
  // same clock face, different zones: three hours apart in real time
  assert.equal(minutesBetween('2031-03-14T10:00:00+00:00', '2031-03-14T10:00:00-03:00'), 180);
  assert.equal(minutesBetween('2031-03-14T10:00:00+00:00', 'x'), null);
});

test('grid cells, survey coordinates and clicks agree with each other', () => {
  assert.equal(toCell(0, 0), 'A1');
  assert.equal(toCell(999, 999), 'H8');
  assert.equal(toCell(124, 125), 'A2');
  assert.equal(toCell(500, 500), 'E5');
  assert.equal(toCell(-5, 5000), 'A8');
  assert.deepEqual(latLonToXY('0.55000', '0.55000', BOUNDS), { x: 500, y: 500 });
  assert.deepEqual(latLonToXY('0.60000', '0.50000', BOUNDS), { x: 0, y: 0 });
  assert.equal(latLonToXY('0.7', '0.55', BOUNDS), null);
  assert.equal(latLonToXY('abc', '0.55', BOUNDS), null);
  assert.deepEqual(xyToLatLon(500, 500, BOUNDS), { lat: '0.55000', lon: '0.55000' });
  assert.deepEqual(gpsToXY({ GPSLatitude: '0.55000', GPSLongitude: '0.55000' }, BOUNDS), { x: 500, y: 500 });
  assert.equal(gpsToXY({}, BOUNDS), null);
  assert.deepEqual(pointFromClick({ left: 10, top: 20, width: 500, height: 500 }, 260, 270), { x: 500, y: 500 });
  assert.deepEqual(pointFromClick({ left: 0, top: 0, width: 100, height: 100 }, 500, -5), { x: 1000, y: 0 });
  assert.equal(pointFromClick({ left: 0, top: 0, width: 0, height: 0 }, 1, 1), null);
});

test('scene shapes are validated before they are drawn', () => {
  assert.equal(safeColour('#aabbcc'), '#aabbcc');
  assert.equal(safeColour('url(javascript:alert(1))'), '#888888');
  assert.equal(safeColour('red"/><script>'), '#888888');
  assert.equal(safeColour('none'), 'none');
  const shapes = sceneShapes({
    shapes: [
      { t: 'r', x: 1, y: 2, w: 3, h: 4, f: '#fff' },
      { t: 'p', pts: '1,2 3,4 5,6', f: '#000' },
      { t: 'p', pts: '1,2" onload="x', f: '#000' },
      { t: 'x', foo: 1 },
      { t: 't', x: 5, y: 6, s: '<b>sign</b>', sz: 8, f: 'javascript:1', anchor: 'weird' },
    ],
  });
  assert.deepEqual(shapes.map((s) => s.t), ['r', 'p', 't']);
  assert.equal(shapes[2].f, '#ffffff');
  assert.equal(shapes[2].anchor, 'middle');
  assert.equal(shapes[2].s, '<b>sign</b>'); // kept as text: React escapes it
  assert.equal(sceneShapes({ shapes: Array.from({ length: 500 }, () => ({ t: 'c', x: 1, y: 1, r: 1, f: '#fff' })) }).length, 80);
  assert.deepEqual(sceneShapes(null), []);
});

test('the notebook pins once, keeps notes, survives bad storage and has a size limit', () => {
  let notes = [];
  notes = pinItem(notes, { source: 'feed', id: 'p001', title: 'A post', text: '  Lunch   at the pier ' }, 1);
  notes = pinItem(notes, { source: 'feed', id: 'p001', title: 'A post', text: 'again' }, 2);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].text, 'Lunch at the pier');
  assert.equal(isPinned(notes, 'feed', 'p001'), true);
  assert.equal(isPinned(notes, 'feed', 'p002'), false);
  notes = addFreeNote(notes, '   ', 3);
  assert.equal(notes.length, 1);
  notes = addFreeNote(notes, 'Check the pier cell', 4);
  assert.equal(notes[0].kind, 'note');
  const storage = memory();
  assert.equal(saveNotes(storage, 'easy', notes), true);
  assert.deepEqual(loadNotes(storage, 'easy'), notes);
  assert.deepEqual(loadNotes(storage, 'hard'), []);
  storage.setItem('osint-notes:easy', '{not json');
  assert.deepEqual(loadNotes(storage, 'easy'), []);
  storage.setItem('osint-notes:easy', JSON.stringify([{ id: 5 }, { id: 'a', kind: 'evil', text: 'x' }, { id: 'ok', kind: 'note', text: 'y'.repeat(900) }]));
  const cleaned = loadNotes(storage, 'easy');
  assert.equal(cleaned.length, 1);
  assert.equal(cleaned[0].text.length, 400);
  assert.deepEqual(removeNote(notes, notes[0].id).length, 1);
  let full = [];
  for (let i = 0; i < MAX_NOTES + 20; i += 1) { full = pinItem(full, { source: 'docs', id: `d${i}`, title: 't', text: 'x' }, i); }
  assert.equal(full.length, MAX_NOTES);
  assert.equal(saveNotes({ setItem() { throw new Error('quota'); } }, 'easy', notes), false);
  assert.deepEqual(loadNotes(null, 'easy'), []);
});

test('search highlighting splits text without building HTML', () => {
  const parts = highlightParts('Coffee run at the Saltgrass Pier', 'saltgrass pier');
  assert.deepEqual(parts.filter((p) => p.hit).map((p) => p.text), ['Saltgrass', 'Pier']);
  assert.equal(parts.map((p) => p.text).join(''), 'Coffee run at the Saltgrass Pier');
  assert.deepEqual(highlightParts('abc', 'x'), [{ text: 'abc', hit: false }]);
  assert.deepEqual(highlightParts('abc', ''), [{ text: 'abc', hit: false }]);
  assert.equal(highlightParts('<b>x</b>', 'b').some((p) => p.text.includes('<')), true);
});

test('messages, progress and the next open question', () => {
  assert.match(describeOsintError({ code: 'OSINT_NOT_SEEDED' }), /seed:osint/);
  assert.match(describeOsintError({ code: 'STAGE_LOCKED' }), /final/);
  assert.match(describeOsintError({ status: 429 }), /Too many attempts/);
  assert.match(describeOsintError({ code: 'NO_TEAM' }), /team/);
  assert.equal(describeOsintError({ message: 'boom' }), 'boom');
  assert.equal(describeOsintError(null), 'Something went wrong. Try again.');
  assert.equal(progressPercent(1, 4), 25);
  assert.equal(progressPercent(5, 4), 100);
  assert.equal(progressPercent(0, 0), 0);
  const questions = [
    { n: 1, title: 'A', solved: true, locked: false },
    { n: 2, title: 'B', solved: false, locked: false },
    { n: 3, title: 'Final', solved: false, locked: true, final: true },
  ];
  assert.equal(nextOpenQuestion(questions), 'question 2: B');
  assert.equal(nextOpenQuestion([{ n: 1, title: 'A', solved: true }]), null);
  assert.equal(nextOpenQuestion([{ n: 3, title: 'Final', final: true, solved: false, locked: false }]), 'the final question: Final');
});
