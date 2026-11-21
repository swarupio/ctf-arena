// Procedural "photographs" for OSINT Trail: a few dozen vector shapes drawn from the landmark kind, never a bitmap.
// Pure and deterministic: the same rng gives the same picture on every replica. The browser draws the shapes as SVG
// elements (no markup is ever sent), so a scene can carry text but never script.
import { int, pick } from '../terminal/gen.js';

export const SCENE_W = 320;
export const SCENE_H = 200;

const SKY = { night: '#16213a', morning: '#a9d6f2', afternoon: '#7ec3ee', evening: '#f0a35e' };
const GROUND = { night: '#26332b', morning: '#6f9a5b', afternoon: '#5f9450', evening: '#7a7a4c' };
const WALLS = ['#d9c7a3', '#c9b79c', '#e2d6bd', '#bfae94', '#cdbba0'];
const ROOFS = ['#8a3b2e', '#5b4a3a', '#3f5a6b', '#6e4f7a'];
const SHIRTS = ['#c0392b', '#2e86c1', '#28b463', '#d4ac0d', '#8e44ad', '#e67e22'];

export const todOf = (hour) => (hour < 6 || hour >= 21 ? 'night' : hour < 11 ? 'morning' : hour < 17 ? 'afternoon' : 'evening');

const R = (x, y, w, h, f) => ({ t: 'r', x, y, w, h, f });
const C = (x, y, r, f) => ({ t: 'c', x, y, r, f });
const P = (pts, f) => ({ t: 'p', pts, f });
const L = (x1, y1, x2, y2, s, w = 2) => ({ t: 'l', x1, y1, x2, y2, s, w });
const T = (x, y, s, sz, f, anchor = 'middle') => ({ t: 't', x, y, s, sz, f, anchor });

// Each drawer returns shapes for one landmark silhouette on a 320 x 200 canvas (ground line at y = 150).
const DRAW = {
  tower: (c) => [
    R(130, 40, 60, 110, c.wall), P('120,40 160,6 200,40', c.roof), C(160, 72, 17, '#fff8e0'),
    L(160, 72, 160, 60, '#222', 2), L(160, 72, 169, 72, '#222', 2), R(150, 118, 20, 32, '#4a3426'),
  ],
  pier: (c) => [
    R(0, 118, 320, 82, '#2f6f9f'), R(30, 128, 260, 10, c.wood), R(40, 138, 8, 40, c.wood), R(110, 138, 8, 40, c.wood),
    R(180, 138, 8, 40, c.wood), R(250, 138, 8, 40, c.wood), R(260, 96, 4, 32, '#333'), C(262, 92, 6, '#ffe9a0'),
    L(40, 160, 300, 160, '#4f90bd', 2),
  ],
  shop: (c) => [
    R(70, 70, 180, 80, c.wall), P('62,70 258,70 244,50 76,50', c.roof), R(100, 96, 40, 54, '#3b2a20'),
    R(160, 92, 70, 40, '#9fd0e8'), R(106, 58, 108, 14, '#fff3d0'), P('70,92 250,92 262,106 58,106', '#c0392b'),
  ],
  park: () => [
    R(90, 100, 8, 50, '#5a3d28'), C(94, 88, 30, '#2f7d3a'), R(220, 108, 8, 42, '#5a3d28'), C(224, 94, 26, '#3a8f45'),
    R(140, 134, 56, 6, '#7a5c3e'), R(144, 140, 4, 12, '#333'), R(188, 140, 4, 12, '#333'), R(140, 122, 56, 5, '#7a5c3e'),
  ],
  columns: (c) => [
    R(60, 56, 200, 12, c.roof), P('60,56 160,22 260,56', c.wall), R(70, 68, 180, 82, c.wall),
    ...[0, 1, 2, 3, 4].map((i) => R(84 + i * 36, 74, 12, 66, '#f1ead8')), R(60, 140, 200, 10, '#aaa'),
  ],
  station: (c) => [
    R(40, 76, 240, 74, c.wall), P('30,76 290,76 270,52 50,52', c.roof), C(160, 64, 13, '#fff8e0'),
    L(160, 64, 160, 55, '#222', 2), L(160, 64, 167, 64, '#222', 2), R(60, 150, 200, 6, '#777'),
    L(20, 176, 300, 176, '#555', 3), L(20, 186, 300, 186, '#555', 3),
  ],
  bridge: (c) => [
    R(0, 128, 320, 72, '#2f6f9f'), R(10, 106, 300, 12, c.wood), R(50, 118, 12, 50, '#777'), R(154, 118, 12, 50, '#777'),
    R(258, 118, 12, 50, '#777'), L(10, 106, 10, 80, '#555', 3), L(310, 106, 310, 80, '#555', 3),
    P('10,106 90,70 160,60 230,70 310,106', 'none'),
  ],
  market: () => [
    ...[0, 1, 2].flatMap((i) => [R(34 + i * 92, 96, 76, 54, '#b99a6b'), P(`${28 + i * 92},96 ${116 + i * 92},96 ${108 + i * 92},76 ${36 + i * 92},76`, i % 2 ? '#c0392b' : '#2e86c1')]),
  ],
  chapel: (c) => [
    R(110, 80, 100, 70, c.wall), P('100,80 160,40 220,80', c.roof), R(146, 14, 28, 30, c.wall), P('144,14 160,-8 176,14', c.roof),
    L(160, -2, 160, 6, '#222', 2), R(148, 108, 24, 42, '#4a3426'),
  ],
  dome: (c) => [
    R(100, 86, 120, 64, c.wall), C(160, 86, 44, '#9aa7b5'), R(116, 86, 88, 4, '#7a8795'), R(156, 56, 8, 30, '#212b36'),
  ],
  lighthouse: () => [
    P('140,150 180,150 172,50 148,50', '#f2f2f2'), P('145,120 175,120 177,100 143,100', '#c0392b'), P('150,84 170,84 172,66 148,66', '#c0392b'),
    R(146, 38, 28, 14, '#ffe9a0'), P('142,38 160,22 178,38', '#333'), R(0, 150, 320, 50, '#2f6f9f'),
  ],
};

// opts: { draw, hour, people, signs (array of 'Street / Street' strings) }
export function sceneFor(r, { draw, hour, people = 0, signs = [] }) {
  const tod = todOf(hour);
  const colours = { wall: pick(r, WALLS), roof: pick(r, ROOFS), wood: pick(r, ['#8b6b4a', '#7a5c3e']) };
  const shapes = [R(0, 0, SCENE_W, SCENE_H, SKY[tod]), R(0, 150, SCENE_W, 50, GROUND[tod])];
  shapes.push(tod === 'night' ? C(int(r, 30, 90), 30, 12, '#f4f1de') : C(int(r, 30, 90), 34, 14, tod === 'evening' ? '#ffb347' : '#fff3a8'));
  shapes.push(C(int(r, 200, 280), 28, 14, tod === 'night' ? '#2a3550' : '#ffffff'), C(int(r, 220, 300), 34, 10, tod === 'night' ? '#2a3550' : '#ffffff'));
  shapes.push(...DRAW[draw](colours));
  for (let i = 0; i < people; i += 1) {
    const x = 30 + i * 46 + int(r, 0, 14);
    shapes.push(R(x, 160, 12, 26, pick(r, SHIRTS)), C(x + 6, 154, 6, '#e8c9a0'));
  }
  if (signs.length > 0) {
    const [first, second = ''] = String(signs[0]).split(' / ');
    shapes.push(R(292, 108, 4, 52, '#555555'), R(236, 98, 84, 28, '#1f6f4a'), T(278, 110, first, 8, '#ffffff'), T(278, 121, second, 8, '#ffffff'));
  }
  return { w: SCENE_W, h: SCENE_H, tod, shapes };
}

export const DRAW_KEYS = Object.keys(DRAW);
