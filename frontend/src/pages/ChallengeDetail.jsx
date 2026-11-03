import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  extendInstance, getChallenge, startInstance, stopInstance, submitFlag,
} from '../api/challenges.js';
import { challengeErrorMessage, formatCountdown, isExpired } from './challengeHelpers.js';
import './Challenge.css';

export default function ChallengeDetail() {
  const { id } = useParams();
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
  useEffect(() => { load(); }, [id]);

  const instance = challenge?.myInstance;
  useEffect(() => {
    if (!instance) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [instance?.id]);
  // When the countdown ends the reaper removes the container; refresh to match.
  const expired = Boolean(instance) && isExpired(instance.expiresAt, now);
  useEffect(() => { if (expired) load(); }, [expired]);

  async function run(action, success) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try { await action(); if (success) setNotice(success); await load(); }
    catch (failure) { setError(challengeErrorMessage(failure)); }
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
      if (outcome.correct) { setFlag(''); await load(); }
    } catch (failure) { setError(challengeErrorMessage(failure)); }
    finally { lock.current = false; setBusy(false); }
  }

  if (!challenge && error) return <section className="challenges"><p role="alert" className="error">{error}</p><Link to="/challenges">Back to challenges</Link></section>;
  if (!challenge) return <p role="status">Loading challenge…</p>;
  const solved = challenge.solvedByMyTeam;

  return <section className="challenge-detail">
    <Link className="back-link" to="/challenges">← All challenges</Link>
    <h1>{challenge.title} {solved && <span className="badge">Solved</span>}</h1>
    <div className="tags">
      <span className="tag">{challenge.category}</span>
      <span className={`tag tag-${challenge.difficulty}`}>{challenge.difficulty}</span>
      <span className="tag tag-points">{challenge.points} pts</span>
      <span className="tag">{challenge.solveCount} {challenge.solveCount === 1 ? 'solve' : 'solves'}</span>
    </div>
    <div className="challenge-body">
      <div className="challenge-main">
        <div className="challenge-description">{challenge.description}</div>
        {challenge.attachments.length > 0 && <ul className="attachments">
          {challenge.attachments.map((file) => <li key={file.url}><a href={file.url} download>{file.name}</a></li>)}
        </ul>}
      </div>

      <div className="challenge-side">
        {challenge.type === 'docker' && <div className="instance-panel">
          <h2>Instance</h2>
          {instance ? <>
            <p>Status: <strong>{instance.status}</strong> · Time left: <strong className="countdown">{formatCountdown(instance.expiresAt, now)}</strong></p>
            <p>Connect: <a href={instance.url} target="_blank" rel="noreferrer">{instance.url}</a></p>
            <div className="actions">
              <button className="secondary" disabled={busy || instance.extended} title={instance.extended ? 'Already extended once' : undefined} onClick={() => run(() => extendInstance(instance.id), 'Instance extended by 15 minutes.')}>{instance.extended ? 'Extended' : 'Extend +15 min'}</button>
              <button className="secondary" disabled={busy} onClick={() => run(() => stopInstance(instance.id), 'Instance stopped.')}>Stop</button>
            </div>
          </> : <>
            <p>Your team gets its own private container with its own flag.</p>
            <button disabled={busy || solved} onClick={() => run(() => startInstance(id), 'Instance started.')}>{busy ? 'Working…' : 'Start instance'}</button>
          </>}
        </div>}

        <form className="flag-form" onSubmit={submit}>
          <h2>Submit flag</h2>
          <label htmlFor="flag">Flag</label>
          <input id="flag" value={flag} onChange={(event) => setFlag(event.target.value)} placeholder="CTF{...}" autoComplete="off" disabled={busy || solved} maxLength={200} />
          <button disabled={busy || solved || !flag.trim()}>{busy ? 'Checking…' : 'Submit'}</button>
        </form>

        {solved && !result && <p className="notice" role="status">Your team has solved this challenge.</p>}
        {notice && <p className="notice" role="status">{notice}</p>}
        {result && <p role="status" className={result.correct ? 'notice' : 'error'}>{result.message}{result.correct ? ` +${result.pointsAwarded} points.` : ''}</p>}
        {error && <p role="alert" className="error">{error}</p>}
      </div>
    </div>
  </section>;
}
