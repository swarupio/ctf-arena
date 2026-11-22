import { useEffect, useRef } from 'react';

// The disassembly. Each row is a button: click (or Enter/Space) toggles a breakpoint at that address.
export default function Listing({
  rows, pc, stopped, breakpoints, onToggle, marks = new Set(), focus = null, before = null, after = null,
}) {
  const box = useRef(null);

  // Keep the current instruction in view inside the listing without scrolling the whole page.
  useEffect(() => {
    const container = box.current;
    const current = container?.querySelector('[data-current="true"]');
    if (!container || !current) { return; }
    const top = current.offsetTop - container.offsetTop;
    if (top < container.scrollTop || top + current.offsetHeight > container.scrollTop + container.clientHeight) {
      container.scrollTop = Math.max(0, top - container.clientHeight / 2);
    }
  }, [pc]);

  // A "go to" (xref, graph block, search match): centre that row and move keyboard focus to it, inside the listing only.
  useEffect(() => {
    const container = box.current;
    const target = focus ? container?.querySelector(`li[data-address="${focus.address}"]`) : null;
    if (!container || !target) { return; }
    const offset = target.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
    container.scrollTop = Math.max(0, offset - container.clientHeight / 2);
    target.querySelector('.cm-row')?.focus({ preventScroll: true });
  }, [focus]);

  return <div className="cm-listing" ref={box} role="group" aria-label="Disassembly listing. Activate a row to toggle a breakpoint.">
    <ol>
      {rows.map((row) => {
        const isCurrent = row.address === pc && !stopped;
        const hasBreakpoint = breakpoints.has(row.address);
        const decisive = marks.has(row.address);
        return <li key={row.address} data-address={row.address} data-current={isCurrent} className={`${focus?.address === row.address ? 'is-goto ' : ''}${isCurrent ? 'is-current' : ''}${row.patched ? ' is-patched' : ''}${decisive ? ' is-decisive' : ''}`}>
          {before?.(row)}
          <button
            type="button"
            className="cm-row"
            aria-pressed={hasBreakpoint}
            aria-label={`Address ${row.addr}: ${row.mnemonic}${row.operand ? ` ${row.operand}` : ''}${row.comment ? `, ${row.comment}` : ''}${isCurrent ? ', current instruction' : ''}${hasBreakpoint ? ', breakpoint set' : ''}${decisive ? ', decided the result' : ''}`}
            onClick={() => onToggle(row.address)}
          >
            <span className="cm-bp" aria-hidden="true">{hasBreakpoint ? '●' : ''}</span>
            <span className="cm-arrow" aria-hidden="true">{isCurrent ? '▶' : ''}</span>
            <span className="cm-addr" aria-hidden="true">{row.addr}</span>
            <span className="cm-op" aria-hidden="true">{row.mnemonic}</span>
            <span className="cm-arg" aria-hidden="true">{row.operand}</span>
            <span className="cm-comment" aria-hidden="true">{row.comment ? `; ${row.comment}` : ''}{row.patched ? ' ; patched' : ''}{decisive ? ' ; decided' : ''}</span>
          </button>
          {after?.(row)}
        </li>;
      })}
    </ol>
  </div>;
}
