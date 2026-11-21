import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getLevel, getOverview } from '../api/cipherlab.js';
import { useAuth } from '../auth/AuthContext.jsx';
import AnswerForm from '../components/cipherlab/AnswerForm.jsx';
import HintPanel from '../components/cipherlab/HintPanel.jsx';
import Toolbox from '../components/cipherlab/Toolbox.jsx';
import { STATUS_LABEL, cipherErrorMessage } from '../components/cipherlab/helpers.js';
import '../components/cipherlab/cipherlab.css';

const PARAM_LABELS = {
  keyLength: 'Key length', crib: 'Known start (crib)', rails: 'Rails', n: 'Modulus n', e: 'Public exponent e', salt: 'Salt',
};

function Params({ params }) {
  const shown = Object.entries(params ?? {}).filter(([key]) => PARAM_LABELS[key]);
  if (shown.length === 0 && !params?.candidates) { return null; }
  return <>
    <dl className="cl-params">
      {shown.map(([key, value]) => <div key={key}><dt>{PARAM_LABELS[key]}</dt><dd>{String(value)}</dd></div>)}
    </dl>
    {params.candidates && <details className="cl-candidates">
      <summary>Suspect list ({params.candidates.length} words)</summary>
      <p>{params.candidates.join(', ')}</p>
    </details>}
  </>;
}

export default function CipherLabPlay() {
  const { levelId } = useParams();
  const { user } = useAuth();
  const [state, setState] = useState({ puzzle: null, tools: null, error: '' });
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const [puzzle, overview] = await Promise.all([getLevel(levelId), getOverview()]);
      setState({ puzzle, tools: overview.toolbox, error: '' });
    } catch (error) {
      setState((current) => ({ ...current, puzzle: null, error: cipherErrorMessage(error) }));
    }
  }, [levelId]);

  useEffect(() => {
    setState({ puzzle: null, tools: null, error: '' });
    setCopied(false);
    void load();
  }, [load]);

  const { puzzle, tools, error } = state;
  async function copy() {
    try { await navigator.clipboard.writeText(puzzle.ciphertext); setCopied(true); } catch { setCopied(false); }
  }

  return <section className="cl-page">
    <Link className="back-link" to="/cipherlab">&larr; Cipher Lab</Link>
    {error && <div role="alert" className="error">{error} <button type="button" className="secondary small" onClick={load}>Retry</button></div>}
    {!puzzle && !error && <p role="status" className="cl-loading">Decrypting the briefing…</p>}
    {puzzle && tools && <>
      <header className="cl-level-head">
        <p className="cl-kicker">{puzzle.track}{puzzle.boss ? ' · boss level' : ` · level ${puzzle.n}`}</p>
        <h1>{puzzle.title}</h1>
        <div className="tags">
          <span className="tag tag-points">{puzzle.points} pts</span>
          <span className="tag">{STATUS_LABEL[puzzle.status]}</span>
          {puzzle.boss && <span className="tag tag-hard">Boss</span>}
        </div>
        <p className="cl-briefing">{puzzle.briefing}</p>
      </header>
      <div className="cl-layout">
        <div className="cl-main">
          <section className="cl-box cl-cipher" aria-labelledby="cl-cipher-title">
            <h2 id="cl-cipher-title">Intercepted message</h2>
            <pre className="cl-ciphertext" tabIndex={0} aria-label="Ciphertext">{puzzle.ciphertext}</pre>
            <button type="button" className="secondary small" onClick={copy}>{copied ? 'Copied' : 'Copy ciphertext'}</button>
            <Params params={puzzle.params} />
          </section>
          <AnswerForm key={puzzle.id} puzzle={puzzle} canSubmit={user?.role !== 'admin'} onSolved={load} />
          <HintPanel puzzle={puzzle} onOpened={load} disabled={user?.role === 'admin'} />
        </div>
        <Toolbox key={puzzle.id} tools={tools} puzzle={puzzle} />
      </div>
    </>}
  </section>;
}
