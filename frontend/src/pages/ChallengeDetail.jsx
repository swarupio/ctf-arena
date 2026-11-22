import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  extendInstance, getChallenge, startInstance, stopInstance, submitFlag,
} from '../api/challenges.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { safeLink } from '../api/safeUrl.js';
import { challengeErrorMessage, challengePanels, formatCountdown, gateFromError, isExpired, solveCountLabel } from './challengeHelpers.js';
import { EventClosedPanel, GateCard, NoDockerPanel } from './ChallengePanels.jsx';
import { phaseAt } from '../event/logic.js';
import { useEventClock } from '../event/useEventClock.js';
import { announce } from './socialHelpers.js';
import Debrief from '../debrief/Debrief.jsx';
import './Challenge.css';

// Keyed by id so moving between challenges starts from clean state.
export default function ChallengeDetail() {
  const { id } = useParams();
  return <ChallengeView key={id} id={id} />;
}

function ChallengeView({ id }) {
  const { user, profile } = useAuth();
  const { event, nowMs } = useEventClock();
  const [teamIssue, setTeamIssue] = useState(null); // 'no-team' | 'banned', learned from a server refusal
  const [challenge, setChallenge] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [flag, setFlag] = useState('');
  const [result, setResult] = useState(null);
  const [now, setNow] = useState(Date.now());
  const lock = useRef(false);

  async function load() {
    try { setChallenge(await getChallenge(id)); setError(''); }
    catch (failure) { setError(challengeErrorMessage(failure)); }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- load is recreated every render; re-fetch only when id changes
  useEffect(() => { load(); }, [id]);

  const instance = challenge?.myInstance;
  useEffect(() => {
    if (!instance) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the timer is keyed on the instance id, not the object
  }, [instance?.id]);
  // When the countdown ends the reaper removes the container; refresh to match.
  const expired = Boolean(instance) && isExpired(instance.expiresAt, now);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- load is recreated every render; re-run only when expired flips
  useEffect(() => { if (expired) load(); }, [expired]);

  async function run(action, success) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try { await action(); if (success) setNotice(success); await load(); }
    catch (failure) { setTeamIssue(gateFromError(failure)); setError(challengeErrorMessage(failure)); }
    finally { lock.current = false; setBusy(false); }
  }

  async function submit(event) {
    event.preventDefault();
    if (lock.current || !flag.trim()) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const outcome = await submitFlag(id, flag.trim());
      setResult(outcome);
      announce(outcome); // cosmetic celebration (first blood / first flag / new badge)
      if (outcome.correct) { setFlag(''); await load(); }
    } catch (failure) { setTeamIssue(gateFromError(failure)); setError(challengeErrorMessage(failure)); }
    finally { lock.current = false; setBusy(false); }
  }

  if (!challenge && error) return <section className="challenges"><p role="alert" className="error">{error}</p><Link to="/challenges">Back to challenges</Link></section>;
  if (!challenge) return <p role="status">Loading challenge…</p>;
  const solved = challenge.solvedByMyTeam;
  const panels = challengePanels({
    role: user?.role, type: challenge.type, dockerAvailable: challenge.dockerAvailable, solved, hasInstance: Boolean(instance),
    hasTeam: teamIssue === 'no-team' ? false : profile ? Boolean(profile.team) : undefined,
    banned: teamIssue === 'banned' || profile?.banned === true,
    eventPhase: event ? phaseAt(event, nowMs) : 'none',
  });

  return <section className="challenge-detail">
    <Link className="back-link" to="/challenges">← All challenges</Link>
    <h1>{challenge.title} {solved && <span className="badge">Captured</span>}</h1>
    <div className="tags">
      <span className="tag">{challenge.category}</span>
      <span className={`tag tag-${challenge.difficulty}`}>{challenge.difficulty}</span>
      <span className="tag tag-points">{challenge.points} pts</span>
      {challenge.solveCount != null && <span className="tag">{solveCountLabel(challenge.solveCount)}</span>}
    </div>
    <div className="challenge-body">
      <div className="challenge-main">
        <div className="challenge-description">{challenge.description}</div>
        {challenge.attachments.length > 0 && <ul className="attachments">
          {challenge.attachments.map((file) => <li key={file.url}>{safeLink(file.url) ? <a href={safeLink(file.url)} download>{file.name}</a> : file.name}</li>)}
        </ul>}
      </div>

      <div className="challenge-side">
        {panels.gate && <GateCard gate={panels.gate} challenge={challenge} />}

        {panels.instance === 'no-docker' && <NoDockerPanel />}
        {(panels.instance === 'running' || panels.instance === 'ready') && <div className="instance-panel">
          <h2>Instance</h2>
          {instance ? <>
            <p>Status: <strong>{instance.status}</strong> · Time left: <strong className="countdown">{formatCountdown(instance.expiresAt, now)}</strong></p>
            <p>Connect: {safeLink(instance.url) ? <a href={safeLink(instance.url)} target="_blank" rel="noreferrer">{instance.url}</a> : instance.url}</p>
            <div className="actions">
              <button className="secondary" disabled={busy || instance.extended} title={instance.extended ? 'Already extended once' : undefined} onClick={() => run(() => extendInstance(instance.id), 'Instance extended by 15 minutes.')}>{instance.extended ? 'Extended' : 'Extend +15 min'}</button>
              <button className="secondary" disabled={busy} onClick={() => run(() => stopInstance(instance.id), 'Instance stopped.')}>Stop</button>
            </div>
          </> : <>
            <p>Your team gets its own private container with its own flag.</p>
            <button disabled={busy} onClick={() => run(() => startInstance(id), 'Instance started.')}>{busy ? 'Working…' : 'Start instance'}</button>
          </>}
        </div>}

        {panels.submit === 'form' && <form className="flag-form" onSubmit={submit}>
          <h2>Submit flag</h2>
          <label htmlFor="flag">Flag</label>
          <input id="flag" value={flag} onChange={(event) => setFlag(event.target.value)} placeholder="CTF{...}" autoComplete="off" disabled={busy} maxLength={200} />
          <button disabled={busy || !flag.trim()}>{busy ? 'Checking…' : 'Submit'}</button>
        </form>}
        {(panels.submit === 'event-not-started' || panels.submit === 'event-ended') && <EventClosedPanel phase={panels.submit === 'event-ended' ? 'ended' : 'upcoming'} />}

        {solved && !result && !panels.gate && <p className="notice" role="status">Your team has captured this flag.</p>}
        {notice && <p className="notice" role="status">{notice}</p>}
        {result && <p role="status" className={result.correct ? 'notice' : 'error'}>{result.message}{result.correct ? ` +${result.pointsAwarded} points.` : ''}</p>}
        {error && <p role="alert" className="error">{error}</p>}
      </div>
    </div>
    <Debrief levelKey={`challenges:${challenge.type}:${challenge.slug}`} captured={Boolean(solved)} />
  </section>;
}
