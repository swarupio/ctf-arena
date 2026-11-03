import { Router } from 'express';
import { auth } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import Solve from '../models/Solve.js';
import Team from '../models/Team.js';

const router = Router();

// Player auth required for leaderboard
router.use(auth, requireRole('player'));

/**
 * GET /api/leaderboard
 * Returns ranked list of unbanned teams by points desc, latest solve asc
 */
router.get('/', async (req, res) => {
  let solveAggregates = [];
  try {
    solveAggregates = await Solve.aggregate([
      {
        $group: {
          _id: '$teamId',
          points: { $sum: '$points' },
          solves: { $sum: 1 },
          lastSolveAt: { $max: '$solvedAt' },
        },
      },
      { $sort: { points: -1, lastSolveAt: 1 } },
      {
        $lookup: {
          from: 'teams',
          localField: '_id',
          foreignField: '_id',
          as: 'team',
        },
      },
      { $unwind: '$team' },
      { $match: { 'team.banned': false } },
    ]);
  } catch {
    solveAggregates = [];
  }

  const teamsWithSolvesMap = new Set(solveAggregates.map((s) => String(s._id)));

  // Fetch all unbanned teams to append teams with 0 solves
  let allActiveTeams = [];
  try {
    allActiveTeams = await Team.find({ banned: false }).select('name createdAt');
  } catch {
    allActiveTeams = [];
  }

  const zeroSolveTeams = allActiveTeams
    .filter((team) => !teamsWithSolvesMap.has(String(team._id)))
    .map((team) => ({
      teamId: String(team._id),
      teamName: team.name,
      points: 0,
      solves: 0,
      lastSolveAt: null,
      createdAt: team.createdAt,
    }))
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  const rankedSolvers = solveAggregates.map((entry) => ({
    teamId: String(entry.team._id),
    teamName: entry.team.name,
    points: entry.points,
    solves: entry.solves,
    lastSolveAt: entry.lastSolveAt,
  }));

  const fullList = [...rankedSolvers, ...zeroSolveTeams];

  const leaderboard = fullList.map((entry, index) => ({
    rank: index + 1,
    teamId: entry.teamId,
    teamName: entry.teamName,
    points: entry.points,
    solves: entry.solves,
    lastSolveAt: entry.lastSolveAt,
  }));

  res.json(leaderboard);
});

/**
 * GET /api/leaderboard/timeline
 * Returns cumulative score timeline for the top 10 teams
 */
router.get('/timeline', async (req, res) => {
  let topTeamIds = [];
  try {
    const topTeamsAgg = await Solve.aggregate([
      {
        $group: {
          _id: '$teamId',
          points: { $sum: '$points' },
          lastSolveAt: { $max: '$solvedAt' },
        },
      },
      { $sort: { points: -1, lastSolveAt: 1 } },
      {
        $lookup: {
          from: 'teams',
          localField: '_id',
          foreignField: '_id',
          as: 'team',
        },
      },
      { $unwind: '$team' },
      { $match: { 'team.banned': false } },
      { $limit: 10 },
    ]);
    topTeamIds = topTeamsAgg.map((t) => t._id);
  } catch {
    topTeamIds = [];
  }

  if (topTeamIds.length === 0) {
    let teams = [];
    try {
      teams = await Team.find({ banned: false }).limit(10);
    } catch {
      teams = [];
    }
    return res.json({
      teams: (teams || []).map((team) => ({
        teamId: String(team._id),
        teamName: team.name,
        points: [],
      })),
    });
  }

  const teams = await Team.find({ _id: { $in: topTeamIds } });
  const teamMap = new Map(teams.map((t) => [String(t._id), t.name]));

  // Retrieve solves for these teams in chronological order
  const solves = await Solve.find({ teamId: { $in: topTeamIds } }).sort({ solvedAt: 1 });

  const timelineMap = new Map(topTeamIds.map((id) => [String(id), []]));
  const cumulativeScores = new Map(topTeamIds.map((id) => [String(id), 0]));

  for (const solve of solves) {
    const tid = String(solve.teamId);
    if (timelineMap.has(tid)) {
      const currentScore = cumulativeScores.get(tid) + solve.points;
      cumulativeScores.set(tid, currentScore);
      timelineMap.get(tid).push({
        t: solve.solvedAt,
        score: currentScore,
      });
    }
  }

  const result = {
    teams: topTeamIds.map((id) => ({
      teamId: String(id),
      teamName: teamMap.get(String(id)) || 'Unknown Team',
      points: timelineMap.get(String(id)) || [],
    })),
  };

  res.json(result);
});

export default router;
