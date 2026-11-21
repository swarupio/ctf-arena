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

export function StackPanel({ machine }) {
  const rows = stackRows(machine.stack);
  return <section className="cm-panel" aria-labelledby="cm-stack-title">
    <h3 id="cm-stack-title">Stack <span className="cm-dim">({rows.length} / {64})</span></h3>
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

export function MemoryPanel({ machine }) {
  const rows = memoryRows(machine.mem, machine.lastWrite);
  return <section className="cm-panel" aria-labelledby="cm-mem-title">
    <h3 id="cm-mem-title">Data memory</h3>
    <p className="cm-note">64 cells, addresses 0 to 63. The operand of instruction n is code cell {256} + n.</p>
    <table className="cm-mem">
      <caption className="cm-sr">Memory cells in decimal, eight per row</caption>
      <tbody>
        {rows.map((row) => <tr key={row.start}>
          <th scope="row">{pad(row.start, 2)}</th>
          {row.cells.map((cell) => <td
            key={cell.address}
            className={`${cell.changed ? 'is-changed' : ''}${cell.zero ? ' is-zero' : ''}`}
            title={`Cell ${cell.address}: ${cell.value} (0x${hex(cell.value, 2)})`}
          >{cell.value}</td>)}
        </tr>)}
      </tbody>
    </table>
  </section>;
}
