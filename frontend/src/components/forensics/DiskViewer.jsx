import { useState } from 'react';
import { hexRows, offsetLabel } from '../../forensics/hex.js';
import { useArtefact } from './hooks.js';

// Virtual disk: directory listing (deleted entries are flagged) and a raw cluster reader for carving data back.
export default function DiskViewer({ track, artefact }) {
  const listing = useArtefact(track, artefact.id, {});
  const [cluster, setCluster] = useState(null);
  const [count, setCount] = useState(1);
  const [typed, setTyped] = useState('');
  const clusters = useArtefact(track, artefact.id, cluster === null ? { cluster: 0, count: 1 } : { cluster, count });
  const data = listing.data;
  const open = (start, size) => { setCluster(start); setCount(Math.max(1, Math.min(8, Math.ceil(size / (data?.clusterSize ?? 128))))); setTyped(String(start)); };
  const submit = (event) => {
    event.preventDefault();
    const n = Number.parseInt(typed, 10);
    if (Number.isInteger(n) && n >= 0 && n < (data?.clusterCount ?? 256)) { setCluster(n); }
  };

  return <section className="fx-tool" aria-label="Disk viewer">
    {listing.loading && <p role="status">Mounting disk...</p>}
    {listing.error && <p role="alert" className="error">{listing.error}</p>}
    {data && <>
      <p className="fx-meta">{data.entries.length} directory entries · {data.clusterCount} clusters of {data.clusterSize} bytes. Deleted entries lose the first letter of their name (shown as _).</p>
      <div className="fx-table-wrap fx-disk">
        <table className="fx-table">
          <caption className="fx-sr">Directory entries</caption>
          <thead><tr><th scope="col">Inode</th><th scope="col">Name</th><th scope="col">Size</th><th scope="col">Modified</th><th scope="col">Status</th><th scope="col">Cluster</th><th scope="col"><span className="fx-sr">Open</span></th></tr></thead>
          <tbody>{data.entries.map((entry) => <tr key={entry.inode} className={entry.deleted ? 'is-deleted' : undefined}>
            <td>{entry.inode}</td><th scope="row" className="fx-wrap">{entry.name}</th><td>{entry.size}</td><td>{entry.mtime}</td>
            <td>{entry.deleted ? 'deleted' : 'in use'}</td><td>{entry.cluster}</td>
            <td><button type="button" className="secondary small" onClick={() => open(entry.cluster, entry.size)} aria-label={`Read clusters of ${entry.name}`}>Read</button></td>
          </tr>)}</tbody>
        </table>
      </div>
      <form className="fx-inline" onSubmit={submit}>
        <label>Cluster number<input value={typed} onChange={(e) => setTyped(e.target.value)} inputMode="numeric" maxLength={3} placeholder="0-255" /></label>
        <label>How many<select value={count} onChange={(e) => setCount(Number(e.target.value))}>{[1, 2, 3, 4, 6, 8].map((k) => <option key={k} value={k}>{k}</option>)}</select></label>
        <button type="submit" className="secondary">Read clusters</button>
      </form>
      {cluster !== null && clusters.error && <p role="alert" className="error">{clusters.error}</p>}
      {cluster !== null && clusters.data && <pre className="fx-hex" aria-label="Cluster contents">
        {clusters.data.clusters.map((c) => `-- cluster ${c.n} --\n${hexRows(c.hex, 0, 16).map((row) => `${offsetLabel(row.offset).slice(4)}  ${row.hex.join(' ').padEnd(47)}  ${row.ascii}`).join('\n')}`).join('\n')}
      </pre>}
    </>}
  </section>;
}
