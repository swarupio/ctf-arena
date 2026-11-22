// Forensics Desk API (docs/API_SPEC.md "Forensics Desk"). Routes stay thin: validate -> service -> respond.
import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { auth } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { AppError } from '../utils/AppError.js';
import { assertSubmissionsOpen } from '../services/adminSettings.js';
import { getTeamContext } from '../services/teamContext.js';
import {
  askSuspect, interviewView, loadAllRows, loadRows, notSeeded, submitAnswer, summarizeTrack, teamKey, teamSolves, teamSolvesByTrack, trackView,
} from '../services/forensicsService.js';
import { TRACK_IDS, TRACKS, artefactData, getTrack, makeContext } from '../forensics/tracks.js';
import { both, validate } from './challenges.js';

const router = Router();
const anyRole = requireRole('player', 'admin');
const playerOnly = requireRole('player');

const answerBody = z.object({ answer: z.string().trim().min(1).max(200) }).strict();
const trackParam = z.string().max(20);
const trackParams = z.object({ track: trackParam }).strict();
const stageParams = z.object({ track: trackParam, n: z.coerce.number().int().min(1).max(10) }).strict();
const interviewBody = z.object({ suspectId: z.string().regex(/^s\d{1,2}$/), questionId: z.string().regex(/^q\d{1,2}$/) }).strict();
const artefactParams = z.object({ track: trackParam, artefact: z.string().max(20) }).strict();
const artefactQuery = z.object({
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  limit: z.coerce.number().int().min(1).max(500).default(200),
  cluster: z.coerce.number().int().min(0).max(255).optional(),
  count: z.coerce.number().int().min(1).max(8).default(1),
  image: z.coerce.number().int().min(1).max(4).default(1),
}).strict();

// Unknown tracks are 404 (never 400), so the path tells nothing about the valid names.
function trackFrom(params) {
  const parsed = trackParams.safeParse({ track: params.track });
  const track = parsed.success ? getTrack(parsed.data.track) : null;
  if (!track) { throw new AppError(404, 'NOT_FOUND', 'Case not found.'); }
  return track;
}

// Read-only views work without a team (the picker still renders) and for banned teams; admins preview a fixed team id.
async function viewingTeam(req) {
  if (req.user.role === 'admin') { return null; }
  const { team } = await getTeamContext(req.user, { requireTeam: false, blockBanned: false });
  return team;
}

router.use(auth);

router.get('/tracks', anyRole, async (req, res) => {
  const team = await viewingTeam(req);
  const byTrack = await loadAllRows();
  const solvedBy = await teamSolvesByTrack(team, byTrack);
  res.json(TRACK_IDS.map((id) => summarizeTrack(TRACKS[id], byTrack.get(id), solvedBy.get(id))));
});

router.get('/tracks/:track', anyRole, async (req, res) => {
  const track = trackFrom(req.params);
  const team = await viewingTeam(req);
  const rows = await loadRows(track.id);
  if (rows.size === 0) { throw notSeeded(); }
  const solved = await teamSolves(team, rows);
  const ctx = makeContext(track.id, env.FLAG_SECRET, teamKey(team));
  res.json(trackView({ track, ctx, rows, solved, team }));
});

// One chunk of one artefact, generated lazily from the team's seed. Never contains an answer or a flag.
router.get('/tracks/:track/artefacts/:artefact', anyRole, async (req, res) => {
  const track = trackFrom(req.params);
  const query = validate(artefactQuery, req.query);
  const team = await viewingTeam(req);
  // Same rule as the case view: a track with no visible seeded rows serves nothing.
  if ((await loadRows(track.id)).size === 0) { throw notSeeded(); }
  const ctx = makeContext(track.id, env.FLAG_SECRET, teamKey(team));
  const { artefact } = validate(artefactParams, req.params);
  const data = artefactData(ctx, artefact, query);
  if (!data) { throw new AppError(404, 'NOT_FOUND', 'Artefact not found.'); }
  res.json(data);
});

router.get('/tracks/:track/interviews', anyRole, async (req, res) => {
  const track = trackFrom(req.params);
  const team = await viewingTeam(req);
  const rows = await loadRows(track.id);
  if (rows.size === 0) { throw notSeeded(); }
  const ctx = makeContext(track.id, env.FLAG_SECRET, teamKey(team));
  res.json(interviewView({ track, ctx, solved: await teamSolves(team, rows), preview: req.user.role === 'admin' }));
});

router.post('/tracks/:track/interviews', anyRole, async (req, res) => {
  const track = trackFrom(req.params);
  const { suspectId, questionId } = validate(interviewBody, req.body);
  const preview = req.user.role === 'admin';
  const { team } = preview ? { team: null } : await getTeamContext(req.user);
  const rows = await loadRows(track.id);
  if (rows.size === 0) { throw notSeeded(); }
  const ctx = makeContext(track.id, env.FLAG_SECRET, teamKey(team));
  res.json(await askSuspect({ track, ctx, solved: await teamSolves(team, rows), team, suspectId, questionId, preview }));
});

router.post('/tracks/:track/stages/:n/answer', playerOnly, async (req, res) => {
  const track = trackFrom(req.params);
  const { n } = validate(stageParams, req.params);
  const { answer } = validate(answerBody, req.body);
  await assertSubmissionsOpen();
  const [{ user, team }, rows] = await both(getTeamContext(req.user), loadRows(track.id)); // independent reads, one round trip
  res.json(await submitAnswer({ track, rows, team, user, stageNo: n, answer }));
});

export default router;
