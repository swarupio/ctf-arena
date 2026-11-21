import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getOverview } from '../api/crackme.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { useTeam } from '../layout/TeamContext.jsx';
import TrackCard, { ProgressBar } from '../components/crackme/TrackCard.jsx';
import { crackmeErrorMessage, nextLevel, streakText } from '../components/crackme/helpers.js';
import '../components/crackme/crackme.css';

export default function CrackmeArcade() {
  const { user } = useAuth();
  const { team } = useTeam() ?? {};
  const [state, setState] = useState({ data: null, error: '' });
  const load = useCallback(async () => {
    setState({ data: null, error: '' });
    try { setState({ data: await getOverview(), error: '' }); }
    catch (error) { setState({ data: null, error: crackmeErrorMessage(error) }); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const { data, error } = state;
  const next = nextLevel(data);
  const noTeam = user?.role !== 'admin' && team === null;
  return <section className="cm-page">
    <header className="cm-hero">
      <p className="cm-kicker">insert coin</p>
      <h1>Crackme Arcade</h1>
      <p className="cm-lead">
        Every cabinet in the arcade has copy protection: a small program that decides whether your input is the right code.
        Read its listing, step through it in the debugger, work out the rule and type the code that makes it ACCEPT.
        It is all simulated, nothing real is ever run. Your cabinets are unique to your team.
      </p>
    </header>
    {user?.role === 'admin' && <p className="notice">Admin preview: you can open every cabinet, but only players can submit.</p>}
    {noTeam && !error && <p role="alert" className="error">Join or create a team before you play. Your cabinets are unique to your team.</p>}
    {error && <div role="alert" className="error">{error} <button type="button" className="secondary small" onClick={load}>Retry</button></div>}
    {!data && !error && <p role="status" className="cm-loading">Warming up the cabinets...</p>}
    {data && <>
      <div className="cm-summary">
        <div>
          <span className="cm-stat-label">Overall</span>
          <ProgressBar done={data.solved} total={data.total} label={`${data.solved} of ${data.total} cabinets solved`} />
        </div>
        <div><span className="cm-stat-label">Points</span><strong>{data.pointsEarned}<span className="cm-dim"> / {data.maxPoints}</span></strong></div>
        <div><span className="cm-stat-label">Streak</span><strong>{streakText(data.streak)}</strong></div>
        {next && <Link className="button" to={`/reversing/${next.id}`}>{data.solved > 0 ? 'Continue' : 'Start'}: {next.title}</Link>}
      </div>
      <div className="cm-tracks">{data.tracks.map((track) => <TrackCard key={track.id} track={track} />)}</div>
    </>}
  </section>;
}
