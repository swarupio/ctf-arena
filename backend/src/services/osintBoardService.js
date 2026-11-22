// Server side of the OSINT case board (docs/OSINT_TRAIL.md "Case board"). The board is shared by the team and kept only in
// MongoDB: every save is one atomic findOneAndUpdate guarded by the version counter, so replicas and teammates can never
// overwrite each other silently. The required chain is derived from the per-team world and never sent out.
import { env } from '../config/env.js';
import OsintBoard from '../models/OsintBoard.js';
import { AppError } from '../utils/AppError.js';
import {
  BOARD_SIZE, MAX_PINS, boardProblem, chainProgress, evidenceOf, evidenceIndex, linkCap, nudge, progressLevel,
} from '../osint/board.js';
import { buildCase } from '../osint/cases.js';
import { RELATIONS } from '../osint/evidence.js';
import { PREVIEW_TEAM } from '../osint/world.js';
import { consumeAttempt } from './attemptLimiter.js';

// Saves are cheap but each one tells the caller a coarse progress level, so they are budgeted per team and case.
export const BOARD_LIMITS = [{ limit: 30, windowMs: 60_000 }, { limit: 200, windowMs: 3_600_000 }];
// The explicit check returns the EXACT number of links that hold on the saved board, so it is strictly budgeted.
export const CHECK_LIMITS = [{ limit: 3, windowMs: 60_000 }, { limit: 10, windowMs: 3_600_000 }];
export const EVIDENCE_PAGE_MAX = 50;

const teamKey = (team) => (team ? String(team._id) : PREVIEW_TEAM);
const plain = (doc) => ({
  version: doc?.version ?? 0,
  pins: (doc?.pins ?? []).map((p) => ({ id: p.id, x: p.x, y: p.y })),
  links: (doc?.links ?? []).map((l) => ({ a: l.a, b: l.b, rel: l.rel })),
  unlocked: Boolean(doc?.unlocked),
});

// Pins show their label and kind; ids that no longer exist in the world (never expected) are dropped from the view.
function viewOf({ doc, caseData, readOnly }) {
  const board = plain(doc);
  const index = evidenceIndex(caseData.world);
  const required = caseData.chain.length;
  const progress = chainProgress(caseData.chain, board.links);
  // No exact count here (see progressLevel): only the coarse level and the sticky unlock.
  return {
    version: board.version,
    pins: board.pins.filter((p) => index.has(p.id)).map((p) => ({ ...p, kind: index.get(p.id).kind, label: index.get(p.id).label })),
    links: board.links,
    progress: { level: progressLevel({ ...progress, unlocked: board.unlocked }), total: required },
    unlocked: board.unlocked,
    nudge: nudge({ unlocked: board.unlocked }),
    limits: { pins: MAX_PINS, links: linkCap(required), size: BOARD_SIZE },
    relations: RELATIONS,
    readOnly,
  };
}

// True when the team's board has held the whole chain. A missing team (admin preview) never unlocks anything.
export async function boardUnlocked(team, trackId) {
  if (!team) { return false; }
  const doc = await OsintBoard.findOne({ teamId: team._id, track: trackId, unlocked: true }, '_id').lean();
  return Boolean(doc);
}

// readOnly: admins (preview world) and players without a team see an empty board they cannot save.
export async function getBoard({ track, team, readOnly = !team }) {
  const caseData = buildCase(env.FLAG_SECRET, teamKey(team), track.id);
  const doc = team ? await OsintBoard.findOne({ teamId: team._id, track: track.id }).lean() : null;
  return viewOf({ doc, caseData, readOnly });
}

// The explicit "Check my chain": the exact number of required links on the SAVED board, nothing else. It reads only; it
// never saves, unlocks or changes anything, and it is budgeted per team and case (CHECK_LIMITS). Admins (preview world),
// players without a team and banned teams get an empty read-only result and no budget is used.
export async function checkBoard({ track, team }) {
  const caseData = buildCase(env.FLAG_SECRET, teamKey(team), track.id);
  const total = caseData.chain.length;
  if (!team || team.banned) { return { found: 0, total, checksLeft: 0, readOnly: true }; }
  const message = 'You can check your chain 3 times a minute and 10 times an hour. Try again later.';
  const used = [];
  for (const [i, budget] of CHECK_LIMITS.entries()) {
    used.push(await consumeAttempt(`osint-board-check:${team._id}:${track.id}:${i}`, { ...budget, message }));
  }
  const doc = await OsintBoard.findOne({ teamId: team._id, track: track.id }).lean();
  const found = doc?.unlocked ? total : chainProgress(caseData.chain, plain(doc).links).found;
  const checksLeft = Math.max(0, Math.min(...CHECK_LIMITS.map((budget, i) => budget.limit - used[i])));
  return { found, total, checksLeft, readOnly: false };
}

export async function saveBoard({ track, team, user, version, pins, links }) {
  const caseData = buildCase(env.FLAG_SECRET, team._id, track.id);
  const problem = boardProblem({ index: evidenceIndex(caseData.world), pins, links, required: caseData.chain.length });
  if (problem) { throw new AppError(problem.code === 'BOARD_LIMIT' ? 422 : 400, problem.code, problem.message); }
  const message = 'You are saving the board too fast. Wait a moment.';
  for (const [i, budget] of BOARD_LIMITS.entries()) { await consumeAttempt(`osint-board:${team._id}:${track.id}:${i}`, { ...budget, message }); }

  const progress = chainProgress(caseData.chain, links);
  const set = {
    pins: pins.map((p) => ({ id: p.id, x: p.x, y: p.y })),
    links: links.map((l) => ({ a: l.a, b: l.b, rel: l.rel })),
    updatedBy: user._id,
  };
  // Sticky and atomic: a complete chain sets `unlocked`; an incomplete save simply leaves the flag as it was.
  if (progress.found === progress.total) { set.unlocked = true; }
  let doc;
  try {
    // The filter holds the version the client saw. A first save (version 0) matches nothing and upserts (0 -> 1); a stale
    // version with a board present matches nothing, tries to insert and meets the unique (teamId, track) index.
    doc = await OsintBoard.findOneAndUpdate(
      { teamId: team._id, track: track.id, version },
      { $set: set, $inc: { version: 1 } },
      { new: true, upsert: version === 0, lean: true },
    );
  } catch (error) {
    if (error?.code === 11000) { throw new AppError(409, 'BOARD_CONFLICT', 'A teammate changed the board. It was reloaded; apply your change again.'); }
    throw error;
  }
  // Not found without an upsert: the client's version never existed (a board is only ever created from version 0).
  if (!doc) { throw new AppError(409, 'BOARD_CONFLICT', 'A teammate changed the board. It was reloaded; apply your change again.'); }
  return viewOf({ doc, caseData, readOnly: false });
}

// One page of pinnable evidence (labels only), optionally filtered by source and by a plain text filter.
export function listEvidence({ track, team, source, q, offset = 0, limit = 20 }) {
  const { world } = buildCase(env.FLAG_SECRET, teamKey(team), track.id);
  const needle = q ? q.toLowerCase() : null;
  const all = evidenceOf(world).filter((item) => (!source || item.kind === source) && (!needle || item.label.toLowerCase().includes(needle) || item.id.includes(needle)));
  const size = Math.min(EVIDENCE_PAGE_MAX, limit);
  return { total: all.length, offset, limit: size, items: all.slice(offset, offset + size) };
}
