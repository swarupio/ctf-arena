import { useEffect, useId, useRef, useState } from 'react';
import './Info.css';

/**
 * Tap-to-open explanation, the touch and keyboard replacement for a hover-only title tooltip.
 * A small "i" button toggles a note next to it (aria-expanded, aria-controls). Escape or a tap elsewhere closes it.
 * It never traps focus and never moves it. Keep a title= on the host element only as a bonus for mouse users.
 */
export default function Info({ label, children, className = '' }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef(null);
  useEffect(() => {
    if (!open) { return undefined; }
    const onKey = (event) => { if (event.key === 'Escape') { setOpen(false); } };
    const onDown = (event) => { if (root.current && !root.current.contains(event.target)) { setOpen(false); } };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onDown); };
  }, [open]);
  return <span className={`info ${className}`.trim()} ref={root}>
    <button type="button" className="info-btn" aria-expanded={open} aria-controls={id} aria-label={`More about ${label}`} onClick={() => setOpen((value) => !value)}>
      <span aria-hidden="true">i</span>
    </button>
    <span id={id} className="info-note" role="note" hidden={!open}>{children}</span>
  </span>;
}
