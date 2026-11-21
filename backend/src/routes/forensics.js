// Forensics Desk API (docs/API_SPEC.md "Forensics Desk"). Routes stay thin: validate -> service -> respond.
import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { auth } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { AppError } from '../utils/AppError.js';
import { getTeamContext } from '../services/teamContext.js';
import {
  loadAllRows, loadRows, notSeeded, submitAnswer, summarizeTrack, teamKey, teamSolves, trackView,
} from '../services/forensicsService.js';
import { TRACK_IDS, TRACKS, artefactData, getTrack, makeContext } from '../forensics/tracks.js';
import { validate } from './challenges.js';

const router = Router();
const anyRole = requireRole('player', 'admin');
const playerOnly = requireRole('player');

const answerBody = z.object({ answer: z.string().trim().min(1).max(200) }).strict();
const trackParam = z.string().max(20);
const trackParams = z.object({ track: trackParam }).strict();
const stageParams = z.object({ track: trackParam, n: z.coerce.number().int().min(1).max(10) }).strict();
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
  const out = [];
  for (const id of TRACK_IDS) {
    out.push(summarizeTrack(TRACKS[id], byTrack.get(id), await teamSolves(team, byTrack.get(id))));
  }
  res.json(out);
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
  const ctx = makeContext(track.id, env.FLAG_SECRET, teamKey(team));
  const { artefact } = validate(artefactParams, req.params);
  const data = artefactData(ctx, artefact, query);
  if (!data) { throw new AppError(404, 'NOT_FOUND', 'Artefact not found.'); }
  res.json(data);
});

router.post('/tracks/:track/stages/:n/answer', playerOnly, async (req, res) => {
  const track = trackFrom(req.params);
  const { n } = validate(stageParams, req.params);
  const { answer } = validate(answerBody, req.body);
  const { user, team } = await getTeamContext(req.user);
  const rows = await loadRows(track.id);
  res.json(await submitAnswer({ track, rows, team, user, stageNo: n, answer }));
});

export default router;
