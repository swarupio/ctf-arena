import { useState } from 'react';
import { openHint } from '../../api/cipherlab.js';
import { cipherErrorMessage } from './helpers.js';

// Hints are optional and free; opening one is logged for the admin. Insane levels have none.
export default function HintPanel({ puzzle, onOpened, disabled }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!puzzle.hintsAllowed) {
    return <section className="cl-box" aria-labelledby="cl-hints-title">
      <h2 id="cl-hints-title">Hints</h2>
      <p className="cl-note">This track gives no hints. You are on your own.</p>
    </section>;
  }
  const remaining = puzzle.hintsTotal - puzzle.hints.length;
  async function open() {
    setBusy(true);
    setError('');
    try { await openHint(puzzle.id); await onOpened(); }
    catch (err) { setError(cipherErrorMessage(err)); }
    finally { setBusy(false); }
  }
  return <section className="cl-box" aria-labelledby="cl-hints-title">
    <h2 id="cl-hints-title">Hints <span className="cl-dim">({puzzle.hints.length}/{puzzle.hintsTotal})</span></h2>
    <p className="cl-note">Free to use. Your team's hint use is visible to admins.</p>
    {puzzle.hints.length > 0 && <ol className="cl-hints">{puzzle.hints.map((hint, index) => <li key={index}>{hint}</li>)}</ol>}
    {error && <p role="alert" className="error">{error}</p>}
    <button type="button" className="secondary" onClick={open} disabled={busy || remaining === 0 || disabled}>
      {remaining === 0 ? 'No more hints' : busy ? 'Opening…' : 'Show next hint'}
    </button>
  </section>;
}
