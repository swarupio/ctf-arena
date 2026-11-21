import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getDaily } from '../api/social.js';
import './Social.css';

// Challenge of the day. The server picks it deterministically per UTC day; the bonus label is purely cosmetic and
// the points shown are the normal points of the challenge.
export default function DailySpotlight() {
  const [daily, setDaily] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    getDaily().then((data) => { if (active) setDaily(data); }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, []);

  if (failed || (daily && !daily.challenge)) return null;
  if (!daily) return <section className="fx-daily" aria-label="Daily spotlight"><p role="status" className="fx-note">Loading today&apos;s spotlight…</p></section>;
  const { challenge } = daily;
  return <section className="fx-daily" aria-labelledby="fx-daily-title">
    <h2 id="fx-daily-title">Daily spotlight <span className="fx-bonus">{daily.bonusLabel}</span></h2>
    <p className="fx-daily-name"><Link to={`/challenges/${challenge.id}`}>{challenge.title}</Link></p>
    <p className="fx-daily-meta">
      <span className="tag">{challenge.category}</span> <span className={`tag tag-${challenge.difficulty}`}>{challenge.difficulty}</span> <span className="tag tag-points">{challenge.points} pts</span>
    </p>
    <p className="fx-note">A new pick appears every day at 00:00 UTC. The bonus tag is just for fun: points never change.</p>
  </section>;
}
