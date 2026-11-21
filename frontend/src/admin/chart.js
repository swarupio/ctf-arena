// Scale maths for the hand-written SVG charts. No DOM, no React.

// Smallest "nice" maximum (1, 2, 5 times a power of ten) that holds `value`.
export function niceMax(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 1;
  const exponent = 10 ** Math.floor(Math.log10(number));
  const fraction = number / exponent;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return nice * exponent;
}

// Evenly spaced ticks from 0 to the nice maximum.
export function yTicks(maxValue, count = 4) {
  const top = niceMax(maxValue);
  const steps = Math.max(1, Math.floor(count));
  return Array.from({ length: steps + 1 }, (_, index) => (top / steps) * index);
}

// Linear map from a domain to a range (the range may run backwards for SVG y).
export function linearScale([d0, d1], [r0, r1]) {
  const span = d1 - d0;
  return (value) => (span === 0 ? (r0 + r1) / 2 : r0 + ((value - d0) / span) * (r1 - r0));
}

export const round = (number) => Math.round(number * 10) / 10;

// Plot area inside the SVG box.
export function plotArea(width, height, margin = { top: 12, right: 12, bottom: 28, left: 40 }) {
  return {
    left: margin.left,
    top: margin.top,
    right: Math.max(margin.left + 1, width - margin.right),
    bottom: Math.max(margin.top + 1, height - margin.bottom),
  };
}

// x pixel of point `index` of `count` points spread over the plot (a single point sits in the middle).
export function xAt(index, count, area) {
  return count <= 1 ? (area.left + area.right) / 2 : area.left + (index / (count - 1)) * (area.right - area.left);
}

export function maxOf(rows, keys) {
  let max = 0;
  for (const row of rows) for (const key of keys) max = Math.max(max, Number(row[key]) || 0);
  return max;
}

// Everything a line chart needs: nice y ticks, point coordinates and an SVG path per series.
export function lineChartModel(rows, keys, { width, height, margin } = {}) {
  const area = plotArea(width, height, margin);
  const top = niceMax(maxOf(rows, keys));
  const y = linearScale([0, top], [area.bottom, area.top]);
  const xs = rows.map((_, index) => xAt(index, rows.length, area));
  const series = keys.map((key) => {
    const points = rows.map((row, index) => ({ x: xs[index], y: y(Number(row[key]) || 0), value: Number(row[key]) || 0 }));
    const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${round(point.x)} ${round(point.y)}`).join(' ');
    return { key, points, path };
  });
  const ticks = yTicks(top).map((value) => ({ value, y: y(value) }));
  return { area, top, xs, series, ticks };
}

// Index of the point whose x is closest to `px` (for hover), or -1 for no points.
export function nearestIndex(px, xs) {
  let best = -1;
  let distance = Infinity;
  xs.forEach((x, index) => {
    const gap = Math.abs(x - px);
    if (gap < distance) { distance = gap; best = index; }
  });
  return best;
}

// Which x labels to print so they never overlap: about one per `minGap` pixels, always including the last point.
export function labelIndexes(count, areaWidth, minGap = 56) {
  if (count <= 0) return [];
  const fit = Math.max(1, Math.floor(areaWidth / minGap));
  const step = Math.max(1, Math.ceil(count / fit));
  const indexes = [];
  for (let index = count - 1; index >= 0; index -= step) indexes.unshift(index);
  return indexes;
}

// Horizontal bars: pixel width of each bar for a given full width (a non-zero value is at least 2 px).
export function barWidths(values, width) {
  const top = niceMax(Math.max(0, ...values.map((value) => Number(value) || 0)));
  return values.map((value) => {
    const number = Number(value) || 0;
    return number <= 0 ? 0 : Math.max(2, Math.round((number / top) * width));
  });
}

export const sumSeries = (rows, key) => rows.reduce((sum, row) => sum + (Number(row[key]) || 0), 0);
