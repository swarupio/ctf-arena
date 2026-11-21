import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getLevel } from '../api/crackme.js';
import { useAuth } from '../auth/AuthContext.jsx';
import Debugger from '../components/crackme/Debugger.jsx';
import HintPanel from '../components/crackme/HintPanel.jsx';
import IsaReference from '../components/crackme/IsaReference.jsx';
import SubmitForm from '../components/crackme/SubmitForm.jsx';
import { STATUS_LABEL, crackmeErrorMessage } from '../components/crackme/helpers.js';
import '../components/crackme/crackme.css';

export default function CrackmeLevel() {
  const { levelId } = useParams();
  const { user } = useAuth();
  const [state, setState] = useState({ puzzle: null, error: '' });
  const [input, setInput] = useState('');

  const load = useCallback(async () => {
    try { setState({ puzzle: await getLevel(levelId), error: '' }); }
    catch (error) { setState((current) => ({ ...current, puzzle: null, error: crackmeErrorMessage(error) })); }
  }, [levelId]);

  useEffect(() => {
    setState({ puzzle: null, error: '' });
    setInput('');
    void load();
  }, [load]);

  const { puzzle, error } = state;
  return <section className="cm-page">
    <Link className="back-link" to="/reversing">&larr; Crackme Arcade</Link>
    {error && <div role="alert" className="error">{error} <button type="button" className="secondary small" onClick={load}>Retry</button></div>}
    {!puzzle && !error && <p role="status" className="cm-loading">Loading the cabinet...</p>}
    {puzzle && <>
      <header className="cm-level-head">
        <p className="cm-kicker">{puzzle.track}{puzzle.boss ? ' · boss cabinet' : ` · cabinet ${puzzle.n}`}</p>
        <h1>{puzzle.title}</h1>
        <div className="tags">
          <span className="tag tag-points">{puzzle.points} pts</span>
          <span className="tag">{STATUS_LABEL[puzzle.status]}</span>
          {puzzle.boss && <span className="tag tag-hard">Boss</span>}
        </div>
        <p className="cm-briefing">{puzzle.briefing}</p>
      </header>
      <Debugger puzzle={puzzle} input={input} onInput={setInput} />
      <div className="cm-lower">
        <SubmitForm key={puzzle.id} puzzle={puzzle} input={input} canSubmit={user?.role !== 'admin'} onSolved={load} />
        <HintPanel puzzle={puzzle} onOpened={load} disabled={user?.role === 'admin'} />
      </div>
      <IsaReference />
    </>}
  </section>;
}
