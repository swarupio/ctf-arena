import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listLabs } from '../api/weblab.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { useTeam } from '../layout/TeamContext.jsx';
import { ProgressOverview, TrackSection } from '../components/weblab/Widgets.jsx';
import { describeError } from '../components/weblab/helpers.js';
import '../components/weblab/weblab.css';
import '../overview.css';

export default function WebLab() {
  const { user } = useAuth();
  const { team } = useTeam() ?? {};
  const noTeam = user?.role !== 'admin' && team === null;
  const [state, setState] = useState({ data: null, problem: null });

  const load = useCallback(async () => {
    setState({ data: null, problem: null });
    try { setState({ data: await listLabs(), problem: null }); }
    catch (error) { setState({ data: null, problem: describeError(error) }); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const { data, problem } = state;
  return <section className="wl-page-root ov-page">
    <header className="ov-header">
      <Link className="back-games" to="/range">Back to the Range</Link>
      <p className="ov-kicker">bug bounty</p>
      <h1>Web Exploit Lab</h1>
      <p className="wl-lead ov-lead">
        You are a bug bounty hunter. Four companies, four difficulty tracks, ten simulated websites, each with a classic
        weakness. Break in using the request inspector, find the flag, cash the bounty. Everything is a safe simulation:
        nothing you type touches a real system.
      </p>
    </header>
    {user?.role === 'admin' && <p className="wl-notice is-info">Admin preview: every lab is open, but only players can submit flags.</p>}
    {noTeam && !problem && <p className="wl-notice is-info" role="status">
      You need a team to hack: flags are per team. <Link to="/team">Go to the Team page</Link>.
    </p>}
    {!data && !problem && <p role="status" className="wl-muted">Loading the target list...</p>}
    {problem && <div className="wl-notice is-error" role="alert">
      <p>{problem.message}</p>
      {problem.kind !== 'no-team' && problem.kind !== 'banned' && <button type="button" onClick={load}>Retry</button>}
    </div>}
    {data && <>
      <ProgressOverview totals={data.totals} inspector={data.inspector} />
      {data.tracks.map((track) => <TrackSection key={track.id} track={track} />)}
    </>}
  </section>;
}
