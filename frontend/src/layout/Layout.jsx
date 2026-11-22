import { useEffect, useId, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { authMessage } from '../auth/logic.js';
import { TeamProvider, useTeam } from './TeamContext.jsx';
import { PixelFlag } from './PixelArt.jsx';
import CelebrationHost from '../components/CelebrationHost.jsx';
import AnnouncementBanner from '../components/AnnouncementBanner.jsx';
import EventBanner from '../components/EventBanner.jsx';
import { REPLICA_HINT, replicaLabel } from './replica.js';
import ThemeToggle, { ThemeSelect } from '../theme/ThemeToggle.jsx';

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
  const [menuOpen, setMenuOpen] = useState(false);
  const menuId = useId();
  const navigate = useNavigate();
  const location = useLocation();
  // The mobile menu closes on every route change and on Escape.
  useEffect(() => { setMenuOpen(false); }, [location.pathname]);
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onKey = (event) => { if (event.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen]);
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
    <AnnouncementBanner />
    <EventBanner />
    <header className="site-header">
      <Link className="brand" to="/"><PixelFlag className="brand-flag" /><span>CTF Arena</span></Link>
      <button type="button" className="secondary small menu-toggle" aria-expanded={menuOpen} aria-controls={menuId} onClick={() => setMenuOpen((open) => !open)}>
        <span aria-hidden="true">{menuOpen ? '✕' : '☰'}</span> Menu
      </button>
      <div id={menuId} className={`site-menu${menuOpen ? ' is-open' : ''}`}>
      <nav aria-label="Main navigation">
        <NavLink to="/demo">Demo</NavLink>
        <NavLink to="/challenges">Challenges</NavLink>
        {user && <NavLink to="/range">Range</NavLink>}
        <NavLink to="/skills">Skills</NavLink>
        <NavLink to="/leaderboard">Leaderboard</NavLink>
        {user?.role !== 'admin' && <NavLink to="/team">{profile?.team?.name ? `Team · ${profile.team.name}` : 'Team'}</NavLink>}
        {user && <NavLink to="/profile">Profile</NavLink>}
        {user?.role === 'admin' && <NavLink to="/admin">Admin</NavLink>}
      </nav>
      <div className="account">
        {loading ? <span>Loading…</span> : user ? <><span className="email" title={user.email}>{user.email}</span><button className="secondary small" onClick={logout} disabled={busy}>{busy ? 'Logging out…' : 'Logout'}</button></> : <><span className="session-status">Not logged in</span><Link className="button secondary small" to="/login">Login</Link><Link className="button small" to="/signup">Sign up</Link></>}
        <ThemeToggle />
      </div>
      <ThemeSelect className="theme-select-menu" />
      </div>
    </header>
    <main id="main" tabIndex={-1}>
      {configurationError && <p role="alert" className="error">{configurationError}</p>}
      {error && <p role="alert" className="error">{error}</p>}
      <Outlet />
    </main>
    <CelebrationHost />
    <footer className="site-footer"><span>CTF Arena · Train on the Range. Compete in the Arena.</span><nav className="footer-links" aria-label="Footer"><Link to="/fair-play">Fair play</Link></nav><ThemeSelect className="theme-select-footer" /><span className="replica" title={REPLICA_HINT}>{replicaLabel(replica)}</span></footer>
  </div>;
}
