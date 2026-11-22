import { hex, memoryRows, pad, stackRows, verdictText } from './helpers.js';

export function Registers({ machine }) {
  const items = [
    ['PC', pad(machine.pc)],
    ['STEPS', `${machine.steps} / ${machine.maxSteps}`],
    ['INPUT PTR', `${machine.ip} / ${machine.input.length}`],
    ['LAST CMP', machine.flag === null ? '-' : machine.flag === 0 ? '0 (equal)' : '1 (different)'],
    ['DEBUGGER', machine.debugger ? 'attached (DBG = 1)' : 'hidden (DBG = 0)'],
  ];
  return <section className="cm-panel" aria-labelledby="cm-reg-title">
    <h3 id="cm-reg-title">Registers</h3>
    <dl className="cm-regs">{items.map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl>
    <p role="status" className={`cm-verdict is-${machine.status}`}>{verdictText(machine)}</p>
  </section>;
}

export function StackPanel({ machine, limit }) {
  const rows = stackRows(machine.stack);
  return <section className="cm-panel" aria-labelledby="cm-stack-title">
    <h3 id="cm-stack-title">Stack <span className="cm-dim">({rows.length} / {limit})</span></h3>
    {rows.length === 0
      ? <p className="cm-note">Empty.</p>
      : <ol className="cm-stack" aria-label="Stack, top first">
        {rows.map((row, position) => <li key={row.index} className={position === 0 ? 'is-top' : undefined}>
          <span className="cm-dim">{position === 0 ? 'top' : `-${position}`}</span>
          <strong>{row.value}</strong>
          <span className="cm-dim">0x{hex(row.value, 2)} {row.char}</span>
        </li>)}
      </ol>}
  </section>;
}

export function MemoryPanel({ machine, vm, watched = [], onToggleWatch }) {
  const rows = memoryRows(machine.mem, machine.lastWrite);
  return <section className="cm-panel" aria-labelledby="cm-mem-title">
    <h3 id="cm-mem-title">Data memory</h3>
    <p className="cm-note">{vm.memSize} cells, addresses 0 to {vm.memSize - 1}. The operand of instruction n is code cell {vm.codeBase} + n.</p>
    <p className="cm-note cm-scroll-hint">Swipe sideways to see every column.</p>
    <div className="cm-mem-scroll" tabIndex={0} role="group" aria-label="Memory cells, scrolls sideways">
    <table className="cm-mem">
      <caption className="cm-sr">Memory cells in decimal, eight per row. Each cell is a button that pins it to the watch list.</caption>
      <tbody>
        {rows.map((row) => <tr key={row.start}>
          <th scope="row">{pad(row.start, 2)}</th>
          {row.cells.map((cell) => {
            const pinned = watched.includes(cell.address);
            return <td
              key={cell.address}
              className={`${cell.changed ? 'is-changed' : ''}${cell.zero ? ' is-zero' : ''}${pinned ? ' is-watched' : ''}`}
              title={`Cell ${cell.address}: ${cell.value} (0x${hex(cell.value, 2)})`}
            >{onToggleWatch
              ? <button
                type="button"
                className="cm-cell"
                aria-pressed={pinned}
                aria-label={`Cell ${cell.address}: ${cell.value}${cell.changed ? ', written by the last step' : ''}. ${pinned ? 'Pinned, activate to unpin' : 'Activate to pin to the watch list'}`}
                onClick={() => onToggleWatch(cell.address)}
              >{cell.value}</button>
              : cell.value}</td>;
          })}
        </tr>)}
      </tbody>
    </table>
    </div>
  </section>;
}
