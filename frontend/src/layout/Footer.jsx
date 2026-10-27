import { useSyncExternalStore } from 'react';
import { getServedBy, subscribe } from '../api/servedBy.js';

export default function Footer() {
  const replica = useSyncExternalStore(subscribe, getServedBy, () => null);
  return (
    <footer className="site-footer">
      <div className="container footer-content">
        <span>Mini CTF Arena <span className="footer-divider">/</span> Capture the flag. Together.</span>
        <span className="replica-label" aria-live="polite">Served by <code>{replica || '—'}</code></span>
      </div>
    </footer>
  );
}
