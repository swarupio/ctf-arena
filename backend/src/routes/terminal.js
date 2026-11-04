// Arena Terminal game API (docs/TERMINAL_GAME.md section 8, docs/API_SPEC.md "Terminal").
// Routes stay thin: validate -> call the service or the shell engine -> respond. No state lives in this process.
import { Router } from 'express';
import { z } from 'zod';
import { auth } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { AppError } from '../utils/AppError.js';
import { integrityService } from '../services/integrityService.js';
import { getTeamContext } from '../services/teamContext.js';
import {
  buildContext, completeResponse, execResponse, loadChallengesByMode, loadModeChallenges,
  normalizeCwd, progressView, submitFlag, summarizeMode, teamSolves,
} from '../services/terminalService.js';
import { MODE_NAMES, MODES, getMode } from '../terminal/modes/index.js';
import { complete, execute } from '../terminal/shell.js';
import { validate } from './challenges.js';

const router = Router();

const modeParams = z.object({ mode: z.enum(MODE_NAMES) }).strict();
const execBody = z.object({ command: z.string().max(300), cwd: z.string().max(200).optional() }).strict();
const completeBody = z.object({ partial: z.string().max(200), cwd: z.string().max(200).optional() }).strict();
const submitBody = z.object({ flag: z.string().trim().min(1).max(200) }).strict();

// Unknown modes are 404 (never 400), so the path itself tells nothing about the valid names.
function modeFrom(params) {
  const parsed = modeParams.safeParse(params);
  const definition = parsed.success ? getMode(parsed.data.mode) : null;
  if (!definition) { throw new AppError(404, 'NOT_FOUND', 'Mode not found.'); }
  return definition;
}

// Players need a team (their flags are per team); admins explore with a preview flag set and need none.
async function playingTeam(req) {
  if (req.user.role === 'admin') { return { user: null, team: null }; }
  return getTeamContext(req.user);
}

// Read-only views work without a team (the picker still renders) and for banned teams, like GET /challenges.
async function viewingTeam(req) {
  if (req.user.role === 'admin') { return null; }
  const { team } = await getTeamContext(req.user, { requireTeam: false, blockBanned: false });
  return team;
}

const anyRole = requireRole('player', 'admin');
const playerOnly = requireRole('player');
router.use(auth);

router.get('/modes', anyRole, async (req, res) => {
  const team = await viewingTeam(req);
  const definitions = MODE_NAMES.map((name) => MODES[name]);
  const byMode = await loadChallengesByMode(definitions);
  const solves = await teamSolves(team, [...byMode.values()].flat());
  res.json(definitions.map((definition) => summarizeMode(definition, byMode.get(definition.mode), solves)));
});

router.get('/:mode/progress', anyRole, async (req, res) => {
  const definition = modeFrom(req.params);
  const team = await viewingTeam(req);
  const challenges = await loadModeChallenges(definition);
  res.json(progressView(definition, challenges, await teamSolves(team, challenges)));
});

router.post('/:mode/exec', anyRole, async (req, res) => {
  const definition = modeFrom(req.params);
  const { command, cwd } = validate(execBody, req.body);
  const { user, team } = await playingTeam(req);
  // Fair play (docs/FAIR_PLAY.md), players only and before any work: pacing rules answer 429 SLOW_DOWN, and a canary
  // command (something only an automated assistant would type) gets a believable reply carrying a tainted flag.
  if (user) {
    const verdict = await integrityService.inspectExec({ req, user, mode: definition.mode, command });
    if (verdict.slowDown) { throw new AppError(429, 'SLOW_DOWN', verdict.message); }
    if (verdict.canaryOutput) {
      return res.json({ output: verdict.canaryOutput, cwd: normalizeCwd(cwd, definition.home), exit: 0 });
    }
  }
  // One lean read gives the ids and slugs the synchronous flag(n) needs; progress() reads Solve only on demand.
  const challenges = await loadModeChallenges(definition);
  const result = await execute(command, buildContext({ definition, cwd, challenges, team }));
  res.json(execResponse(result, definition));
});

router.post('/:mode/complete', anyRole, async (req, res) => {
  const definition = modeFrom(req.params);
  const { partial, cwd } = validate(completeBody, req.body);
  const { team } = await playingTeam(req);
  // Completion only lists names: no flags are involved, so no database read beyond the team lookup.
  const matches = await complete(partial, buildContext({ definition, cwd, challenges: [], team }));
  res.json(completeResponse(matches));
});

router.post('/:mode/submit', playerOnly, async (req, res) => {
  const definition = modeFrom(req.params);
  const { flag } = validate(submitBody, req.body);
  const { user, team } = await getTeamContext(req.user);
  const challenges = await loadModeChallenges(definition);
  const result = await submitFlag({ definition, challenges, team, user, submitted: flag });
  // A wrong flag may be a copied decoy: one indexed lookup, a signal if so, and the same answer either way.
  if (result.correct === false) { await integrityService.checkSubmittedFlag({ flag, user }); }
  res.json(result);
});

export default router;
