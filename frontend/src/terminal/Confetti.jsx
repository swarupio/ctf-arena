import { useEffect, useRef } from 'react';

// Pure CSS confetti: a fixed overlay of falling pieces. The piece layout is derived from the index, so the effect is
// deterministic and needs no randomness or canvas. The parent skips it entirely under prefers-reduced-motion.
const COLORS = ['#b5f23d', '#0a0a0a', '#ffd23f', '#ff6b6b', '#6ea8ff', '#ffffff'];
const PIECES = 52;

const pieces = Array.from({ length: PIECES }, (_, i) => {
  const seed = (i * 7919 + 17) % 101;
  return {
    x: `${(i * 37 + seed) % 100}%`,
    dx: `${((seed % 21) - 10) * 9}px`,
    delay: `${((i * 53) % 90) * 12}ms`,
    duration: `${2300 + ((i * 97) % 1100)}ms`,
    rotate: `${(seed % 2 ? 1 : -1) * (360 + seed * 5)}deg`,
    color: COLORS[i % COLORS.length],
    wide: i % 3 === 0,
  };
});

export default function Confetti({ duration = 4200, onDone }) {
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  useEffect(() => {
    const timer = setTimeout(() => { if (doneRef.current) doneRef.current(); }, duration);
    return () => clearTimeout(timer);
  }, [duration]);
  return <div className="tm-confetti" aria-hidden="true">
    {pieces.map((piece, index) => <i
      key={index}
      className={piece.wide ? 'is-wide' : undefined}
      style={{ '--x': piece.x, '--dx': piece.dx, '--delay': piece.delay, '--dur': piece.duration, '--rot': piece.rotate, '--c': piece.color }}
    />)}
  </div>;
}
