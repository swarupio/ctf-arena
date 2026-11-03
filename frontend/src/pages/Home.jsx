import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { useTeam } from '../layout/TeamContext.jsx';

export default function Home() {
  const { user, loading, profileError: error, retryProfile } = useAuth();
  const { profile } = useTeam();
  return <section className="home-panel">
    <h1>CTF Arena</h1>
    <p>Practice your skills. Solve challenges. Play as a team.</p>
    {loading ? <p role="status">Restoring your session…</p> : user ? <>
      <h2>Your arena account</h2>
      {profile ? <><p role="status">Account verified by the arena API.</p><dl><dt>Display name</dt><dd>{profile.displayName}</dd><dt>Role</dt><dd>{profile.role}</dd></dl></> : error ? <><p role="alert" className="error">{error}</p><button onClick={retryProfile}>Retry account check</button></> : <p role="status">Checking your account with the arena API…</p>}
      <Link to="/challenges">Go to Challenges</Link>
      {profile && <p>Team: <Link to="/team">{profile.team?.name ?? 'No team yet'}</Link></p>}
    </> : <p><Link to="/login">Log in</Link> or <Link to="/signup">create an account</Link> to enter the arena.</p>}
  </section>;
}
