// Suspect interviews: an optional aid next to the suspect board (docs/FORENSICS_DESK.md, "Interviews").
// Pure and stateless: every answer is derived from the team seed (the suspects of `suspectsFor`) and from which stages the
// team has solved. A question exists only for a SOLVED stage and quotes only that stage's confirmed evidence, so an answer
// can never carry a fact of an unsolved stage.
//
// Deduction rule. A "false denial" is a suspect answering "no" while the board fact of that stage equals the evidence value.
//  - The culprit matches every clue and denies every question (a false denial on each).
//  - A decoy (a non-culprit that matches at least one clue) tells exactly ONE lie: on one stage whose clue it matches it
//    answers "no" instead of "yes". It tells the truth everywhere else.
//  - A suspect that does not match a stage's value answers "no" truthfully.
// So after two or more solved stages the culprit is the only suspect with two or more false denials (decoys have at most one).
//
// Lie assignment (`lieStagesFor`): decoys and stages form a bipartite graph (an edge where the decoy matches that clue). A
// maximum matching (Kuhn's augmenting paths) lets as many stages as possible have a matching decoy that lies on them, so a
// single answer rarely singles out the culprit. Decoys left unmatched lie on the eligible stage with the fewest liars so far.
// Every tie is broken with a hash of the team seed, so the plan is deterministic and consumes no rng draw. Nothing here
// touches the submit logic, the stages or the suspect board.
import { createHash } from 'node:crypto';
import { answerOf, normalizeAnswer, suspectsFor } from './tracks.js';

export const MAX_QUESTIONS = 3;

// One pool for "no", used whether the denial is true or false, so the tone never gives a lie away.
export const NO_STATEMENTS = [
  'No. That has nothing to do with me.',
  'No. You have the wrong person.',
  'No. I would remember that, and it is not mine.',
];
export const YES_STATEMENTS = ['Yes. That is mine, I have nothing to hide.'];

const questionId = (stageNo) => `q${stageNo}`;

// Deterministic 32-bit value from the team seed and any labels (never an rng draw).
const hash32 = (ctx, ...parts) => createHash('sha256').update(`${ctx.seed}|interview|${parts.join('|')}`).digest().readUInt32BE(0);

// Whether the board fact of `suspect` for `stage` equals the evidence value.
function matchesStage(ctx, suspect, stageNo) {
  const kind = ctx.track.stages.find((s) => s.n === stageNo).kind;
  const fact = suspect.facts.find((f) => f.stage === stageNo);
  return normalizeAnswer(kind, fact.value) === normalizeAnswer(kind, answerOf(ctx, stageNo));
}

// Map of decoy suspect id -> the stage it lies on (a decoy matching no clue has nothing to lie about and is absent).
const planCache = new WeakMap(); // per request context, so repeated answers do not redo the plan
export function lieStagesFor(ctx) {
  if (!planCache.has(ctx)) { planCache.set(ctx, computeLies(ctx)); }
  return planCache.get(ctx);
}

function computeLies(ctx) {
  const { suspects, culprit } = suspectsFor(ctx);
  const stageNos = ctx.track.clues.map(([, stageNo]) => stageNo);
  const decoys = suspects.filter((s) => s.id !== culprit.id)
    .map((s) => ({ id: s.id, options: stageNos.filter((n) => matchesStage(ctx, s, n)) }))
    .filter((d) => d.options.length > 0);
  decoys.sort((a, b) => hash32(ctx, 'order', a.id) - hash32(ctx, 'order', b.id));
  for (const d of decoys) { d.options.sort((a, b) => hash32(ctx, 'pref', d.id, a) - hash32(ctx, 'pref', d.id, b)); }

  const holder = new Map(); // stage -> decoy id currently lying on it
  const augment = (d, seen) => {
    for (const n of d.options) {
      if (seen.has(n)) { continue; }
      seen.add(n);
      const other = holder.get(n);
      if (other === undefined || augment(decoys.find((x) => x.id === other), seen)) { holder.set(n, d.id); return true; }
    }
    return false;
  };
  for (const d of decoys) { augment(d, new Set()); }

  const lies = new Map([...holder].map(([n, id]) => [id, n]));
  const load = new Map(stageNos.map((n) => [n, holder.has(n) ? 1 : 0]));
  for (const d of decoys.filter((x) => !lies.has(x.id))) {
    const stageNo = [...d.options].sort((a, b) => load.get(a) - load.get(b))[0];
    lies.set(d.id, stageNo);
    load.set(stageNo, load.get(stageNo) + 1);
  }
  return lies;
}

// The questions asked of every suspect: one per solved evidence stage (at most three, lowest stage first).
export function interviewQuestions(ctx, solved) {
  const { clues, stages } = ctx.track;
  const solvedNumbers = stages.filter((s) => !s.whodunit && solved.has(s.n)).map((s) => s.n);
  const out = [];
  for (const [label, stageNo] of clues) {
    if (!solvedNumbers.includes(stageNo) || out.length >= MAX_QUESTIONS) { continue; }
    out.push({
      id: questionId(stageNo), stage: stageNo,
      text: `The evidence shows "${answerOf(ctx, stageNo)}" for: ${label.toLowerCase()}. Is that you?`,
    });
  }
  return out.sort((a, b) => a.stage - b.stage);
}

// Returns null for an unknown suspect, an unknown question or a question whose stage is not solved.
export function interviewAnswer(ctx, solved, suspectId, qid) {
  const { suspects, culprit } = suspectsFor(ctx);
  const suspect = suspects.find((s) => s.id === suspectId);
  const question = interviewQuestions(ctx, solved).find((q) => q.id === qid);
  if (!suspect || !question) { return null; }
  const matches = matchesStage(ctx, suspect, question.stage);
  const lying = suspect.id === culprit.id || lieStagesFor(ctx).get(suspect.id) === question.stage;
  const yes = matches && !lying;
  const pool = yes ? YES_STATEMENTS : NO_STATEMENTS;
  return {
    suspectId: suspect.id, questionId: question.id, answer: yes ? 'yes' : 'no',
    statement: pool[hash32(ctx, 'say', suspect.id, question.id, yes ? 'y' : 'n') % pool.length],
  };
}
