import { useEffect, useRef, useState } from 'react';
import { windowRange } from '../../forensics/logFilter.js';

// Fixed-height rows, only the visible slice is in the DOM. The scroller is focusable: arrow keys, PageUp/PageDown,
// Home and End scroll it natively. When rows are activatable (onActivate) each is a focusable button (Enter or Space).
// Rows you can tap are 44px tall on touch screens (fine pointers keep the compact height).
const touchScreen = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;

export default function VirtualList({ count, rowHeight: baseRowHeight = 24, label, renderRow, selected, onActivate, className = '', revealSelected = false }) {
  const rowHeight = onActivate && touchScreen() ? Math.max(baseRowHeight, 44) : baseRowHeight;
  const ref = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(360);
  useEffect(() => {
    const node = ref.current;
    if (!node) { return undefined; }
    const measure = () => setViewport(node.clientHeight || 360);
    measure();
    if (typeof ResizeObserver === 'undefined') { return undefined; }
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { if (ref.current) { ref.current.scrollTop = 0; } }, [count]);
  // Opt-in: bring a selection that was changed from outside (Next, jump to packet) into view.
  useEffect(() => {
    const node = ref.current;
    if (!revealSelected || !node || selected === null || selected < 0) { return; }
    const top = selected * rowHeight;
    if (top < node.scrollTop || top + rowHeight > node.scrollTop + node.clientHeight) { node.scrollTop = Math.max(0, top - rowHeight * 2); }
  }, [revealSelected, selected, rowHeight]);
  const { first, last } = windowRange({ scrollTop, viewport, rowHeight, total: count });
  const rows = [];
  for (let i = first; i < last; i += 1) {
    // Plain rows have no ARIA role (table/row without cells is invalid). Activatable rows are real keyboard targets.
    const activate = onActivate ? {
      role: 'button', tabIndex: 0, 'aria-pressed': selected === i,
      onClick: () => onActivate(i),
      onKeyDown: (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onActivate(i); } },
    } : {};
    rows.push(<div
      key={i} className={`fx-row${selected === i ? ' is-selected' : ''}`} style={{ top: i * rowHeight, height: rowHeight }}
      {...activate}
    >{renderRow(i)}</div>);
  }
  return <div
    ref={ref} className={`fx-scroller ${className}`} tabIndex={0} role="region" aria-label={`${label}, ${count} rows`}
    // Row-aligned, so a scroll step inside one row does not re-render the visible rows (React skips an equal state).
    onScroll={(event) => setScrollTop(Math.floor(event.currentTarget.scrollTop / rowHeight) * rowHeight)}
  >
    <div className="fx-spacer" style={{ height: count * rowHeight }}>{rows}</div>
    {count === 0 && <p className="fx-empty">Nothing matches.</p>}
  </div>;
}
