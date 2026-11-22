import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listTracks } from '../api/forensics.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { useTeam } from '../layout/TeamContext.jsx';
import { DIFFICULTY_LABEL, DIFFICULTY_LEVEL, describeForensicsError, progressPercent } from '../forensics/caseHelpers.js';
import '../components/forensics/forensics.css';
import '../overview.css';

function CaseFolder({ item }) {
  const level = DIFFICULTY_LEVEL[item.difficulty] ?? 1;
  const done = item.solved >= item.stages;
  const percent = progressPercent(item.solved, item.stages);
  return <article className={`ov-card fx-folder fx-level-${item.difficulty}${done ? ' is-done' : ''}`} data-tone={item.difficulty} aria-labelledby={`fx-folder-${item.id}`}>
    <div className="ov-card-head">
      <p className="ov-kicker">Case file · {DIFFICULTY_LABEL[item.difficulty]}</p>
      <p className="fx-pips" role="img" aria-label={`Difficulty ${DIFFICULTY_LABEL[item.difficulty]}: ${level} of 4`}>
        {[1, 2, 3, 4].map((pip) => <span key={pip} className={pip <= level ? 'is-on' : undefined} />)}
      </p>
      <h2 id={`fx-folder-${item.id}`}>{item.caseTitle}</h2>
      <p className="fx-muted ov-card-desc">{item.title}: {item.tagline}</p>
    </div>
    <div className="ov-card-mid">
      <div className="ov-card-stats">
        <div><span className="fx-label">stages</span><strong>{item.solved}/{item.stages}</strong></div>
        <div><span className="fx-label">points</span><strong>{item.pointsEarned}<span className="fx-total">/{item.maxPoints}</span></strong></div>
      </div>
      <div className="ov-progress">
        <div className="ov-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={`${item.caseTitle} progress`}>
          <span style={{ width: `${percent}%` }} />
        </div>
      </div>
      {done && <p className="fx-stamp">CASE CLOSED</p>}
    </div>
    <div className="ov-card-foot">
      <Link className="button" to={`/forensics/${item.id}`}>{done ? 'Review the case' : item.solved > 0 ? 'Resume the case' : 'Open the case'}<span className="fx-sr"> {item.caseTitle}</span></Link>
    </div>
  </article>;
}

export default function ForensicsDesk() {
  const { user } = useAuth();
  const { team } = useTeam() ?? {};
  const noTeam = user?.role !== 'admin' && team === null;
  const [state, setState] = useState({ tracks: null, error: '' });
  const load = useCallback(async () => {
    setState({ tracks: null, error: '' });
    try { setState({ tracks: await listTracks(), error: '' }); } catch (error) { setState({ tracks: null, error: describeForensicsError(error) }); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const { tracks, error } = state;
  const total = tracks?.reduce((sum, t) => sum + t.maxPoints, 0) ?? 0;

  return <section className="fx-page ov-page">
    <header className="ov-header">
      <Link className="back-games" to="/range">Back to the Range</Link>
      <h1>Forensics Desk</h1>
      <p className="fx-lead ov-lead">
        Four case files, from a trainee's first log to an eyes-only mystery with decoys everywhere. Investigate in your browser,
        confirm the evidence, then name the culprit. Points are fixed per question, so there is no race: take your time.
        {total > 0 && <> The whole desk is worth <strong>{total}</strong> points.</>}
      </p>
    </header>
    {user?.role === 'admin' && <p className="fx-note ov-note">Admin preview: you can browse every artefact, but only players can answer.</p>}
    {noTeam && <p className="fx-note ov-note">Answers are scored per team: <Link to="/team">create or join a team</Link> before you start.</p>}
    {error && <p role="alert" className="error">{error} <button type="button" className="secondary small" onClick={load}>Retry</button></p>}
    {!error && !tracks && <p role="status">Opening the archive...</p>}
    {tracks && <div className="fx-folders ov-grid" data-count={tracks.length}>{tracks.map((item) => <CaseFolder key={item.id} item={item} />)}</div>}
  </section>;
}
