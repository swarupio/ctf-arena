import { useEffect, useRef, useState } from 'react';
import { windowRange } from '../../forensics/logFilter.js';

// Fixed-height rows, only the visible slice is in the DOM. The scroller is focusable: arrow keys, PageUp/PageDown,
// Home and End scroll it natively, so the list is keyboard friendly without any key handling here.
export default function VirtualList({ count, rowHeight = 24, label, renderRow, selected, onActivate, className = '' }) {
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
  const { first, last } = windowRange({ scrollTop, viewport, rowHeight, total: count });
  const rows = [];
  for (let i = first; i < last; i += 1) {
    rows.push(<div
      key={i} className={`fx-row${selected === i ? ' is-selected' : ''}`} style={{ top: i * rowHeight, height: rowHeight }}
      role="row" aria-rowindex={i + 1} aria-selected={selected === i ? true : undefined}
      onClick={onActivate ? () => onActivate(i) : undefined}
    >{renderRow(i)}</div>);
  }
  return <div
    ref={ref} className={`fx-scroller ${className}`} tabIndex={0} role="table" aria-label={label} aria-rowcount={count}
    // Row-aligned, so a scroll step inside one row does not re-render the visible rows (React skips an equal state).
    onScroll={(event) => setScrollTop(Math.floor(event.currentTarget.scrollTop / rowHeight) * rowHeight)}
  >
    <div className="fx-spacer" style={{ height: count * rowHeight }}>{rows}</div>
    {count === 0 && <p className="fx-empty">Nothing matches.</p>}
  </div>;
}
