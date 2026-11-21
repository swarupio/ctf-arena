import { useEffect, useRef } from 'react';

// The disassembly. Each row is a button: click (or Enter/Space) toggles a breakpoint at that address.
export default function Listing({ rows, pc, stopped, breakpoints, onToggle }) {
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

  return <div className="cm-listing" ref={box} role="group" aria-label="Disassembly listing. Activate a row to toggle a breakpoint.">
    <ol>
      {rows.map((row) => {
        const isCurrent = row.address === pc && !stopped;
        const hasBreakpoint = breakpoints.has(row.address);
        return <li key={row.address} data-current={isCurrent} className={`${isCurrent ? 'is-current' : ''}${row.patched ? ' is-patched' : ''}`}>
          <button
            type="button"
            className="cm-row"
            aria-pressed={hasBreakpoint}
            aria-label={`Address ${row.addr}: ${row.mnemonic}${row.operand ? ` ${row.operand}` : ''}${row.comment ? `, ${row.comment}` : ''}${isCurrent ? ', current instruction' : ''}${hasBreakpoint ? ', breakpoint set' : ''}`}
            onClick={() => onToggle(row.address)}
          >
            <span className="cm-bp" aria-hidden="true">{hasBreakpoint ? '●' : ''}</span>
            <span className="cm-arrow" aria-hidden="true">{isCurrent ? '▶' : ''}</span>
            <span className="cm-addr" aria-hidden="true">{row.addr}</span>
            <span className="cm-op" aria-hidden="true">{row.mnemonic}</span>
            <span className="cm-arg" aria-hidden="true">{row.operand}</span>
            <span className="cm-comment" aria-hidden="true">{row.comment ? `; ${row.comment}` : ''}{row.patched ? ' ; patched' : ''}</span>
          </button>
        </li>;
      })}
    </ol>
  </div>;
}
