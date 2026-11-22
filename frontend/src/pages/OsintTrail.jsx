import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listCases } from '../api/osint.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { useTeam } from '../layout/TeamContext.jsx';
import { DIFFICULTY_LABEL, DIFFICULTY_LEVEL, describeOsintError, progressPercent } from '../osint/helpers.js';
import '../components/osint/osint.css';
import '../overview.css';

function CaseFolder({ item }) {
  const level = DIFFICULTY_LEVEL[item.difficulty] ?? 1;
  const done = item.solved >= item.questions;
  const percent = progressPercent(item.solved, item.questions);
  return <article className={`ov-card os-folder os-level-${item.difficulty}${done ? ' is-done' : ''}`} data-tone={item.difficulty} aria-labelledby={`os-folder-${item.id}`}>
    <div className="ov-card-head">
      <p className="ov-kicker">Case file · {DIFFICULTY_LABEL[item.difficulty]}</p>
      <p className="os-pips" role="img" aria-label={`Difficulty ${DIFFICULTY_LABEL[item.difficulty]}: ${level} of 4`}>
        {[1, 2, 3, 4].map((pip) => <span key={pip} className={pip <= level ? 'is-on' : undefined} />)}
      </p>
      <h2 id={`os-folder-${item.id}`}>{item.caseTitle}</h2>
      <p className="os-muted ov-card-desc">{item.tagline}</p>
    </div>
    <div className="ov-card-mid">
      <div className="ov-card-stats">
        <div><span className="os-label">questions</span><strong>{item.solved}/{item.questions}</strong></div>
        <div><span className="os-label">points</span><strong>{item.pointsEarned}<span className="os-total">/{item.maxPoints}</span></strong></div>
      </div>
      <p className="os-muted">{item.hints ? 'Free hints available.' : 'No hints.'}</p>
      <div className="ov-progress">
        <div className="ov-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={`${item.caseTitle} progress`}><span style={{ width: `${percent}%` }} /></div>
      </div>
      {done && <p className="os-stamp">CASE CLOSED</p>}
    </div>
    <div className="ov-card-foot">
      <Link className="button" to={`/osint/${item.id}`}>{done ? 'Review the case' : item.solved > 0 ? 'Resume the case' : 'Open the case'}<span className="os-sr"> {item.caseTitle}</span></Link>
    </div>
  </article>;
}

export default function OsintTrail() {
  const { user } = useAuth();
  const { team } = useTeam() ?? {};
  const noTeam = user?.role !== 'admin' && team === null;
  const [state, setState] = useState({ cases: null, error: '' });
  const load = useCallback(async () => {
    setState({ cases: null, error: '' });
    try { setState({ cases: await listCases(), error: '' }); } catch (error) { setState({ cases: null, error: describeOsintError(error) }); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const { cases, error } = state;
  const total = cases?.reduce((sum, c) => sum + c.maxPoints, 0) ?? 0;

  return <section className="os-page ov-page">
    <header className="ov-header">
      <Link className="back-games" to="/range">Back to the Range</Link>
      <p className="ov-kicker">open-source intelligence</p>
      <h1>OSINT Trail</h1>
      <p className="os-lead ov-lead">
        Open-source intelligence in a fully fictional world: invented people, an invented town, a pretend company, a pretend network.
        Read the feed, the archive, the registry, the map and the photos, cross-check what you find and name who to look for, or where.
        Points are fixed per question, so there is no race. {total > 0 && <>The whole trail is worth <strong>{total}</strong> points.</>}
      </p>
    </header>
    {user?.role === 'admin' && <p className="os-note ov-note">Admin preview: you can browse every case, but only players can answer.</p>}
    {noTeam && <p className="os-note ov-note">Answers are scored per team: <Link to="/team">create or join a team</Link> before you start.</p>}
    {error && <p role="alert" className="error">{error} <button type="button" className="secondary small" onClick={load}>Retry</button></p>}
    {!error && !cases && <p role="status">Opening the archive...</p>}
    {cases && <div className="os-folders ov-grid" data-count={cases.length}>{cases.map((item) => <CaseFolder key={item.id} item={item} />)}</div>}
  </section>;
}
