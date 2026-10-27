import { useEffect } from 'react';
import { Link } from 'react-router-dom';

export default function NotFound() {
  useEffect(() => { document.title = 'Page not found · Mini CTF Arena'; }, []);
  return (
    <section className="empty-state not-found">
      <p className="eyebrow">404</p><h1>Outside the arena.</h1>
      <p>The page you’re looking for doesn’t exist.</p>
      <Link className="text-link" to="/">Back to overview <span aria-hidden="true">→</span></Link>
    </section>
  );
}
