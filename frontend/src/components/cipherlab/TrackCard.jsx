import { Link } from 'react-router-dom';
import ProgressBar from './ProgressBar.jsx';
import { STATUS_LABEL, TRACK_BLURB, speedrunText } from './helpers.js';

export default function TrackCard({ track }) {
  const run = speedrunText(track.speedrun);
  return <article className={`cl-track cl-track-${track.id}${track.complete ? ' is-done' : ''}`} aria-labelledby={`cl-track-${track.id}`}>
    <header>
      <p className="cl-kicker">{track.difficulty} · {TRACK_BLURB[track.id]}</p>
      <h2 id={`cl-track-${track.id}`}>{track.title}</h2>
      <p className="cl-story">{track.story}</p>
    </header>
    <ProgressBar done={track.solved} total={track.total} label={`${track.title}: ${track.solved} of ${track.total} levels solved`} />
    <p className="cl-points"><strong>{track.pointsEarned}</strong> / {track.maxPoints} points{!track.hintsAllowed && ' · no hints'}</p>
    {run && <p className={`cl-badge cl-badge-${track.speedrun.badge ?? 'plain'}`}>{run}</p>}
    <ol className="cl-ladder">
      {track.levels.map((level) => {
        const body = <>
          <span className="cl-rung-n" aria-hidden="true">{level.boss ? '★' : level.n}</span>
          <span className="cl-rung-title">{level.title}</span>
          <span className="cl-rung-meta">{level.points} pts · <span className={`cl-status cl-status-${level.status}`}>{STATUS_LABEL[level.status]}</span></span>
        </>;
        return <li key={level.id} className={`cl-rung is-${level.status}${level.boss ? ' is-boss' : ''}`}>
          {level.status === 'locked'
            ? <span className="cl-rung-link" aria-disabled="true">{body}</span>
            : <Link className="cl-rung-link" to={`/cipherlab/${level.id}`}>{body}</Link>}
        </li>;
      })}
    </ol>
  </article>;
}
