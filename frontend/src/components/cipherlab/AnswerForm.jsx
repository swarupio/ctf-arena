import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { submitAnswer } from '../../api/cipherlab.js';
import PreviewNote from '../PreviewNote.jsx';
import { HintDeduction, HintsUsed } from '../../hints/HintLadder.jsx';
import { STREAK_LOST, cipherErrorMessage, confettiPieces, missText, streakText } from './helpers.js';

const PIECES = confettiPieces();

export default function AnswerForm({ puzzle, canSubmit, onSolved, streak = 0, hintsUsed = null }) {
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [shake, setShake] = useState(false);
  const inputRef = useRef(null);
  const streakRef = useRef(streak); // the last streak this form saw, so a miss can say a streak was lost
  const [lost, setLost] = useState(false);
  const solved = puzzle.status === 'solved' || result?.correct;

  async function submit(event) {
    event.preventDefault();
    if (!answer.trim() || busy) { return; }
    setBusy(true);
    setError('');
    try {
      const response = await submitAnswer(puzzle.id, answer);
      setResult(response);
      if (response.correct) {
        streakRef.current = response.streak ?? 0;
        setLost(false);
        await onSolved();
      } else {
        setLost(missText(streakRef.current, response.streak) !== '');
        streakRef.current = 0;
        setShake(true);
      }
    } catch (err) {
      setError(cipherErrorMessage(err));
      setShake(true);
    } finally {
      setBusy(false);
      // The input is read-only (not disabled) while checking, so focus stays; this covers any other blur.
      inputRef.current?.focus();
    }
  }

  return <section className="cl-box cl-answer" aria-labelledby="cl-answer-title">
    <h2 id="cl-answer-title">Your answer</h2>
    {!canSubmit ? <PreviewNote>Admins can read the puzzle and use the tools, but only players can submit answers.</PreviewNote> : <form onSubmit={submit} className={shake ? 'cl-shake' : undefined} onAnimationEnd={() => setShake(false)} noValidate>
      <label>
        Plaintext message{puzzle.track === 'hard' && puzzle.n === 1 ? ' (a number)' : ''}
        <input
          ref={inputRef}
          value={answer}
          onChange={(event) => setAnswer(event.target.value)}
          maxLength={300}
          autoComplete="off"
          spellCheck="false"
          autoCapitalize="characters"
          readOnly={busy}
          aria-describedby="cl-answer-help"
        />
      </label>
      <p id="cl-answer-help" className="cl-note">Capitals, spaces and punctuation do not matter.</p>
      <button type="submit" disabled={busy || !answer.trim()}>{busy ? 'Checking…' : 'Submit answer'}</button>
    </form>}
    {error && <p role="alert" className="error">{error}</p>}
    {result && !result.correct && <p role="status" className="cl-wrong">{result.message}{lost ? ` ${STREAK_LOST}` : ''}</p>}
    {result?.correct && <div role="status" className="cl-win">
      <div className="cl-confetti" aria-hidden="true">
        {PIECES.map((piece) => <span key={piece.id} className={`cl-piece cl-piece-${piece.hue}`} style={{ left: `${piece.left}%`, animationDelay: `${piece.delay}s` }} />)}
      </div>
      <p className="cl-win-title">{result.message}</p>
      {result.pointsAwarded > 0 && <p>+{result.pointsAwarded} points · {streakText(result.streak)}</p>}
      <p>Team flag: <code className="cl-flag">{result.flag}</code></p>
      <HintDeduction result={result} />
      {hintsUsed !== null && puzzle.hintsAllowed && <HintsUsed count={hintsUsed} />}
      {result.trackComplete && <p className="cl-win-title">Track cleared! Check the overview for your speed-run badge.</p>}
      {result.nextLevelId && <Link className="button" to={`/cipherlab/${result.nextLevelId}`}>Next level</Link>}
    </div>}
    {solved && !result && <p className="notice">Your team already captured this level. You can solve it again to see your flag.</p>}
  </section>;
}
