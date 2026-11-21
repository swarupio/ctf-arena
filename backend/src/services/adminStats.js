// Dashboard overview: totals, daily time series, top teams, challenge difficulty and wrong-flag rates, terminal game
// statistics, instances. Aggregations only (no full scans into memory except the capped terminal solve list).
import Challenge from '../models/Challenge.js';
import Instance, { ACTIVE_STATUSES } from '../models/Instance.js';
import Solve from '../models/Solve.js';
import Submission from '../models/Submission.js';
import Team from '../models/Team.js';
import User from '../models/User.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const TERMINAL_SOLVE_CAP = 50000;
const realSolves = { adjustment: { $ne: true } };

export const dockerEnabled = () => String(process.env.DOCKER_ENABLED ?? 'true').toLowerCase() !== 'false';
const round = (value, digits = 4) => Number(value.toFixed(digits));
const rate = (part, whole) => (whole === 0 ? 0 : round(part / whole));

// UTC day keys from `days - 1` days ago to today.
function dayKeys(days, now) {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Array.from({ length: days }, (_, index) => new Date(today - (days - 1 - index) * DAY_MS).toISOString().slice(0, 10));
}

async function perDay(model, field, since, match = {}, extra = {}) {
  const rows = await model.aggregate([
    { $match: { [field]: { $gte: since }, ...match } },
    { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: `$${field}`, timezone: 'UTC' } }, count: { $sum: 1 }, ...extra } },
  ]);
  return new Map(rows.map((row) => [row._id, row]));
}

export async function getTimeSeries({ days = 14, now = new Date() } = {}) {
  const keys = dayKeys(days, now);
  const since = new Date(`${keys[0]}T00:00:00.000Z`);
  const [signups, submissions, solves] = await Promise.all([
    perDay(User, 'createdAt', since),
    perDay(Submission, 'createdAt', since, {}, { wrong: { $sum: { $cond: ['$correct', 0, 1] } } }),
    perDay(Solve, 'solvedAt', since, realSolves),
  ]);
  return {
    days,
    // Submissions expire after 30 days (TTL), so older days of that series are always 0.
    series: keys.map((date) => ({
      date,
      signups: signups.get(date)?.count ?? 0,
      submissions: submissions.get(date)?.count ?? 0,
      wrongSubmissions: submissions.get(date)?.wrong ?? 0,
      solves: solves.get(date)?.count ?? 0,
    })),
  };
}

async function topTeams(limit = 10) {
  const rows = await Solve.aggregate([
    { $group: { _id: '$teamId', score: { $sum: '$points' }, solves: { $sum: { $cond: ['$adjustment', 0, 1] } }, lastSolveAt: { $max: '$solvedAt' } } },
    { $sort: { score: -1, lastSolveAt: 1 } },
    { $limit: limit },
  ]);
  const teams = rows.length ? await Team.find({ _id: { $in: rows.map((row) => row._id) } }, 'name banned').lean() : [];
  const byId = new Map(teams.map((team) => [String(team._id), team]));
  return rows.map((row) => ({
    id: String(row._id),
    name: byId.get(String(row._id))?.name ?? null,
    banned: Boolean(byId.get(String(row._id))?.banned),
    score: row.score,
    solves: row.solves,
  }));
}

async function challengeStats(teamCount) {
  const [challenges, solves, attempts] = await Promise.all([
    Challenge.find({}, 'slug title points difficulty category type visible').lean(),
    Solve.aggregate([{ $match: realSolves }, { $group: { _id: '$challengeId', solves: { $sum: 1 } } }]),
    Submission.aggregate([{ $group: { _id: '$challengeId', submissions: { $sum: 1 }, wrong: { $sum: { $cond: ['$correct', 0, 1] } } } }]),
  ]);
  const solvesBy = new Map(solves.map((row) => [String(row._id), row.solves]));
  const attemptsBy = new Map(attempts.map((row) => [String(row._id), row]));
  const rows = challenges.map((challenge) => {
    const id = String(challenge._id);
    const solved = solvesBy.get(id) ?? 0;
    const tries = attemptsBy.get(id) ?? { submissions: 0, wrong: 0 };
    return {
      id,
      slug: challenge.slug,
      title: challenge.title,
      category: challenge.category,
      difficulty: challenge.difficulty,
      points: challenge.points,
      visible: Boolean(challenge.visible),
      solves: solved,
      solveRate: rate(solved, teamCount),
      submissions: tries.submissions,
      wrongSubmissions: tries.wrong,
      wrongRate: rate(tries.wrong, tries.submissions),
    };
  });
  // Terminal codes are tiny challenges inside one game: ranking them against real challenges would only add noise.
  const ranked = rows.filter((row) => row.category !== 'terminal' && row.visible);
  const hardest = [...ranked].sort((a, b) => a.solveRate - b.solveRate || b.points - a.points || a.slug.localeCompare(b.slug)).slice(0, 5);
  const easiest = [...ranked].sort((a, b) => b.solveRate - a.solveRate || a.points - b.points || a.slug.localeCompare(b.slug)).slice(0, 5);
  const wrongRates = rows
    .filter((row) => row.submissions > 0)
    .sort((a, b) => b.wrongRate - a.wrongRate || b.submissions - a.submissions || a.slug.localeCompare(b.slug))
    .slice(0, 20);
  return { hardest, easiest, wrongRates };
}

// Completions per mode = teams that solved every visible code of the mode. Scores are points per team inside the mode.
async function terminalStats() {
  const codes = await Challenge.find({ type: 'terminal' }, 'terminal visible').lean();
  const visible = codes.filter((code) => code.visible !== false && code.terminal?.mode);
  const modeOf = new Map(visible.map((code) => [String(code._id), code.terminal.mode]));
  const solves = visible.length
    ? await Solve.find({ challengeId: { $in: visible.map((code) => code._id) } }, 'teamId challengeId points').limit(TERMINAL_SOLVE_CAP).lean()
    : [];
  const modes = {};
  for (const mode of new Set(visible.map((code) => code.terminal.mode))) {
    modes[mode] = { codes: visible.filter((code) => code.terminal.mode === mode).length, teams: new Map() };
  }
  for (const solve of solves) {
    const mode = modeOf.get(String(solve.challengeId));
    if (!mode) { continue; }
    const team = modes[mode].teams.get(String(solve.teamId)) ?? { solved: 0, score: 0 };
    team.solved += 1;
    team.score += solve.points;
    modes[mode].teams.set(String(solve.teamId), team);
  }
  const result = Object.entries(modes).map(([mode, data]) => {
    const scores = [...data.teams.values()];
    return {
      mode,
      codes: data.codes,
      teamsPlaying: scores.length,
      completions: scores.filter((team) => team.solved >= data.codes).length,
      averageScore: scores.length ? round(scores.reduce((total, team) => total + team.score, 0) / scores.length, 1) : 0,
      maxScore: scores.reduce((max, team) => Math.max(max, team.score), 0),
    };
  });
  return { modes: result.sort((a, b) => a.mode.localeCompare(b.mode)) };
}

async function instanceStats() {
  const enabled = dockerEnabled();
  return { dockerEnabled: enabled, active: enabled ? await Instance.countDocuments({ status: { $in: ACTIVE_STATUSES } }) : 0 };
}

export async function getOverview({ days = 14, now = new Date() } = {}) {
  const [users, teams, solves, submissions, wrong, bannedUsers, bannedTeams] = await Promise.all([
    User.countDocuments({}),
    Team.countDocuments({}),
    Solve.countDocuments(realSolves),
    Submission.countDocuments({}),
    Submission.countDocuments({ correct: false }),
    User.countDocuments({ banned: true }),
    Team.countDocuments({ banned: true }),
  ]);
  const [timeseries, top, challenges, terminal, instances] = await Promise.all([
    getTimeSeries({ days, now }), topTeams(), challengeStats(teams), terminalStats(), instanceStats(),
  ]);
  return {
    generatedAt: now.toISOString(),
    totals: {
      users, teams, solves, submissions, wrongRate: rate(wrong, submissions), bannedUsers, bannedTeams,
      activeInstances: instances.active,
    },
    days: timeseries.days,
    series: timeseries.series,
    topTeams: top,
    challenges,
    terminal,
    instances,
  };
}
