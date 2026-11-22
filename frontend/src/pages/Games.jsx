import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet } from '../api/client.js';
import { GAMES } from '../games/registry.js';
import { aggregate, percentOf, recommendNext, sumTracks } from '../games/progress.js';
import '../overview.css';
import RangeOnboarding from '../onboarding/RangeOnboarding.jsx';
import './Games.css';

function Bar({ label, value }) {
  return <div className="ov-progress">
    <div className="ov-bar" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}>
      <span style={{ width: `${value}%` }} />
    </div>
  </div>;
}

function GameCard({ game, state, recommended, onRetry }) {
  const done = state?.tracks ? sumTracks(state.tracks) : null;
  return <article className={`ov-card gm-card${recommended ? ' is-next' : ''}`} aria-labelledby={`gm-${game.id}`}>
    <div className="ov-card-head">
      {recommended ? <p className="gm-badge">Recommended next</p> : <span className="gm-badge-slot" aria-hidden="true" />}
      <h2 id={`gm-${game.id}`}>{game.title}</h2>
      <p className="gm-pitch">{game.pitch}</p>
    </div>
    <div className="ov-card-mid">
      {!state && <p role="status" className="gm-muted">Loading progress…</p>}
      {state?.error && <p role="alert" className="gm-error">Progress unavailable. <button type="button" className="secondary small" onClick={onRetry}>Retry</button></p>}
      {done && <ul className="gm-tracks" aria-label="Difficulty tracks">
        {state.tracks.map((track) => <li key={track.id} className={track.total > 0 && track.solved >= track.total ? 'is-done' : undefined}>
          <span>{track.title}</span><strong>{track.solved}/{track.total}</strong>
        </li>)}
      </ul>}
    </div>
    <div className="ov-card-low">
      {done && <>
        <Bar label={`${game.title} progress`} value={done.percent} />
        <p className="gm-stats"><span>{done.solved}/{done.total} flags captured</span><span>{done.pointsEarned}/{done.maxPoints} pts</span></p>
      </>}
    </div>
    <div className="ov-card-foot">
      <Link className="button" to={game.path}>Open<span className="gm-sr"> {game.title}</span></Link>
    </div>
  </article>;
}

export default function Games() {
  const [states, setStates] = useState({});

  // Each category loads on its own, so one slow or failing endpoint never holds back the rest.
  const load = useCallback((game, isActive) => {
    const set = (value) => { if (isActive()) setStates((current) => ({ ...current, [game.id]: value })); };
    apiGet(game.overview, { ttl: 10_000, swr: 60_000, onRevalidate: (data) => set(game.summarize(data)) })
      .then((data) => set(game.summarize(data)))
      .catch((error) => set({ error: error?.message || 'failed' }));
  }, []);

  useEffect(() => {
    let active = true;
    GAMES.forEach((game) => load(game, () => active));
    return () => { active = false; };
  }, [load]);

  const retry = (game) => {
    setStates((current) => ({ ...current, [game.id]: undefined }));
    load(game, () => true);
  };
  const results = GAMES.filter((game) => states[game.id]).map((game) => ({ id: game.id, ...states[game.id] }));
  const total = aggregate(results);
  const next = recommendNext(results);
  const nextGame = next ? GAMES.find((game) => game.id === next.id) : null;
  const loaded = results.length === GAMES.length;

  return <section className="gm-page ov-page">
    <header className="ov-header">
      <h1>The Range</h1>
      <p className="gm-lead ov-lead">Train on the Range. Compete in the Arena. Pick a category, work through its tracks and capture flags for your team.</p>
      <p className="gm-muted"><Link to="/skills">Skills map</Link>: see which skills each flag teaches.</p>
    </header>

    <RangeOnboarding />

    <section className="gm-summary" aria-labelledby="gm-summary-heading">
      <h2 id="gm-summary-heading">Range progress</h2>
      {total.games === 0 && !loaded && <p role="status" className="gm-muted">Counting your progress…</p>}
      {total.games > 0 && <>
        <p className="gm-big"><strong>{total.solved}</strong>/{total.total} flags captured <span aria-hidden="true">·</span> <strong>{total.pointsEarned}</strong>/{total.maxPoints} points</p>
        <Bar label="Range progress" value={percentOf(total.solved, total.total)} />
        {total.failed > 0 && <p className="gm-muted">{total.failed} {total.failed === 1 ? 'category' : 'categories'} could not be counted.</p>}
      </>}
      {nextGame && <p className="gm-next">Recommended next: <Link to={nextGame.path}>{nextGame.title}</Link>, {next.track.title} ({next.track.total - next.track.solved} left)</p>}
      {loaded && total.total > 0 && !next && total.failed === 0 && <p className="gm-next">Every flag captured. Nicely done.</p>}
    </section>

    <div className="gm-grid ov-grid" data-count={GAMES.length}>
      {GAMES.map((game) => <GameCard key={game.id} game={game} state={states[game.id]} recommended={next?.id === game.id} onRetry={() => retry(game)} />)}
    </div>
  </section>;
}
