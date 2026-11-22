import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { Link, Route, Routes } from 'react-router-dom';
import { getOverview } from '../api/cipherlab.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { useTeam } from '../layout/TeamContext.jsx';
import ProgressBar from '../components/cipherlab/ProgressBar.jsx';
import TrackCard from '../components/cipherlab/TrackCard.jsx';
import { cipherErrorMessage, nextLevel, streakText, unlockText } from '../components/cipherlab/helpers.js';
import '../components/cipherlab/cipherlab.css';
import '../overview.css';

const CipherLabPlay = lazy(() => import('./CipherLabPlay.jsx'));

function Overview() {
  const { user } = useAuth();
  const { team } = useTeam() ?? {};
  const [state, setState] = useState({ data: null, error: '' });
  const load = useCallback(async () => {
    setState({ data: null, error: '' });
    try { setState({ data: await getOverview(), error: '' }); }
    catch (error) { setState({ data: null, error: cipherErrorMessage(error) }); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const { data, error } = state;
  const next = nextLevel(data);
  const noTeam = user?.role !== 'admin' && team === null;
  return <section className="cl-page ov-page">
    <header className="cl-hero ov-header">
      <Link className="back-games" to="/range">Back to the Range</Link>
      <p className="cl-kicker">codebreaker agency</p>
      <h1>Cipher Lab</h1>
      <p className="cl-lead ov-lead">
        Four tracks of coded messages, from a rookie desk to the Black Chamber. Your puzzles are unique to your team, so
        nobody can copy your answers. Crack a level, earn its fixed points and unlock new decoder tools.
      </p>
    </header>
    {user?.role === 'admin' && <p className="notice ov-note">Admin preview: you can open every level, but only players can submit answers.</p>}
    {noTeam && !error && <p role="alert" className="error">Join or create a team before you play. Your puzzles are unique to your team.</p>}
    {error && <div role="alert" className="error">{error} <button type="button" className="secondary small" onClick={load}>Retry</button></div>}
    {!data && !error && <p role="status" className="cl-loading">Loading the lab…</p>}
    {data && <>
      <div className="cl-summary ov-summary">
        <div className="ov-stat ov-stat--wide">
          <span className="cl-stat-label">Overall</span>
          <ProgressBar done={data.solved} total={data.total} label={`${data.solved} of ${data.total} flags captured`} />
        </div>
        <div className="ov-stat"><span className="cl-stat-label">Points</span><strong>{data.pointsEarned}<span className="cl-dim ov-dim"> / {data.maxPoints}</span></strong></div>
        <div className="ov-stat"><span className="cl-stat-label">Streak</span><strong className={data.streak > 1 ? 'cl-streak is-hot' : 'cl-streak'}>{data.streak > 1 && <span aria-hidden="true">{'🔥'} </span>}{streakText(data.streak)}</strong></div>
        {next && <Link className="button" to={`/cipherlab/${next.id}`}>{data.solved > 0 ? 'Continue' : 'Start'}: {next.title}</Link>}
      </div>
      <div className="cl-tracks ov-grid" data-count={data.tracks.length}>{data.tracks.map((track) => <TrackCard key={track.id} track={track} />)}</div>
      <section className="cl-box" aria-labelledby="cl-tools-title">
        <h2 id="cl-tools-title">Decoder toolbox</h2>
        <p className="cl-note">Tools unlock as you clear levels in any track. Open a level to use them.</p>
        <ul className="cl-toollist">
          {data.toolbox.map((tool) => <li key={tool.id} className={tool.unlocked ? 'is-open' : 'is-locked'}>
            <strong>{tool.unlocked ? tool.name : `Locked: ${tool.name}`}</strong>
            <span>{tool.unlocked ? tool.description : `${unlockText(tool.unlockedBy)}.`}</span>
          </li>)}
        </ul>
      </section>
    </>}
  </section>;
}

export default function CipherLab() {
  return <Routes>
    <Route index element={<Overview />} />
    <Route path=":levelId" element={<Suspense fallback={<p role="status" className="cl-loading">Loading level…</p>}><CipherLabPlay /></Suspense>} />
  </Routes>;
}
