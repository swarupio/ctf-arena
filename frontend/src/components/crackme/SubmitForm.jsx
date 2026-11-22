import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { submitInput } from '../../api/crackme.js';
import PreviewNote from '../PreviewNote.jsx';
import { HintsUsed } from '../../hints/HintLadder.jsx';
import { confettiPieces, crackmeErrorMessage, inputProblem, streakText } from './helpers.js';

const PIECES = confettiPieces();

// Submits the input from the debugger toolbar. The server runs its own VM on it; only then is the team flag returned.
export default function SubmitForm({ puzzle, input, canSubmit, onSolved, submitRef, hintsUsed = null }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const solved = puzzle.status === 'solved' || result?.correct;

  async function submit(event) {
    event?.preventDefault?.();
    if (!canSubmit || busy) { return; }
    const problem = inputProblem(input);
    if (problem) { setError(problem); return; }
    setBusy(true);
    setError('');
    try {
      const response = await submitInput(puzzle.id, input);
      setResult(response);
      if (response.correct) { await onSolved(); }
    } catch (err) {
      setError(crackmeErrorMessage(err));
    } finally { setBusy(false); }
  }

  // Lets the debugger's Enter key and its own button submit through this one code path.
  useEffect(() => {
    if (!submitRef) { return undefined; }
    submitRef.current = () => submit();
    return () => { submitRef.current = null; };
  });

  return <section className="cm-box cm-answer" aria-labelledby="cm-answer-title">
    <h2 id="cm-answer-title">Insert the code</h2>
    {!canSubmit ? <PreviewNote>Admins can run the debugger on any cabinet, but only players can submit an input.</PreviewNote> : <form onSubmit={submit} noValidate>
      <p className="cm-note">
        Input to submit: <code className="cm-flag">{input || '(empty, type it in the debugger above)'}</code>
      </p>
      <p className="cm-note">The server runs its own copy of the machine on this input. A pass in your debugger is not enough: check for traps.</p>
      <button type="submit" disabled={busy || !input}>{busy ? 'Checking...' : 'Submit input'}</button>
    </form>}
    {error && <p role="alert" className="error">{error}</p>}
    {result && !result.correct && <p role="status" className="cm-wrong">{result.message}</p>}
    {result?.correct && <div role="status" className="cm-win">
      <div className="cm-confetti" aria-hidden="true">
        {PIECES.map((piece) => <span key={piece.id} className={`cm-piece cm-piece-${piece.hue}`} style={{ left: `${piece.left}%`, animationDelay: `${piece.delay}s` }} />)}
      </div>
      <p className="cm-win-title">{result.message}</p>
      {result.pointsAwarded > 0 && <p>+{result.pointsAwarded} points &middot; {streakText(result.streak)}</p>}
      <p>Team flag: <code className="cm-flag">{result.flag}</code></p>
      {hintsUsed !== null && puzzle.hintsAllowed && <HintsUsed count={hintsUsed} />}
      {result.trackComplete && <p className="cm-win-title">Track cleared!</p>}
      {result.nextLevelId && <Link className="button" to={`/reversing/${result.nextLevelId}`}>Next cabinet</Link>}
    </div>}
    {solved && !result && <p className="notice">Your team already captured this cabinet. Submit again to see your flag.</p>}
  </section>;
}
