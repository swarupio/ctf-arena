import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listChallenges } from '../api/challenges.js';
import { challengeErrorMessage, groupByCategory, splitTerminalChallenges } from './challengeHelpers.js';
import './Challenge.css';
import '../terminal/terminal.css';

// One card for the whole Arena Terminal game; its individual codes are played inside the terminal, not listed here.
function TerminalPromo({ summary }) {
  const progress = summary.count > 0 ? `${summary.solved}/${summary.count} codes found` : 'easy, medium and hard modes';
  return <Link to="/terminal" className="challenge-card tm-promo">
    <span className="tm-promo-prompt" aria-hidden="true">guest@arena:~$ _</span>
    <span className="challenge-title">Arena Terminal</span>
    <span className="tm-promo-text">Explore a pretend Unix machine with real commands and hunt for hidden codes.</span>
    <span className="challenge-foot">
      <span className="tm-promo-meta">{progress}{summary.points > 0 ? ` · ${summary.points} pts` : ''}</span>
      <span className="tm-promo-go">open terminal <span aria-hidden="true">{'▸'}</span></span>
    </span>
  </Link>;
}

export default function ChallengeList() {
  const [challenges, setChallenges] = useState(null);
  const [error, setError] = useState('');

  async function load() {
    setError('');
    try { setChallenges(await listChallenges()); }
    catch (failure) { setError(challengeErrorMessage(failure)); }
  }
  useEffect(() => { load(); }, []);

  if (error) return <section className="challenges"><p role="alert" className="error">{error}</p><button onClick={load}>Retry</button></section>;
  if (!challenges) return <p role="status">Loading challenges…</p>;
  const { regular, terminal } = splitTerminalChallenges(challenges);

  return <section className="challenges">
    <h1>Challenges</h1>
    {regular.length === 0 && <p>No challenges are available yet.</p>}
    {groupByCategory(regular).map(({ category, items }) => <div key={category} className="challenge-group">
      <h2>{category}</h2>
      <div className="challenge-grid">
        {items.map((challenge) => <Link key={challenge.id} to={`/challenges/${challenge.id}`} className={`challenge-card${challenge.solvedByMyTeam ? ' solved' : ''}`}>
          <span className="challenge-title">{challenge.title}</span>
          <span className="tags">
            <span className="tag tag-points">{challenge.points} pts</span>
            <span className={`tag tag-${challenge.difficulty}`}>{challenge.difficulty}</span>
            {challenge.type === 'docker' && <span className="tag">instance</span>}
          </span>
          <span className="challenge-foot">
            <span className="challenge-meta">{challenge.solveCount} {challenge.solveCount === 1 ? 'solve' : 'solves'}</span>
            {challenge.solvedByMyTeam && <span className="badge">Solved</span>}
          </span>
        </Link>)}
      </div>
    </div>)}
    <div className="challenge-group">
      <h2>terminal</h2>
      <div className="challenge-grid"><TerminalPromo summary={terminal} /></div>
    </div>
  </section>;
}
