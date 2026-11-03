import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listChallenges } from '../api/challenges.js';
import { challengeErrorMessage, groupByCategory } from './challengeHelpers.js';
import './Challenge.css';

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
  if (challenges.length === 0) return <section className="challenges"><h1>Challenges</h1><p>No challenges are available yet.</p></section>;

  return <section className="challenges">
    <h1>Challenges</h1>
    {groupByCategory(challenges).map(({ category, items }) => <div key={category} className="challenge-group">
      <h2>{category}</h2>
      <div className="challenge-grid">
        {items.map((challenge) => <Link key={challenge.id} to={`/challenges/${challenge.id}`} className={`challenge-card${challenge.solvedByMyTeam ? ' solved' : ''}`}>
          <span className="challenge-title">{challenge.title}</span>
          <span className="challenge-meta">{challenge.points} pts · {challenge.difficulty}{challenge.type === 'docker' ? ' · instance' : ''}</span>
          <span className="challenge-meta">{challenge.solveCount} {challenge.solveCount === 1 ? 'solve' : 'solves'}</span>
          {challenge.solvedByMyTeam && <span className="badge">Solved</span>}
        </Link>)}
      </div>
    </div>)}
  </section>;
}
