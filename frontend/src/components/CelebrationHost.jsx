import { useEffect, useState } from 'react';
import { CELEBRATE_EVENT, confettiPieces, prefersReducedMotion } from '../pages/socialHelpers.js';
import './Social.css';

const PIECES = confettiPieces(40);
const SHOW_MS = 5000;

// Mounted once in the layout. Listens for the `arena:celebrate` window event (first blood, first flag, new badge)
// and shows a short banner. The confetti is CSS only and is skipped entirely under prefers-reduced-motion.
export default function CelebrationHost() {
  const [celebration, setCelebration] = useState(null);

  useEffect(() => {
    const onCelebrate = (event) => setCelebration({ ...event.detail, motion: !prefersReducedMotion() });
    window.addEventListener(CELEBRATE_EVENT, onCelebrate);
    return () => window.removeEventListener(CELEBRATE_EVENT, onCelebrate);
  }, []);

  useEffect(() => {
    if (!celebration) return undefined;
    const timer = setTimeout(() => setCelebration(null), SHOW_MS);
    return () => clearTimeout(timer);
  }, [celebration]);

  if (!celebration) return <div className="fx-live-region" role="status" aria-live="polite" />;
  return <>
    {celebration.motion && celebration.confetti && <div className="fx-confetti" aria-hidden="true">
      {PIECES.map((piece, index) => <i key={index} style={{
        '--x': `${piece.x}%`, '--dx': `${piece.dx}px`, '--delay': `${piece.delay}ms`,
        '--dur': `${piece.duration}ms`, '--rot': `${piece.rotate}deg`, '--c': piece.color,
      }} />)}
    </div>}
    <div className="fx-toast" role="status" aria-live="polite">
      <strong>{celebration.title}</strong>
      {celebration.badges?.length > 0 && <span>{celebration.badges.join(', ')}</span>}
      <button type="button" className="secondary small" onClick={() => setCelebration(null)}>Dismiss</button>
    </div>
  </>;
}
