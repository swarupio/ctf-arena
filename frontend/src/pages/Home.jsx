import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';

export default function Home() {
  const [check, setCheck] = useState(0);
  const [health, setHealth] = useState({ data: null, error: null, loading: true, checkedAt: null });
  useEffect(() => {
    document.title = 'Overview · Mini CTF Arena';
    const controller = new AbortController();
    setHealth((previous) => ({ ...previous, loading: true, error: null }));
    api('/health', { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) {
          setHealth({ data, error: null, loading: false, checkedAt: new Date() });
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setHealth({ data: null, error, loading: false, checkedAt: null });
        }
      });
    return () => controller.abort();
  }, [check]);
  const { data, loading, error, checkedAt } = health;
  const availability = loading ? 'Checking connection' : error ? 'Connection unavailable'
    : data?.status === 'ok' && data?.db === 'up' ? 'All systems connected' : 'Arena needs attention';

  return (
    <>
      <div className="page-heading">
        <div><p className="eyebrow">Player workspace</p><h1>Arena overview</h1><p>Your starting point for the next challenge.</p></div>
        <Link className="text-link" to="/challenges">Explore challenges <span aria-hidden="true">→</span></Link>
      </div>
      <section className="health-section" aria-labelledby="health-title" aria-busy={loading}>
        <div className="section-heading">
          <h2 id="health-title">Arena connection</h2>
          <button className="button-secondary" disabled={loading} onClick={() => setCheck((value) => value + 1)}>
            {loading ? 'Checking…' : error ? 'Retry connection' : 'Refresh status'}
          </button>
        </div>
        <div className="health-panel">
          <p className="availability" role="status"><span className={`status-dot ${error || data?.db === 'down' ? 'is-error' : loading ? 'is-pending' : 'is-connected'}`} aria-hidden="true" />{availability}</p>
          {error && <p className="error-message" role="alert">{error.message}</p>}
          <dl className="health-facts">
            <div><dt>API status</dt><dd>{loading ? 'Checking…' : data?.status || '—'}</dd></div>
            <div><dt>Database</dt><dd>{loading ? 'Checking…' : data?.db || '—'}</dd></div>
            <div><dt>Replica</dt><dd className="replica-value">{loading ? 'Checking…' : data?.replica || '—'}</dd></div>
          </dl>
          <div className="health-caption"><span>Public connection check</span><span>{checkedAt ? `Checked ${checkedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'No successful check yet'}</span></div>
        </div>
      </section>
      <section className="destinations" aria-labelledby="destinations-title">
        <div className="section-heading"><h2 id="destinations-title">Inside the arena</h2><span className="muted">More is on the way</span></div>
        {[
          ['/challenges', 'Challenges', 'Find the next puzzle. Work toward the flag.'],
          ['/leaderboard', 'Leaderboard', 'Follow the teams climbing the standings.'],
          ['/team', 'Team', 'A place for your crew, up to three players.'],
        ].map(([path, title, description]) => (
          <Link className="destination-row" key={path} to={path}><span><strong>{title}</strong><span>{description}</span></span><span className="destination-state">Coming next <span aria-hidden="true">↗</span></span></Link>
        ))}
      </section>
    </>
  );
}
