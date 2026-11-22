import { Link } from 'react-router-dom';
import { STATUS_LABEL, TRACK_BLURB, percent } from './helpers.js';

export function ProgressBar({ done, total, label }) {
  return <div className="ov-progress has-label">
    <span className="ov-progress-label">{done}/{total}</span>
    <div className="ov-bar" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label={label}>
      <span style={{ width: `${percent(done, total)}%` }} />
    </div>
  </div>;
}

export default function TrackCard({ track }) {
  return <article className={`ov-card cm-track cm-track-${track.id}${track.complete ? ' is-done' : ''}`} data-tone={track.id} aria-labelledby={`cm-track-${track.id}`}>
    <header className="ov-card-head">
      <p className="cm-kicker">{track.difficulty} &middot; {TRACK_BLURB[track.id]}</p>
      <h2 id={`cm-track-${track.id}`}>{track.title}</h2>
      <p className="cm-story ov-card-desc">{track.story}</p>
    </header>
    <div className="ov-card-mid">
      <ProgressBar done={track.solved} total={track.total} label={`${track.title}: ${track.solved} of ${track.total} flags captured`} />
      <p className="cm-points"><strong>{track.pointsEarned}</strong> / {track.maxPoints} points{!track.hintsAllowed && ' · no hints'}</p>
    </div>
    <div className="ov-card-low">
    <ol className="cm-ladder">
      {track.levels.map((level) => {
        const body = <>
          <span className="cm-rung-n" aria-hidden="true">{level.boss ? '★' : level.n}</span>
          <span className="cm-rung-title">{level.title}{level.boss ? ' (boss)' : ''}</span>
          <span className="cm-rung-meta">{level.points} pts &middot; <span className={`cm-status cm-status-${level.status}`}>{STATUS_LABEL[level.status]}</span>{level.patched && <> &middot; <span className="cm-patched">Patched</span></>}</span>
        </>;
        return <li key={level.id} className={`cm-rung is-${level.status}${level.boss ? ' is-boss' : ''}`}>
          {level.status === 'locked'
            ? <span className="cm-rung-link" aria-disabled="true">{body}</span>
            : <Link className="cm-rung-link" to={`/reversing/${level.id}`}>{body}</Link>}
        </li>;
      })}
    </ol>
    </div>
  </article>;
}
