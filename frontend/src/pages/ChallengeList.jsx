import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { listChallenges } from '../api/challenges.js';
import { CATEGORY_LEGEND, challengeErrorMessage, groupByCategory, solveCountLabel, splitTerminalChallenges } from './challengeHelpers.js';
import '../overview.css';
import './Challenge.css';
import '../terminal/terminal.css';

// One card for the whole Arena Terminal category; its individual codes are played inside the terminal, not listed here.
function TerminalPromo({ summary }) {
  const progress = summary.count > 0 ? `${summary.solved}/${summary.count} flags captured` : 'easy, medium and hard modes';
  return <Link to="/terminal" className="challenge-card tm-promo">
    <span className="tm-promo-prompt" aria-hidden="true">guest@arena:~$ _</span>
    <span className="challenge-title">Arena Terminal</span>
    <span className="tm-promo-text">Explore a pretend Unix machine with real commands and hunt for hidden flags.</span>
    <span className="challenge-foot">
      <span className="tm-promo-meta">{progress}{summary.points > 0 ? ` · ${summary.points} pts` : ''}</span>
      <span className="challenge-go">Open terminal <span aria-hidden="true">{'▸'}</span></span>
    </span>
  </Link>;
}

export default function ChallengeList() {
  const [challenges, setChallenges] = useState(null);
  const [error, setError] = useState('');

  const controller = useRef(null);

  async function load() {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setError('');
    try {
      const data = await listChallenges({ signal: current.signal, onRevalidate: setChallenges });
      if (!current.signal.aborted) setChallenges(data);
    } catch (failure) {
      if (!current.signal.aborted) setError(challengeErrorMessage(failure));
    }
  }
  useEffect(() => { load(); return () => controller.current?.abort(); }, []);

  if (error) return <section className="challenges"><p role="alert" className="error">{error}</p><button onClick={load}>Retry</button></section>;
  if (!challenges) return <p role="status">Loading challenges…</p>;
  const { regular, terminal } = splitTerminalChallenges(challenges);

  return <section className="challenges ov-page">
    <header className="ov-header"><h1>Challenges</h1></header>
    <p className="category-legend">{CATEGORY_LEGEND}</p>
    {regular.length === 0 && terminal.count === 0 && <p>No challenges are available yet. Try the Range instead.</p>}
    <div className="challenge-groups">
    {groupByCategory(regular).map(({ category, items }) => <div key={category} className="challenge-group">
      <h2>{category}<span className="ov-count" aria-hidden="true">{items.length}</span></h2>
      <div className="challenge-grid" data-count={items.length}>
        {items.map((challenge) => <Link key={challenge.id} to={`/challenges/${challenge.id}`} className={`challenge-card${challenge.solvedByMyTeam ? ' solved' : ''}`}>
          <span className="challenge-title">{challenge.title}</span>
          <span className="tags">
            <span className="tag tag-points">{challenge.points} pts</span>
            <span className={`tag tag-${challenge.difficulty}`}>{challenge.difficulty}</span>
            {challenge.type === 'docker' && <span className="tag">own server</span>}
          </span>
          <span className="challenge-foot">
            <span className="challenge-meta" title={challenge.solveCount == null ? 'Solve counts are hidden while the scoreboard is frozen.' : undefined}>{solveCountLabel(challenge.solveCount)}</span>
            {challenge.solvedByMyTeam && <span className="badge">Captured</span>}
            <span className="challenge-go" aria-hidden="true">Open {'▸'}</span>
          </span>
        </Link>)}
      </div>
    </div>)}
    <div className="challenge-group">
      <h2>range<span className="ov-count" aria-hidden="true">{terminal.count > 0 ? 2 : 1}</span></h2>
      <div className="challenge-grid" data-count={terminal.count > 0 ? 2 : 1}>
        {terminal.count > 0 && <TerminalPromo summary={terminal} />}
        <Link to="/range" className="challenge-card">
          <span className="challenge-title">The Range</span>
          <span className="challenge-meta">Terminal, Cipher Lab, Web Lab, Forensics, Crackme and OSINT live on the Range.</span>
          <span className="challenge-foot"><span className="challenge-go">Open the Range <span aria-hidden="true">{'▸'}</span></span></span>
        </Link>
      </div>
    </div>
    </div>
  </section>;
}
