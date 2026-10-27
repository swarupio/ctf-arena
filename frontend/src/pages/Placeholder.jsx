import { useEffect } from 'react';
import { Link } from 'react-router-dom';

export default function Placeholder({ title, description }) {
  useEffect(() => { document.title = `${title} · Mini CTF Arena`; }, [title]);
  return (
    <>
      <div className="page-heading"><div><p className="eyebrow">Player workspace</p><h1>{title}</h1></div></div>
      <section className="empty-state" aria-label={`${title} availability`}>
        <p className="empty-label">Coming next</p>
        <h2>This part of the arena is on its way.</h2>
        <p>{description}</p>
        <Link className="text-link" to="/">Back to overview <span aria-hidden="true">→</span></Link>
      </section>
    </>
  );
}
