import { useState } from 'react';
import { openHint, submitAnswer } from '../../api/osint.js';
import { useDesk } from './DeskContext.jsx';
import { describeOsintError } from '../../osint/helpers.js';
import PreviewNote from '../PreviewNote.jsx';
import HintLadder, { HintsUsed } from '../../hints/HintLadder.jsx';
import Debrief from '../../debrief/Debrief.jsx';

// One question: the prompt, free hints (when the case has them), the answer form and playful feedback.
function Question({ trackId, q, hintsAllowed, canAnswer, onSolved }) {
  const desk = useDesk();
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [hints, setHints] = useState(q.hints);
  const pickable = q.kind === 'point' || q.kind === 'cell';
  const fromPick = desk.pick ? (q.kind === 'point' ? `${desk.pick.x},${desk.pick.y}` : desk.pick.cell) : null;

  async function submit(event) {
    event.preventDefault();
    if (busy || answer.trim() === '') { return; }
    setBusy(true);
    setFeedback(null);
    try {
      const result = await submitAnswer(trackId, q.n, answer.trim());
      setFeedback({ kind: result.correct ? 'right' : 'wrong', result });
      if (result.correct) { desk.setPick(null); onSolved(result); }
    } catch (error) {
      setFeedback({ kind: 'error', message: describeOsintError(error) });
    } finally { setBusy(false); }
  }
  async function hint() {
    const result = await openHint(trackId, q.n);
    setHints((current) => (current.length > result.index ? current : [...current, result.hint]));
  }

  const status = q.solved ? 'Captured' : q.locked ? 'Locked' : 'Open';
  return <article className={`os-question${q.solved ? ' is-solved' : ''}${q.locked ? ' is-locked' : ''}${q.final ? ' is-final' : ''}`} aria-labelledby={`os-q-${q.n}`}>
    <header>
      <h3 id={`os-q-${q.n}`}>{q.final ? 'Final: ' : `${q.n}. `}{q.title}</h3>
      <span className="os-points">{q.solved ? `+${q.pointsEarned ?? q.points}` : q.points} pts</span>
      <span className={`os-tag os-${status.toLowerCase()}`}>{status}</span>
    </header>
    {q.locked ? <div className="os-lock">
      {q.lockedBy === 'board'
        ? <>
          <p className="os-muted">The other questions are done. One step left: build a valid chain on the case board, connecting the suspect to the crime.</p>
          <button type="button" className="secondary small" onClick={() => desk.openTab('board')}>Open the case board</button>
        </>
        : <p className="os-muted">Answer the other questions of this case, then connect a valid chain on the case board, to unlock the final one.</p>}
    </div> : <p>{q.prompt}</p>}
    {q.solved && <p className="os-stamp" role="status">Confirmed: {q.confirmed}{q.flag ? <> · flag <code>{q.flag}</code></> : null}</p>}
    {!q.solved && !q.locked && <>
      {hintsAllowed && q.hintsTotal > 0 && <div className="os-hints">
        <HintLadder
          category="osint" hints={hints} total={q.hintsTotal} allowed={hintsAllowed} canOpen={canAnswer}
          preview={!canAnswer} previewNote="Admin preview: only players can open hints." onOpen={hint} describeError={describeOsintError}
        />
      </div>}
      {canAnswer ? <form className="os-answer" onSubmit={submit}>
        <label>Your answer<input
          value={answer} onChange={(e) => setAnswer(e.target.value)} maxLength={200} autoComplete="off" spellCheck="false"
          disabled={busy} aria-describedby={`os-format-${q.n}`}
        /></label>
        <button type="submit" disabled={busy || answer.trim() === ''}>{busy ? 'Checking...' : q.final ? 'Submit the final answer' : 'Check answer'}</button>
        <p id={`os-format-${q.n}`} className="os-format">Format: {q.format}</p>
        {pickable && <button type="button" className="secondary small" disabled={!fromPick} onClick={() => setAnswer(fromPick)}>
          {fromPick ? `Use my map pick (${fromPick})` : 'Pick a point on the Map tab first'}
        </button>}
      </form> : <PreviewNote>Admins can browse the case, but only players can answer.</PreviewNote>}
    </>}
    <div aria-live="polite" className="os-feedback">
      {feedback?.kind === 'wrong' && <p className="os-wrong">{'✗'} {feedback.result.message}</p>}
      {feedback?.kind === 'right' && <p className="os-right">{'✓'} {feedback.result.message} +{feedback.result.pointsAwarded} pts{feedback.result.flag ? <> · flag <code>{feedback.result.flag}</code></> : null}</p>}
      {feedback?.kind === 'right' && hintsAllowed && q.hintsTotal > 0 && <HintsUsed count={hints.length} />}
      {feedback?.kind === 'error' && <p role="alert" className="error">{feedback.message}</p>}
    </div>
    {!q.locked && <Debrief levelKey={`osint:${trackId}:${q.n}`} captured={Boolean(q.solved)} />}
  </article>;
}

export default function Questions({ view, canAnswer, onSolved }) {
  return <div className="os-stack">{view.questions.map((q) => (
    <Question key={`${view.id}-${q.n}`} trackId={view.id} q={q} hintsAllowed={view.hintsAllowed} canAnswer={canAnswer} onSolved={onSolved} />
  ))}</div>;
}
