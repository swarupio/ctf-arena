import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { BOUNTY_NOTE, badgeText, findFlags, formatBounty, percent, severityMeta } from './helpers.js';

// Cosmetic bounty-style badge, "Severity: HIGH · bounty $500", shown after a solve. It carries no score: points come from the server.
export function BountyBadge({ severity, bountyUsd, fresh = false }) {
  const meta = severityMeta(severity);
  if (!meta) { return null; }
  return <span className={`wl-badge is-${meta.tone}${fresh ? ' is-fresh' : ''}`}>
    <span>{badgeText(meta, bountyUsd)}</span>
  </span>;
}

export function ProgressOverview({ totals, inspector }) {
  const pct = percent(totals.pointsEarned, totals.points);
  return <section className="wl-overview ov-summary" aria-label="Your bug bounty progress">
    <div className="wl-stat ov-stat"><span>labs cleared</span><strong>{totals.solved}/{totals.labs}</strong></div>
    <div className="wl-stat ov-stat"><span>points</span><strong>{totals.pointsEarned}<small>/{totals.points}</small></strong></div>
    <div className="wl-stat ov-stat" title={BOUNTY_NOTE}><span>bounty earned</span><strong>{formatBounty(totals.bountyUsd)}</strong></div>
    <div className="wl-stat ov-stat"><span>tools unlocked</span><strong>{inspector.level}/{inspector.features.length}</strong></div>
    <div className="ov-progress ov-span-all">
      <div className="ov-bar" role="progressbar" aria-label="Points earned" aria-valuemin={0} aria-valuemax={totals.points} aria-valuenow={totals.pointsEarned}>
        <span style={{ width: `${pct}%` }} />
      </div>
    </div>
    {inspector.next
      ? <p className="wl-muted ov-span-all">Next inspector upgrade: <strong>{inspector.next.label}</strong> after {inspector.next.solvesNeeded} more solved lab{inspector.next.solvesNeeded === 1 ? '' : 's'}.</p>
      : <p className="wl-muted ov-span-all">Inspector fully upgraded. Nothing left to unlock but glory.</p>}
  </section>;
}

export function LabCard({ lab }) {
  const state = lab.solved ? 'solved' : lab.locked ? 'locked' : lab.available ? 'open' : 'offline';
  const body = <>
    <div className="wl-card-top">
      <span className="wl-chip">{lab.boss ? 'BOSS' : 'lab'}</span>
      <span className="wl-pts">{lab.pointsEarned > 0 ? lab.pointsEarned : lab.points} pts</span>
    </div>
    <h3>{lab.title}</h3>
    <p>{lab.summary}</p>
    <div className="wl-card-foot">
      {lab.solved && <BountyBadge severity={lab.severity} bountyUsd={lab.bountyUsd} />}
      {state === 'locked' && <span className="wl-muted">{lab.lockedReason}</span>}
      {state === 'offline' && <span className="wl-muted">Not set up yet</span>}
      {state === 'open' && <span className="wl-go">{lab.hintCount === 0 ? 'No hints. Good luck.' : 'Start hacking'} &rarr;</span>}
      {state === 'solved' && <span className="wl-go">Revisit</span>}
    </div>
  </>;
  const label = `${lab.title}, ${state}, ${lab.points} points`;
  return <li className={`wl-card is-${state}${lab.boss ? ' is-boss' : ''}`}>
    {state === 'locked' || state === 'offline'
      ? <div className="wl-card-link" aria-label={label} role="group">{body}</div>
      : <Link className="wl-card-link" to={`/weblab/${lab.slug}`} aria-label={label}>{body}</Link>}
  </li>;
}

export function TrackSection({ track }) {
  const headingId = useId();
  return <section className="wl-track" data-theme={track.theme} aria-labelledby={headingId}>
    <header className="wl-track-head">
      <div>
        <p className="wl-kicker">{track.title} track{track.cleared ? ' (cleared)' : ''}</p>
        <h2 id={headingId}>{track.company.name}</h2>
        <p className="wl-muted">{track.company.brief}</p>
      </div>
      <div className="wl-track-score" aria-label={`${track.pointsEarned} of ${track.points} points`}>
        <strong>{track.pointsEarned}</strong><span>/{track.points} pts</span>
        <small>{track.solved}/{track.total} labs</small>
      </div>
    </header>
    <ul className="wl-cards ov-grid ov-grid--compact" data-count={track.labs.length}>{track.labs.map((lab) => <LabCard key={lab.id} lab={lab} />)}</ul>
  </section>;
}

// Flag box: submits to the server, which decides correctness. Detected flags in the response can be pasted in one click.
export function FlagBox({ onSubmit, solved, response }) {
  const id = useId();
  const [flag, setFlag] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const suggestions = findFlags(response?.body);
  const submit = async (event) => {
    event.preventDefault();
    if (!flag.trim() || busy) { return; }
    setBusy(true);
    try { setResult(await onSubmit(flag.trim())); } catch (error) { setResult({ error }); } finally { setBusy(false); }
  };
  return <form className="wl-flagbox" onSubmit={submit}>
    <label htmlFor={id}>Flag</label>
    <div className="wl-row">
      <input id={id} className="wl-grow" value={flag} maxLength={200} placeholder="CTF{...}" autoComplete="off" spellCheck="false" onChange={(event) => setFlag(event.target.value)} />
      <button type="submit" disabled={busy || !flag.trim()}>{busy ? 'Checking...' : 'Submit flag'}</button>
    </div>
    {suggestions.length > 0 && <p className="wl-muted">
      Found in the response: <button type="button" className="secondary small" onClick={() => setFlag(suggestions[0])}>use {suggestions[0].slice(0, 16)}...</button>
    </p>}
    {solved && !result && <p className="wl-notice is-success" role="status">Your team already cashed this bounty.</p>}
    <div aria-live="polite">{result && !result.error && <p className={`wl-notice ${result.correct ? 'is-success' : 'is-error'}`}>{result.message}</p>}</div>
    {result?.error && <p className="wl-notice is-error" role="alert">{result.error.message}</p>}
  </form>;
}
