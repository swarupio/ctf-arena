import { OPCODES } from './vm.js';

export default function IsaReference() {
  return <details className="cm-box cm-isa">
    <summary>Instruction set reference ({Object.keys(OPCODES).length} instructions)</summary>
    <p className="cm-note">
      A stack machine with 32-bit unsigned values that wrap around. Instructions run from address 0. An instruction with an
      operand shows it after the mnemonic. Input is read one character code at a time.
    </p>
    <table className="cm-isa-table">
      <caption className="cm-sr">Instructions</caption>
      <thead><tr><th scope="col">Instruction</th><th scope="col">Effect</th></tr></thead>
      <tbody>
        {Object.entries(OPCODES).map(([name, info]) => <tr key={name}>
          <th scope="row"><code>{name}{info.operand ? ' n' : ''}</code></th>
          <td>{info.doc}</td>
        </tr>)}
      </tbody>
    </table>
  </details>;
}
