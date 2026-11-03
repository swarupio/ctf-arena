import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { useTeam } from '../layout/TeamContext.jsx';
import { PixelBlocks, PixelFlag } from '../layout/PixelArt.jsx';

const STEPS = [
  ['01', 'Pick a challenge', 'Browse web, crypto, forensics, pwn and misc puzzles, from easy to hard.'],
  ['02', 'Start an instance', 'Some challenges run in a private container that only your team can reach.'],
  ['03', 'Capture the flag', 'Submit the flag you find and earn points for your whole team.'],
];

export default function Home() {
  const { user, loading, profileError: error, retryProfile } = useAuth();
  const { profile } = useTeam();
  return <>
    <section className="hero">
      <PixelBlocks variant="a" className="hero-art hero-art-start" />
      <PixelBlocks variant="b" className="hero-art hero-art-end" />
      <div className="hero-content">
        <PixelFlag className="hero-flag" />
        <h1 className="hero-title">CTF Arena</h1>
        <p className="hero-tagline">Practice your skills. Solve challenges. Play as a team.</p>
        {loading ? <p role="status" className="hero-status">Restoring your session…</p> : <div className="hero-actions">
          {user ? <>
            <Link className="button" to="/challenges">Challenges</Link>
            <Link className="button secondary" to="/team">Team</Link>
          </> : <>
            <Link className="button" to="/login">Login</Link>
            <Link className="button secondary" to="/signup">Sign up</Link>
          </>}
        </div>}
      </div>
    </section>

    {!loading && user && <section className="home-account" aria-labelledby="account-heading">
      <h2 id="account-heading">Your arena account</h2>
      {profile ? <>
        <p role="status" className="status-line">Account verified by the arena API.</p>
        <dl>
          <dt>Display name</dt><dd>{profile.displayName}</dd>
          <dt>Role</dt><dd>{profile.role}</dd>
          <dt>Team</dt><dd><Link to="/team">{profile.team?.name ?? 'No team yet'}</Link></dd>
        </dl>
      </> : error ? <>
        <p role="alert" className="error">{error}</p>
        <button onClick={retryProfile}>Retry account check</button>
      </> : <p role="status">Checking your account with the arena API…</p>}
    </section>}

    <section className="steps" aria-labelledby="steps-heading">
      <h2 id="steps-heading">How it works</h2>
      <ol className="step-list">
        {STEPS.map(([number, title, text]) => <li key={number} className="step-card">
          <span className="step-number" aria-hidden="true">{number}</span>
          <h3>{title}</h3>
          <p>{text}</p>
        </li>)}
      </ol>
    </section>
  </>;
}
