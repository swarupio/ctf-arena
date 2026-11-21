// Renders the structured page the simulated server answered with. Every value is a React text node: the UI never
// uses innerHTML, so player-controlled text (even a pasted <script>) can only ever be shown as plain text.
export default function PageBlocks({ blocks }) {
  return <div className="wl-page">
    {blocks.map((block, index) => {
      switch (block.t) {
        case 'heading': return <h3 key={index} className="wl-page-title">{block.text}</h3>;
        case 'notice': return <p key={index} className={`wl-notice is-${block.tone ?? 'info'}`} role={block.tone === 'error' ? 'alert' : 'status'}>{block.text}</p>;
        case 'code': return <pre key={index} className="wl-code" tabIndex={0}>{block.text}</pre>;
        case 'table': return <div key={index} className="wl-table-wrap" tabIndex={0}>
          <table>
            {block.columns && <thead><tr>{block.columns.map((column) => <th key={column} scope="col">{column}</th>)}</tr></thead>}
            <tbody>{(block.rows ?? []).map((row, r) => <tr key={r}>{row.map((cell, c) => <td key={c}>{String(cell)}</td>)}</tr>)}</tbody>
          </table>
        </div>;
        case 'kv': return <dl key={index} className="wl-kv">
          {(block.items ?? []).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{String(value)}</dd></div>)}
        </dl>;
        default: return <p key={index}>{block.text}</p>;
      }
    })}
  </div>;
}
