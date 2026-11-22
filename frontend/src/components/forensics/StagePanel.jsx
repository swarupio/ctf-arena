import { useEffect, useRef, useState } from 'react';
import { submitAnswer } from '../../api/forensics.js';
import { describeForensicsError } from '../../forensics/caseHelpers.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import HintLadder, { HintsUsed } from '../../hints/HintLadder.jsx';
import { useStoredCount } from '../../hints/hooks.js';
import Debrief from '../../debrief/Debrief.jsx';

// One question: the prompt, an optional hint (a click away, never auto-shown), the answer form and playful feedback.
// The server does not track hint opens here: the opened count lives in this browser, per player and question.
export default function StagePanel({ trackId, stage, canAnswer, onSolved, prefill }) {
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const { user } = useAuth();
  const [opened, openNext] = useStoredCount(user, `forensics:${trackId}:${stage.n}`, stage.hint ? 1 : 0);
  const input = useRef(null);
  useEffect(() => { if (prefill) { setAnswer(prefill.name); input.current?.focus(); } }, [prefill]);

  async function submit(event) {
    event.preventDefault();
    if (busy || answer.trim() === '') { return; }
    setBusy(true);
    setFeedback(null);
    try {
      const result = await submitAnswer(trackId, stage.n, answer.trim());
      setFeedback({ kind: result.correct ? 'right' : 'wrong', result });
      if (result.correct) { onSolved(result); }
    } catch (error) {
      setFeedback({ kind: 'error', message: describeForensicsError(error) });
    } finally { setBusy(false); }
  }

  const status = stage.solved ? 'Captured' : stage.locked ? 'Locked' : 'Open';
  return <article className={`fx-stage${stage.solved ? ' is-solved' : ''}${stage.locked ? ' is-locked' : ''}${stage.whodunit ? ' is-whodunit' : ''}`} aria-labelledby={`fx-stage-${stage.n}`}>
    <header>
      <h3 id={`fx-stage-${stage.n}`}>{stage.whodunit ? 'Final: ' : `${stage.n}. `}{stage.title}</h3>
      <span className="fx-points">{stage.solved ? `+${stage.pointsEarned ?? stage.points}` : stage.points} pts</span>
      <span className={`fx-status-tag fx-${status.toLowerCase()}`}>{status}</span>
    </header>
    {stage.locked ? <p className="fx-muted">Confirm the evidence of the other four questions to unlock the accusation.</p> : <p>{stage.prompt}</p>}
    {stage.solved && <p className="fx-stamp" role="status">{'✓'} Confirmed</p>}
    {!stage.solved && !stage.locked && <>
      <HintLadder
        category="forensics" hints={stage.hint ? [stage.hint].slice(0, opened) : []} total={stage.hint ? 1 : 0} allowed={Boolean(stage.hint)}
        onOpen={openNext}
      />
      <form className="fx-answer" onSubmit={submit}>
        <label>Your answer<input
          ref={input} value={answer} onChange={(e) => setAnswer(e.target.value)} maxLength={200} autoComplete="off" spellCheck="false"
          disabled={!canAnswer || busy} aria-describedby={`fx-format-${stage.n}`} placeholder={stage.whodunit ? 'Full name' : ''}
        /></label>
        <button type="submit" disabled={!canAnswer || busy || answer.trim() === ''}>{busy ? 'Checking...' : stage.whodunit ? 'Make the accusation' : 'Check answer'}</button>
        <p id={`fx-format-${stage.n}`} className="fx-format">Format: {stage.format}</p>
      </form>
      {!canAnswer && <p className="fx-muted">Admins can browse the evidence but only players can answer.</p>}
    </>}
    <div aria-live="polite" className="fx-feedback">
      {feedback?.kind === 'wrong' && <p className="fx-wrong">{'✗'} {feedback.result.message}</p>}
      {feedback?.kind === 'right' &&<p className="fx-right">{'✓'} {feedback.result.message} +{feedback.result.pointsAwarded} pts</p>}
      {feedback?.kind === 'right' && Boolean(stage.hint) && <HintsUsed count={opened} />}
      {feedback?.kind === 'error' && <p role="alert" className="error">{feedback.message}</p>}
    </div>
    {!stage.locked && <Debrief levelKey={`forensics:${trackId}:${stage.n}`} captured={Boolean(stage.solved)} />}
  </article>;
}
