import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assignSeriesStyles, buildChart, findMyStanding, formatTick, hasSolves, isMyTeam,
  leaderboardErrorMessage, niceScale, scoresAt, snapToTime, sortStandings,
} from '../src/pages/leaderboardHelpers.js';
import { startPolling } from '../src/pages/poller.js';

const T0 = Date.UTC(2026, 10, 3, 12, 0, 0);
const iso = (minutes) => new Date(T0 + minutes * 60_000).toISOString();
const timeline = [
  { teamId: 'b', teamName: 'Beta', points: [{ t: iso(0), score: 0 }, { t: iso(10), score: 100 }, { t: iso(40), score: 210 }] },
  { teamId: 'a', teamName: 'Alpha', points: [{ t: iso(0), score: 0 }, { t: iso(20), score: 100 }] },
];

test('standings display by rank and tolerate missing ranks', () => {
  const rows = [
    { rank: 2, teamId: 'b', teamName: 'Beta', points: 100 }, { rank: 1, teamId: 'a', teamName: 'Alpha', points: 100 },
    { teamId: 'z', teamName: 'Zed', points: 5 }, { teamId: 'y', teamName: 'Yak', points: 50 },
  ];
  assert.deepEqual(sortStandings(rows).map((row) => row.teamId), ['a', 'b', 'y', 'z']);
  assert.deepEqual(rows.map((row) => row.teamId), ['b', 'a', 'z', 'y'], 'input is not mutated');
});

test('my team is matched by id only, and only when I have a team', () => {
  const rows = [{ teamId: 'a', teamName: 'Alpha' }, { teamId: 'b', teamName: 'Beta' }];
  assert.equal(findMyStanding(rows, 'b').teamName, 'Beta');
  assert.equal(findMyStanding(rows, 'missing'), null);
  assert.equal(isMyTeam(rows[0], null), false);
  assert.equal(isMyTeam(rows[0], undefined), false);
  assert.equal(isMyTeam({ teamId: 'a' }, 'a'), true);
});

test('chart is empty-safe and solves are detected', () => {
  assert.equal(hasSolves([{ solves: 0 }, { solves: 0 }]), false);
  assert.equal(hasSolves([{ solves: 0 }, { solves: 2 }]), true);
  const empty = buildChart([]);
  assert.equal(empty.series.length, 0);
  assert.ok(empty.tMax > empty.tMin);
  assert.deepEqual(empty.yTicks.map((tick) => tick.value), [0, 25, 50, 75, 100]);
});

test('nice y scales use whole 1/2/5 steps that cover the maximum', () => {
  assert.deepEqual(niceScale(450), { max: 600, step: 200 });
  assert.deepEqual(niceScale(210), { max: 300, step: 100 });
  assert.deepEqual(niceScale(3), { max: 3, step: 1 });
  assert.deepEqual(niceScale(0), { max: 100, step: 25 });
  for (const max of [1, 7, 25, 99, 100, 1234, 98765]) {
    const scale = niceScale(max);
    assert.ok(scale.max >= max && scale.step >= 1 && scale.max % scale.step === 0);
  }
});

test('chart points scale into the plot area, y grows upwards and lines step between solves', () => {
  const chart = buildChart(timeline, { width: 640, height: 300, margin: { top: 10, right: 20, bottom: 30, left: 40 } });
  assert.deepEqual(chart.plot, { left: 40, right: 620, top: 10, bottom: 270 });
  assert.equal(chart.tMin, T0);
  assert.equal(chart.tMax, T0 + 40 * 60_000);
  assert.equal(chart.yMax, 300);
  const beta = chart.series.find((line) => line.teamId === 'b');
  // 580px wide plot over 40 minutes: the solve at minute 10 sits a quarter of the way along.
  assert.deepEqual(beta.points.map((point) => [point.x, point.y]), [[40, 270], [185, 183.33], [620, 88]]);
  assert.equal(beta.path, 'M40,270H185V183.33H620V88');
  // Every point stays inside the plot box.
  for (const line of chart.series) {
    for (const point of line.points) {
      assert.ok(point.x >= chart.plot.left && point.x <= chart.plot.right);
      assert.ok(point.y >= chart.plot.top && point.y <= chart.plot.bottom);
    }
  }
});

test('a line that stops early is extended flat to the right edge and ends with a dot there', () => {
  const chart = buildChart(timeline, { width: 640, height: 300, margin: { top: 10, right: 20, bottom: 30, left: 40 } });
  const alpha = chart.series.find((line) => line.teamId === 'a');
  assert.ok(alpha.path.endsWith(`H${chart.plot.right}`));
  assert.deepEqual(alpha.end, { x: chart.plot.right, y: alpha.points.at(-1).y });
  assert.equal(alpha.score, 100);
});

test('a single moment in time and unsorted or invalid timestamps do not break the chart', () => {
  const flat = buildChart([{ teamId: 'a', teamName: 'Alpha', points: [{ t: iso(5), score: 0 }] }]);
  assert.ok(Number.isFinite(flat.series[0].points[0].x));
  assert.ok(flat.tMax > flat.tMin);
  const messy = buildChart([{ teamId: 'a', teamName: 'Alpha', points: [{ t: iso(9), score: 50 }, { t: 'nonsense', score: 1 }, { t: iso(1), score: 0 }] }]);
  assert.deepEqual(messy.series[0].points.map((point) => point.score), [0, 50]);
  assert.equal(buildChart([{ teamId: 'a', teamName: 'Alpha', points: [{ t: 'nonsense', score: 1 }] }]).series.length, 0);
  assert.equal(buildChart(timeline, { width: 10, height: 10 }).plot.right > 0, true);
});

test('x ticks include both ends and anchor their labels', () => {
  const chart = buildChart(timeline, { xTickCount: 3 });
  assert.deepEqual(chart.xTicks.map((tick) => tick.ms), [T0, T0 + 20 * 60_000, T0 + 40 * 60_000]);
  assert.deepEqual(chart.xTicks.map((tick) => tick.anchor), ['start', 'middle', 'end']);
  assert.equal(chart.xTicks[0].x, chart.plot.left);
  assert.equal(chart.xTicks[2].x, chart.plot.right);
});

test('hover snaps to the nearest solve time and lists every team score at that moment, best first', () => {
  const chart = buildChart(timeline, { width: 640, height: 300 });
  const near = snapToTime(chart, chart.times.find((time) => time.ms === T0 + 20 * 60_000).x + 3);
  assert.equal(near.ms, T0 + 20 * 60_000);
  assert.equal(snapToTime(chart, -500).ms, T0);
  assert.equal(snapToTime(buildChart([]), 10), null);
  assert.deepEqual(scoresAt(chart, T0 + 20 * 60_000).map((row) => [row.teamName, row.score]), [['Alpha', 100], ['Beta', 100]]);
  assert.deepEqual(scoresAt(chart, T0 + 15 * 60_000).map((row) => [row.teamName, row.score]), [['Beta', 100], ['Alpha', 0]]);
  assert.deepEqual(scoresAt(chart, T0 + 45 * 60_000).map((row) => [row.teamName, row.score]), [['Beta', 210], ['Alpha', 100]]);
  assert.equal(scoresAt(chart, T0 - 1).every((row) => row.score === 0 && row.y === chart.plot.bottom), true);
});

test('line colours follow the team, not its rank, and extra teams fall back to dashed neutral lines', () => {
  const teams = Array.from({ length: 10 }, (_, index) => ({ teamId: `team-${String(index).padStart(2, '0')}` }));
  const styles = assignSeriesStyles(teams);
  assert.equal(styles.get('team-00').color, 'var(--lb-series-1)');
  assert.equal(styles.get('team-07').color, 'var(--lb-series-8)');
  assert.equal(styles.get('team-08').color, 'var(--lb-series-other)');
  assert.notEqual(styles.get('team-08').dash, styles.get('team-09').dash);
  assert.ok(styles.get('team-08').dash && styles.get('team-09').dash);
  // The same team keeps its colour whatever order the API lists the teams in.
  const reordered = assignSeriesStyles([...teams].reverse());
  for (const team of teams) assert.deepEqual(reordered.get(team.teamId), styles.get(team.teamId));
  assert.equal(new Set([...styles.values()].filter((style) => style.slot).map((style) => style.slot)).size, 8);
});

test('time ticks switch format by span and honour the time zone', () => {
  const options = { locale: 'en-GB', timeZone: 'UTC' };
  assert.equal(formatTick(T0, 3 * 3_600_000, options), '12:00');
  assert.equal(formatTick(T0 + 5_000, 60_000, options), '12:00:05');
  assert.match(formatTick(T0, 3 * 24 * 3_600_000, options), /3 Nov.*12:00/);
});

test('documented errors map to friendly messages and unknown errors keep the server text', () => {
  assert.match(leaderboardErrorMessage({ code: 'UNAUTHENTICATED' }), /sign in/i);
  assert.match(leaderboardErrorMessage({ code: 'FORBIDDEN' }), /players/i);
  assert.equal(leaderboardErrorMessage({ code: 'WEIRD', message: 'Server says no.' }), 'Server says no.');
  assert.match(leaderboardErrorMessage(undefined), /try again/i);
});

function pollingHarness({ hidden = false } = {}) {
  const listeners = new Set();
  const doc = {
    visibilityState: hidden ? 'hidden' : 'visible',
    addEventListener: (type, fn) => type === 'visibilitychange' && listeners.add(fn),
    removeEventListener: (type, fn) => listeners.delete(fn),
  };
  const timers = new Map();
  let nextId = 1;
  const harness = {
    doc, timers, calls: 0, delays: [],
    schedule: (fn, delay) => { const id = nextId++; timers.set(id, fn); harness.delays.push(delay); return id; },
    cancel: (id) => { timers.delete(id); },
    async fire() { const [[id, fn]] = [...timers]; timers.delete(id); await fn(); },
    setVisible(visible) { doc.visibilityState = visible ? 'visible' : 'hidden'; for (const fn of [...listeners]) fn(); },
    listeners,
  };
  return harness;
}
const flush = () => new Promise((resolve) => setImmediate(resolve));

test('polling runs at once, repeats every 10 s, and stops cleanly', async () => {
  const h = pollingHarness();
  const poller = startPolling(async () => { h.calls += 1; }, { doc: h.doc, schedule: h.schedule, cancel: h.cancel });
  await flush();
  assert.equal(h.calls, 1);
  assert.deepEqual(h.delays, [10_000]);
  await h.fire();
  await h.fire();
  assert.equal(h.calls, 3);
  assert.equal(h.timers.size, 1);
  poller.stop();
  assert.equal(h.timers.size, 0, 'timer cleared on unmount');
  assert.equal(h.listeners.size, 0, 'visibility listener removed on unmount');
});

test('polling pauses while the tab is hidden and refreshes immediately when it returns', async () => {
  const h = pollingHarness();
  startPolling(async () => { h.calls += 1; }, { doc: h.doc, schedule: h.schedule, cancel: h.cancel });
  await flush();
  h.setVisible(false);
  assert.equal(h.timers.size, 0);
  h.setVisible(true);
  await flush();
  assert.equal(h.calls, 2);
  assert.equal(h.timers.size, 1);
});

test('a task finishing while the tab is hidden does not reschedule, and failures keep the schedule alive', async () => {
  const h = pollingHarness();
  let release;
  let fail = false;
  startPolling(() => new Promise((resolve, reject) => { h.calls += 1; release = () => (fail ? reject(new Error('down')) : resolve()); }), { doc: h.doc, schedule: h.schedule, cancel: h.cancel });
  h.setVisible(false);
  release();
  await flush();
  assert.equal(h.timers.size, 0);
  fail = true;
  h.setVisible(true);
  release();
  await flush();
  assert.equal(h.calls, 2);
  assert.equal(h.timers.size, 1, 'a failed poll still schedules the next one');
});

test('requests never overlap and a stopped poller stays stopped', async () => {
  const h = pollingHarness();
  let release;
  const poller = startPolling(() => new Promise((resolve) => { h.calls += 1; release = resolve; }), { doc: h.doc, schedule: h.schedule, cancel: h.cancel });
  await poller.refresh();
  assert.equal(h.calls, 1, 'manual refresh while a request is in flight is ignored');
  poller.stop();
  release();
  await flush();
  assert.equal(h.timers.size, 0);
  await poller.refresh();
  assert.equal(h.calls, 1);
});
