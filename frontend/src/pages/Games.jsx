import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet } from '../api/client.js';
import { GAMES } from '../games/registry.js';
import { aggregate, percentOf, recommendNext, sumTracks } from '../games/progress.js';
import './Games.css';

function Bar({ label, value }) {
  return <div className="gm-bar" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}>
    <span style={{ width: `${value}%` }} />
  </div>;
}

function GameCard({ game, state, recommended, onRetry }) {
  const done = state?.tracks ? sumTracks(state.tracks) : null;
  return <article className={`gm-card${recommended ? ' is-next' : ''}`} aria-labelledby={`gm-${game.id}`}>
    {recommended && <p className="gm-badge">Recommended next</p>}
    <h2 id={`gm-${game.id}`}>{game.title}</h2>
    <p className="gm-pitch">{game.pitch}</p>
    {!state && <p role="status" className="gm-muted">Loading progress…</p>}
    {state?.error && <p role="alert" className="gm-error">Progress unavailable. <button type="button" className="secondary small" onClick={onRetry}>Retry</button></p>}
    {done && <>
      <ul className="gm-tracks" aria-label="Difficulty tracks">
        {state.tracks.map((track) => <li key={track.id} className={track.total > 0 && track.solved >= track.total ? 'is-done' : undefined}>
          <span>{track.title}</span><strong>{track.solved}/{track.total}</strong>
        </li>)}
      </ul>
      <Bar label={`${game.title} progress`} value={done.percent} />
      <p className="gm-stats"><span>{done.solved}/{done.total} solved</span><span>{done.pointsEarned}/{done.maxPoints} pts</span></p>
    </>}
    <Link className="button" to={game.path}>Open<span className="gm-sr"> {game.title}</span></Link>
  </article>;
}

export default function Games() {
  const [states, setStates] = useState({});

  // Each game loads on its own, so one slow or failing endpoint never holds back the rest.
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

  return <section className="gm-page">
    <h1>Games</h1>
    <p className="gm-lead">Every arena game in one place. Pick a game, work through its tracks and bring the points home to your team.</p>

    <section className="gm-summary" aria-labelledby="gm-summary-heading">
      <h2 id="gm-summary-heading">Arena progress</h2>
      {total.games === 0 && !loaded && <p role="status" className="gm-muted">Counting your progress…</p>}
      {total.games > 0 && <>
        <p className="gm-big"><strong>{total.solved}</strong>/{total.total} levels <span aria-hidden="true">·</span> <strong>{total.pointsEarned}</strong>/{total.maxPoints} points</p>
        <Bar label="Arena progress" value={percentOf(total.solved, total.total)} />
        {total.failed > 0 && <p className="gm-muted">{total.failed} {total.failed === 1 ? 'game' : 'games'} could not be counted.</p>}
      </>}
      {nextGame && <p className="gm-next">Recommended next: <Link to={nextGame.path}>{nextGame.title}</Link>, {next.track.title} ({next.track.total - next.track.solved} left)</p>}
      {loaded && total.games > 0 && !next && total.failed === 0 && <p className="gm-next">Everything cleared. Nicely done.</p>}
    </section>

    <div className="gm-grid">
      {GAMES.map((game) => <GameCard key={game.id} game={game} state={states[game.id]} recommended={next?.id === game.id} onRetry={() => retry(game)} />)}
    </div>
  </section>;
}
