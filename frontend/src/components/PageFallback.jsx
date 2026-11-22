import { useEffect, useState } from 'react';
import './pageFallback.css';

// Suspense fallback for lazy routes. The live region exists at once (so assistive tech is ready) but stays empty
// for `delay` ms: a chunk that arrives quickly never flashes "Loading…", a slow one shows it.
export default function PageFallback({ delay = 250 }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), delay);
    return () => clearTimeout(timer);
  }, [delay]);
  return <div className="page-fallback" role="status" aria-live="polite">{visible ? <p>Loading…</p> : null}</div>;
}
