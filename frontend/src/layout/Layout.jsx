import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { authMessage } from '../auth/logic.js';
import { TeamProvider, useTeam } from './TeamContext.jsx';
import { PixelFlag } from './PixelArt.jsx';

export default function Layout() {
  const { user } = useAuth();
  return <TeamProvider key={user?.email ?? 'signed-out'}><LayoutContent /></TeamProvider>;
}

function LayoutContent() {
  const { user, loading, signOut, configurationError } = useAuth();
  const { profile } = useTeam();
  const [replica, setReplica] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  useEffect(() => {
    const update = (event) => setReplica(event.detail);
    window.addEventListener('api:served-by', update);
    return () => window.removeEventListener('api:served-by', update);
  }, []);
  async function logout() {
    setBusy(true);
    setError('');
    try { await signOut(); navigate('/', { replace: true }); }
    catch (error) { setError(authMessage(error)); }
    finally { setBusy(false); }
  }
  return <div className="app">
    <a className="skip-link" href="#main">Skip to content</a>
    <header className="site-header">
      <Link className="brand" to="/"><PixelFlag className="brand-flag" /><span>CTF Arena</span></Link>
      <nav aria-label="Main navigation">
        <NavLink to="/demo">Demo</NavLink>
        <NavLink to="/challenges">Challenges</NavLink>
        {user && <NavLink to="/terminal">Terminal</NavLink>}
        <NavLink to="/leaderboard">Leaderboard</NavLink>
        <NavLink to="/team">{profile?.team?.name ? `Team · ${profile.team.name}` : 'Team'}</NavLink>
        {user?.role === 'admin' && <><NavLink to="/admin" end>Admin</NavLink><NavLink to="/admin/challenges">Manage challenges</NavLink></>}
      </nav>
      <div className="account">
        {loading ? <span>Loading…</span> : user ? <><span className="email" title={user.email}>{user.email}</span><button className="secondary small" onClick={logout} disabled={busy}>{busy ? 'Logging out…' : 'Logout'}</button></> : <><span className="session-status">[ Not logged in ]</span><Link className="button secondary small" to="/login">Login</Link><Link className="button small" to="/signup">Sign up</Link></>}
      </div>
    </header>
    <main id="main" tabIndex={-1}>
      {configurationError && <p role="alert" className="error">{configurationError}</p>}
      {error && <p role="alert" className="error">{error}</p>}
      <Outlet />
    </main>
    <footer className="site-footer"><span>Mini CTF Arena</span><nav className="footer-links" aria-label="Footer"><Link to="/fair-play">Fair play</Link></nav><span className="replica">{replica ? `Served by ${replica}` : 'No API response yet'}</span></footer>
  </div>;
}
