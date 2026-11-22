import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getLevel } from '../api/crackme.js';
import { useAuth } from '../auth/AuthContext.jsx';
import Debugger from '../components/crackme/Debugger.jsx';
import HintPanel from '../components/crackme/HintPanel.jsx';
import IsaReference from '../components/crackme/IsaReference.jsx';
import PatchBay from '../components/crackme/PatchBay.jsx';
import SubmitForm from '../components/crackme/SubmitForm.jsx';
import { STATUS_LABEL, afterLoadFailure, crackmeErrorMessage } from '../components/crackme/helpers.js';
import { debugProgram } from '../components/crackme/patchEditor.js';
import Debrief from '../debrief/Debrief.jsx';
import { keyById } from '../debrief/levels.js';
import '../components/crackme/crackme.css';

export default function CrackmeLevel() {
  const { levelId } = useParams();
  const { user } = useAuth();
  const [state, setState] = useState({ puzzle: null, error: '' });
  const [input, setInput] = useState('');
  const [edits, setEdits] = useState([]);
  const [debugPatched, setDebugPatched] = useState(false);

  const submitRef = useRef(null);
  const latest = useRef(0);

  // Only the newest request may change the page: a slow earlier response (or one for a cabinet we left) is dropped.
  // `keep` is for reloads after an answer or a hint: a failed reload keeps the puzzle and the shown result.
  const load = useCallback(async (keep = false) => {
    latest.current += 1;
    const mine = latest.current;
    try {
      const puzzle = await getLevel(levelId);
      if (mine === latest.current) { setState({ puzzle, error: '' }); }
    } catch (error) {
      if (mine === latest.current) { setState((current) => afterLoadFailure(current, crackmeErrorMessage(error), keep)); }
    }
  }, [levelId]);
  const reload = useCallback(() => load(true), [load]);

  useEffect(() => {
    setState({ puzzle: null, error: '' });
    setInput('');
    setEdits([]);
    setDebugPatched(false);
    void load();
    return () => { latest.current += 1; };
  }, [load]);

  const { puzzle, error } = state;
  // The debugger can show the player's own patched program; otherwise the listing stays the cabinet's real one.
  const shown = useMemo(
    () => (puzzle ? { ...puzzle, program: debugProgram(puzzle.program, edits, debugPatched) } : null),
    [puzzle, edits, debugPatched],
  );
  return <section className="cm-page">
    <Link className="back-link" to="/reversing">&larr; Crackme Arcade</Link>
    {error && <div role="alert" className="error">{error} <button type="button" className="secondary small" onClick={() => load(Boolean(puzzle))}>Retry</button></div>}
    {!puzzle && !error && <p role="status" className="cm-loading">Loading the cabinet...</p>}
    {puzzle && <>
      <header className="cm-level-head">
        <p className="cm-kicker">{puzzle.track}{puzzle.boss ? ' · boss cabinet' : ` · cabinet ${puzzle.n}`}</p>
        <h1>{puzzle.title}</h1>
        <div className="tags">
          <span className="tag tag-points">{puzzle.points} pts</span>
          <span className="tag">{STATUS_LABEL[puzzle.status]}</span>
          {puzzle.boss && <span className="tag tag-hard">Boss</span>}
          {puzzle.patchBay?.done && <span className="tag tag-badge">Patched</span>}
        </div>
        <p className="cm-briefing">{puzzle.briefing}</p>
      </header>
      <Debugger email={user?.email} puzzle={shown} input={input} onInput={setInput} canSubmit={user?.role !== 'admin'} onSubmit={() => submitRef.current?.()} />
      <div className="cm-lower">
        <SubmitForm key={puzzle.id} puzzle={puzzle} input={input} canSubmit={user?.role !== 'admin'} onSolved={reload} submitRef={submitRef} hintsUsed={puzzle.hints.length} />
        <HintPanel puzzle={puzzle} onOpened={reload} disabled={user?.role === 'admin'} />
      </div>
      {puzzle.patchBay && <PatchBay
        key={puzzle.id}
        puzzle={puzzle}
        edits={edits}
        onEdits={setEdits}
        debugPatched={debugPatched}
        onDebugPatched={setDebugPatched}
        canSubmit={user?.role !== 'admin'}
        onDone={reload}
      />}
      <Debrief levelKey={keyById('crackme', levelId)} captured={puzzle.status === 'solved'} hintsUsed={puzzle.hints.length} />
      <IsaReference />
    </>}
  </section>;
}
