// OSINT Trail API (docs/API_SPEC.md "OSINT Trail"). Routes stay thin: validate -> service -> respond.
import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { auth } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { AppError } from '../utils/AppError.js';
import { achievementService } from '../services/achievementService.js';
import { assertSubmissionsOpen } from '../services/adminSettings.js';
import { EVIDENCE_PAGE_MAX, checkBoard, getBoard, listEvidence, saveBoard } from '../services/osintBoardService.js';
import { getTeamContext } from '../services/teamContext.js';
import {
  caseView, listHintLog, loadAllRows, loadRows, notSeeded, openHint, submitAnswer, summarizeTrack, teamKey, teamSolves, teamSolvesByTrack,
} from '../services/osintService.js';
import { MAX_PINS, BOARD_SIZE } from '../osint/board.js';
import { TRACKS, TRACK_IDS, buildCase, getTrack } from '../osint/cases.js';
import { EVIDENCE_ID, EVIDENCE_KINDS, RELATION_IDS } from '../osint/evidence.js';
import { SEARCH_MAX, SOURCE_IDS, listSource, searchCorpus } from '../osint/sources.js';
import { both, validate } from './challenges.js';

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

// Board bodies: ids must look like evidence ids, coordinates are integers on the board. The real caps (MAX_PINS and the
// link cap relative to the chain length) are enforced by the service with a 422; these ceilings only bound the parsing.
const evidenceId = z.string().regex(EVIDENCE_ID);
const boardBody = z.object({
  version: z.number().int().min(0).max(1_000_000),
  pins: z.array(z.object({
    id: evidenceId, x: z.number().int().min(0).max(BOARD_SIZE), y: z.number().int().min(0).max(BOARD_SIZE),
  }).strict()).max(MAX_PINS * 2),
  links: z.array(z.object({ a: evidenceId, b: evidenceId, rel: z.enum(RELATION_IDS) }).strict()).max(60),
}).strict();
const evidenceQuery = z.object({
  source: z.enum(EVIDENCE_KINDS).optional(),
  q: z.string().trim().min(1).max(64).optional(),
  offset: z.coerce.number().int().min(0).max(1000).default(0),
  limit: z.coerce.number().int().min(1).max(EVIDENCE_PAGE_MAX).default(20),
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
  const solvedBy = await teamSolvesByTrack(team, byTrack);
  res.json(TRACK_IDS.map((id) => summarizeTrack(TRACKS[id], byTrack.get(id), solvedBy.get(id))));
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

// The team's shared board. Admins and players without a team get an empty read-only board of their own preview world.
router.get('/cases/:track/board', anyRole, async (req, res) => {
  const track = trackFrom(req.params);
  const team = await viewingTeam(req);
  res.json(await getBoard({ track, team, readOnly: req.user.role === 'admin' || !team || team.banned === true }));
});

router.get('/cases/:track/board/evidence', anyRole, async (req, res) => {
  const track = trackFrom(req.params);
  const query = validate(evidenceQuery, req.query);
  const team = await viewingTeam(req);
  res.json(listEvidence({ track, team, ...query }));
});

// Whole-board replacement guarded by the version the client saw: a stale version is a 409 and changes nothing.
router.put('/cases/:track/board', playerOnly, async (req, res) => {
  const track = trackFrom(req.params);
  const body = validate(boardBody, req.body);
  await assertSubmissionsOpen();
  const { user, team } = await getTeamContext(req.user);
  res.json(await saveBoard({ track, team, user, ...body }));
});

// Explicit, strictly budgeted count of the links that hold on the SAVED board (3 a minute, 10 an hour per team and case).
// Admins and players without a team (or a banned team) get an empty read-only result and use no budget.
router.post('/cases/:track/board/check', anyRole, async (req, res) => {
  const track = trackFrom(req.params);
  validate(emptyBody, req.body ?? {});
  const team = await viewingTeam(req);
  res.set('Cache-Control', 'private, no-store');
  res.json(await checkBoard({ track, team: req.user.role === 'admin' ? null : team }));
});

router.post('/cases/:track/questions/:n/answer', playerOnly, async (req, res) => {
  const track = trackFrom(req.params);
  const { n } = validate(questionParams, req.params);
  const { answer } = validate(answerBody, req.body);
  await assertSubmissionsOpen();
  const [{ user, team }, rows] = await both(getTeamContext(req.user), loadRows(track.id)); // independent reads, one round trip
  const result = await submitAnswer({ track, rows, team, user, stageNo: n, answer });
  // Only a NEW solve can unlock a badge; cosmetic and never throws.
  const badges = result.pointsAwarded > 0 ? await achievementService.safeEvaluate({ userId: user._id, teamId: team._id, memberCount: team.memberIds?.length }) : [];
  res.json(badges.length ? { ...result, badges } : result);
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
