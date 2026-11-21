import { Link } from 'react-router-dom';
import { STATUS_LABEL, TRACK_BLURB, percent } from './helpers.js';

export function ProgressBar({ done, total, label }) {
  return <div className="cm-progress" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label={label}>
    <span className="cm-progress-fill" style={{ width: `${percent(done, total)}%` }} />
    <span className="cm-progress-text">{done}/{total}</span>
  </div>;
}

export default function TrackCard({ track }) {
  return <article className={`cm-track cm-track-${track.id}${track.complete ? ' is-done' : ''}`} aria-labelledby={`cm-track-${track.id}`}>
    <header>
      <p className="cm-kicker">{track.difficulty} &middot; {TRACK_BLURB[track.id]}</p>
      <h2 id={`cm-track-${track.id}`}>{track.title}</h2>
      <p className="cm-story">{track.story}</p>
    </header>
    <ProgressBar done={track.solved} total={track.total} label={`${track.title}: ${track.solved} of ${track.total} cabinets solved`} />
    <p className="cm-points"><strong>{track.pointsEarned}</strong> / {track.maxPoints} points{!track.hintsAllowed && ' · no hints'}</p>
    <ol className="cm-ladder">
      {track.levels.map((level) => {
        const body = <>
          <span className="cm-rung-n" aria-hidden="true">{level.boss ? '★' : level.n}</span>
          <span className="cm-rung-title">{level.title}{level.boss ? ' (boss)' : ''}</span>
          <span className="cm-rung-meta">{level.points} pts &middot; <span className={`cm-status cm-status-${level.status}`}>{STATUS_LABEL[level.status]}</span></span>
        </>;
        return <li key={level.id} className={`cm-rung is-${level.status}${level.boss ? ' is-boss' : ''}`}>
          {level.status === 'locked'
            ? <span className="cm-rung-link" aria-disabled="true">{body}</span>
            : <Link className="cm-rung-link" to={`/reversing/${level.id}`}>{body}</Link>}
        </li>;
      })}
    </ol>
  </article>;
}
