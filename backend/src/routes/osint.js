// OSINT Trail API (docs/API_SPEC.md "OSINT Trail"). Routes stay thin: validate -> service -> respond.
import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { auth } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { AppError } from '../utils/AppError.js';
import { assertSubmissionsOpen } from '../services/adminSettings.js';
import { getTeamContext } from '../services/teamContext.js';
import {
  caseView, listHintLog, loadAllRows, loadRows, notSeeded, openHint, submitAnswer, summarizeTrack, teamKey, teamSolves,
} from '../services/osintService.js';
import { TRACKS, TRACK_IDS, buildCase, getTrack } from '../osint/cases.js';
import { SEARCH_MAX, SOURCE_IDS, listSource, searchCorpus } from '../osint/sources.js';
import { validate } from './challenges.js';

const router = Router();
const anyRole = requireRole('player', 'admin');
const playerOnly = requireRole('player');

const answerBody = z.object({ answer: z.string().trim().min(1).max(200) }).strict();
const emptyBody = z.object({}).strict();
const trackParams = z.object({ track: z.string().max(20) }).strict();
const questionParams = z.object({ track: z.string().max(20), n: z.coerce.number().int().min(1).max(10) }).strict();
const sourceParams = z.object({ track: z.string().max(20), source: z.string().max(20) }).strict();
const sourceQuery = z.object({
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  author: z.string().regex(/^c\d{2}$/).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).strict();
const searchQuery = z.object({
  q: z.string().trim().min(2).max(64),
  offset: z.coerce.number().int().min(0).max(1000).default(0),
  limit: z.coerce.number().int().min(1).max(SEARCH_MAX).default(10),
}).strict();

// Unknown cases are 404 (never 400), so the path tells nothing about the valid names.
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

router.get('/cases', anyRole, async (req, res) => {
  const team = await viewingTeam(req);
  const byTrack = await loadAllRows();
  const out = [];
  for (const id of TRACK_IDS) {
    out.push(summarizeTrack(TRACKS[id], byTrack.get(id), await teamSolves(team, byTrack.get(id))));
  }
  res.json(out);
});

router.get('/cases/:track', anyRole, async (req, res) => {
  const track = trackFrom(req.params);
  const team = await viewingTeam(req);
  const rows = await loadRows(track.id);
  if (rows.size === 0) { throw notSeeded(); }
  res.json(await caseView({ track, rows, solved: await teamSolves(team, rows), team }));
});

// One page of one source, generated from the team's seed. Never contains an answer or a flag.
router.get('/cases/:track/sources/:source', anyRole, async (req, res) => {
  const track = trackFrom(req.params);
  const { source } = validate(sourceParams, req.params);
  if (!SOURCE_IDS.includes(source)) { throw new AppError(404, 'NOT_FOUND', 'Source not found.'); }
  const query = validate(sourceQuery, req.query);
  const team = await viewingTeam(req);
  const { world } = buildCase(env.FLAG_SECRET, teamKey(team), track.id);
  res.json(listSource(world, source, query));
});

// Bounded search over the case corpus: whole-word tokens, at most 20 results per page, nothing stored.
router.get('/cases/:track/search', anyRole, async (req, res) => {
  const track = trackFrom(req.params);
  const query = validate(searchQuery, req.query);
  const team = await viewingTeam(req);
  const { world } = buildCase(env.FLAG_SECRET, teamKey(team), track.id);
  res.json(searchCorpus(world, query.q, query));
});

router.post('/cases/:track/questions/:n/answer', playerOnly, async (req, res) => {
  const track = trackFrom(req.params);
  const { n } = validate(questionParams, req.params);
  const { answer } = validate(answerBody, req.body);
  await assertSubmissionsOpen();
  const { user, team } = await getTeamContext(req.user);
  const rows = await loadRows(track.id);
  res.json(await submitAnswer({ track, rows, team, user, stageNo: n, answer }));
});

router.post('/cases/:track/questions/:n/hints', playerOnly, async (req, res) => {
  const track = trackFrom(req.params);
  const { n } = validate(questionParams, req.params);
  validate(emptyBody, req.body ?? {});
  const { user, team } = await getTeamContext(req.user);
  const rows = await loadRows(track.id);
  res.json(await openHint({ track, rows, team, user, stageNo: n }));
});

router.get('/admin/hints', requireRole('admin'), async (req, res) => {
  res.json(await listHintLog());
});

export default router;
