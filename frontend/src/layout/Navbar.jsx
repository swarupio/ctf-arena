import { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';

export default function Navbar({ user = null }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <header className="site-header">
      <div className="container navbar">
        <Link className="wordmark" to="/" onClick={close} aria-label="Mini CTF Arena home">
          <svg viewBox="0 0 28 28" width="28" height="28" aria-hidden="true">
            <path d="M6 25V3h17l-4 6 4 6H6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
          </svg>
          <span>Mini CTF <strong>Arena</strong></span>
        </Link>
        <button className="menu-toggle" aria-expanded={open} aria-controls="primary-nav" onClick={() => setOpen(!open)}>
          {open ? 'Close' : 'Menu'}
        </button>
        <nav id="primary-nav" aria-label="Main navigation" className={open ? 'nav-links is-open' : 'nav-links'} onKeyDown={(event) => { if (event.key === 'Escape') { close(); } }}>
          <NavLink to="/challenges" onClick={close}>Challenges</NavLink>
          <NavLink to="/leaderboard" onClick={close}>Leaderboard</NavLink>
          <NavLink to="/team" onClick={close}>Team</NavLink>
          {user?.role === 'admin' && <NavLink to="/admin" onClick={close}>Admin</NavLink>}
          <NavLink to="/login" className="login-link" onClick={close}>Login <span aria-hidden="true">↗</span></NavLink>
        </nav>
      </div>
    </header>
  );
}
