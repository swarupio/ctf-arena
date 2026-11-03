export const CHART_TEAMS = 10;
export const COLOR_SLOTS = 8;
// Beyond the eight validated hues, extra lines are neutral and told apart by their dash pattern.
const OVERFLOW_DASHES = ['7 4', '2 4'];

// Standings in display order: by rank, falling back to points and name if ranks are missing.
export function sortStandings(rows) {
  return [...rows].sort((a, b) => (
    (a.rank ?? Infinity) - (b.rank ?? Infinity)
    || b.points - a.points
    || String(a.teamName).localeCompare(String(b.teamName))
  ));
}

export const isMyTeam = (row, myTeamId) => Boolean(myTeamId) && String(row.teamId) === String(myTeamId);

export function findMyStanding(rows, myTeamId) {
  return rows.find((row) => isMyTeam(row, myTeamId)) ?? null;
}

export const hasSolves = (rows) => rows.some((row) => row.solves > 0);

const MESSAGES = {
  UNAUTHENTICATED: 'Your session has expired. Sign in again to see the leaderboard.',
  FORBIDDEN: 'The leaderboard is shown to players only.',
};

export function leaderboardErrorMessage(error) {
  return MESSAGES[error?.code] ?? error?.message ?? 'The leaderboard could not be loaded. Please try again.';
}

// Colour follows the team, not its rank: slots are handed out by team id, so a line keeps its
// colour while teams overtake each other. Teams past the eighth get a neutral dashed line.
export function assignSeriesStyles(teams) {
  const styles = new Map();
  [...teams].sort((a, b) => String(a.teamId).localeCompare(String(b.teamId))).forEach((team, index) => {
    styles.set(String(team.teamId), index < COLOR_SLOTS
      ? { slot: index + 1, color: `var(--lb-series-${index + 1})`, dash: '' }
      : { slot: null, color: 'var(--lb-series-other)', dash: OVERFLOW_DASHES[(index - COLOR_SLOTS) % OVERFLOW_DASHES.length] });
  });
  return styles;
}

// 1 / 2 / 5 x 10^n steps, at least 1 because scores are whole numbers.
export function niceScale(max, target = 4) {
  if (!(max > 0)) return { max: 100, step: 25 };
  const raw = max / target;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / magnitude;
  const step = Math.max(1, (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * magnitude);
  return { max: Math.ceil(max / step) * step, step };
}

const round = (value) => Math.round(value * 100) / 100;

// Score lines are steps: a team keeps its score until its next solve.
function stepPath(points, xEnd) {
  const [first, ...rest] = points;
  let path = `M${first.x},${first.y}`;
  let previous = first;
  for (const point of rest) {
    path += `H${point.x}V${point.y}`;
    previous = point;
  }
  if (xEnd > previous.x) path += `H${xEnd}`;
  return path;
}

// Turns the timeline response into SVG coordinates. Pure: no DOM, no clock.
export function buildChart(teams, {
  width = 600, height = 300, margin = { top: 12, right: 16, bottom: 28, left: 44 }, xTickCount = 5,
} = {}) {
  const plot = {
    left: margin.left, right: Math.max(width - margin.right, margin.left + 1),
    top: margin.top, bottom: Math.max(height - margin.bottom, margin.top + 1),
  };
  const lines = teams.map((team) => ({
    teamId: String(team.teamId),
    teamName: team.teamName,
    points: team.points
      .map((point) => ({ ms: Date.parse(point.t), score: point.score }))
      .filter((point) => Number.isFinite(point.ms))
      .sort((a, b) => a.ms - b.ms),
  })).filter((line) => line.points.length > 0);

  const allTimes = lines.flatMap((line) => line.points.map((point) => point.ms));
  const tMin = allTimes.length ? Math.min(...allTimes) : 0;
  const tMax = allTimes.length && Math.max(...allTimes) > tMin ? Math.max(...allTimes) : tMin + 60_000;
  const maxScore = Math.max(0, ...lines.flatMap((line) => line.points.map((point) => point.score)));
  const scale = niceScale(maxScore);

  const xOf = (ms) => round(plot.left + ((ms - tMin) / (tMax - tMin)) * (plot.right - plot.left));
  const yOf = (score) => round(plot.bottom - (score / scale.max) * (plot.bottom - plot.top));

  const yTicks = [];
  for (let value = 0; value <= scale.max; value += scale.step) yTicks.push({ value, y: yOf(value) });
  const count = Math.max(2, xTickCount);
  const xTicks = Array.from({ length: count }, (_, index) => {
    const ms = tMin + ((tMax - tMin) * index) / (count - 1);
    return { ms, x: xOf(ms), anchor: index === 0 ? 'start' : index === count - 1 ? 'end' : 'middle' };
  });

  const series = lines.map((line) => {
    const points = line.points.map((point) => ({ ...point, x: xOf(point.ms), y: yOf(point.score) }));
    const last = points[points.length - 1];
    return {
      teamId: line.teamId,
      teamName: line.teamName,
      score: last.score,
      points,
      path: stepPath(points, plot.right),
      end: { x: plot.right, y: last.y },
    };
  });
  const times = [...new Set(allTimes)].sort((a, b) => a - b).map((ms) => ({ ms, x: xOf(ms) }));

  return { width, height, plot, tMin, tMax, yMax: scale.max, yTicks, xTicks, series, times };
}

// The data position nearest to a pointer x, so a crosshair snaps to a real solve time.
export function snapToTime(chart, x) {
  let nearest = null;
  for (const time of chart.times) {
    if (nearest === null || Math.abs(time.x - x) < Math.abs(nearest.x - x)) nearest = time;
  }
  return nearest;
}

// Every plotted team's score (and its chart y) at a moment, best first: what the hover readout lists.
export function scoresAt(chart, ms) {
  return chart.series.map((line) => {
    let score = 0;
    let y = chart.plot.bottom;
    for (const point of line.points) {
      if (point.ms <= ms) { score = point.score; y = point.y; }
    }
    return { teamId: line.teamId, teamName: line.teamName, score, y };
  }).sort((a, b) => b.score - a.score || a.teamName.localeCompare(b.teamName));
}

export function formatTick(ms, spanMs, { locale, timeZone } = {}) {
  const options = spanMs >= 24 * 3_600_000
    ? { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }
    : { hour: '2-digit', minute: '2-digit', ...(spanMs < 600_000 ? { second: '2-digit' } : {}), hour12: false };
  return new Intl.DateTimeFormat(locale, { ...options, timeZone }).format(new Date(ms));
}
