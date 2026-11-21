import { Suspense, useEffect, useId, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { ToastProvider } from '../../components/admin/Toasts.jsx';
import '../../components/admin/admin.css';

export const ADMIN_SECTIONS = [
  { to: '/admin', label: 'Overview', end: true },
  { to: '/admin/users', label: 'Users' },
  { to: '/admin/teams', label: 'Teams' },
  { to: '/admin/challenges', label: 'Challenges' },
  { to: '/admin/activity', label: 'Submissions & solves' },
  { to: '/admin/integrity', label: 'Fair play' },
  { to: '/admin/instances', label: 'Instances' },
  { to: '/admin/audit', label: 'Audit log' },
  { to: '/admin/settings', label: 'Settings' },
  { to: '/admin/exports', label: 'Exports' },
];

// Shell of the admin area: a left sidebar (a toggle menu on phones) and the active section in the main column.
// Every section is its own lazy chunk; the Suspense here keeps the sidebar on screen while one loads.
export default function AdminLayout() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const navId = useId();

  useEffect(() => { setOpen(false); }, [location.pathname]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return <ToastProvider>
    <div className="adm-shell">
      <div className="adm-sidebar">
        <button type="button" className="adm-menu-toggle secondary" aria-expanded={open} aria-controls={navId} onClick={() => setOpen((value) => !value)}>
          <span aria-hidden="true">{open ? '✕' : '☰'}</span> Admin menu
        </button>
        <nav id={navId} className={`adm-nav${open ? ' adm-nav-open' : ''}`} aria-label="Admin sections">
          <ul>
            {ADMIN_SECTIONS.map((section) => <li key={section.to}>
              <NavLink to={section.to} end={section.end} className="adm-nav-link">{section.label}</NavLink>
            </li>)}
          </ul>
        </nav>
      </div>
      <div className="adm-main">
        <Suspense fallback={<p role="status" className="adm-muted">Loading section&hellip;</p>}>
          <Outlet />
        </Suspense>
      </div>
    </div>
  </ToastProvider>;
}
