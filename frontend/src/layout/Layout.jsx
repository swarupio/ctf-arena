import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { authMessage } from '../auth/logic.js';
import { TeamProvider, useTeam } from './TeamContext.jsx';

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
    <header>
      <Link className="brand" to="/">CTF Arena</Link>
      <nav aria-label="Main navigation">
        <NavLink to="/challenges">Challenges</NavLink>
        <NavLink to="/leaderboard">Leaderboard</NavLink>
        <NavLink to="/team">{profile?.team?.name ? `Team · ${profile.team.name}` : 'Team'}</NavLink>
        {user?.role === 'admin' && <><NavLink to="/admin" end>Admin</NavLink><NavLink to="/admin/challenges">Manage challenges</NavLink></>}
      </nav>
      <div className="account">
        {loading ? <span>Loading…</span> : user ? <><span className="email">{user.email}</span><button className="secondary" onClick={logout} disabled={busy}>{busy ? 'Logging out…' : 'Logout'}</button></> : <><Link to="/login">Login</Link><Link to="/signup">Sign up</Link></>}
      </div>
    </header>
    <main id="main">
      {configurationError && <p role="alert" className="error">{configurationError}</p>}
      {error && <p role="alert" className="error">{error}</p>}
      <Outlet />
    </main>
    <footer>Mini CTF Arena <span>{replica ? `Served by ${replica}` : 'No API response yet'}</span></footer>
  </div>;
}
