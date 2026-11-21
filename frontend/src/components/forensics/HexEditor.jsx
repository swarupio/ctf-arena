import { useEffect, useMemo, useRef, useState } from 'react';
import { getArtefact } from '../../api/forensics.js';
import { describeForensicsError } from '../../forensics/caseHelpers.js';
import { hexRows, offsetLabel } from '../../forensics/hex.js';
import VirtualList from './VirtualList.jsx';

const PAGE = 1024;
const PER_ROW = 16;

// Read-only hex editor for a small generated file. Pages of 1 KiB come from the server; rows are virtualised.
export default function HexEditor({ track, artefact }) {
  const [file, setFile] = useState({ name: '', size: 0, hex: '' });
  const [error, setError] = useState('');
  const [jump, setJump] = useState('');
  const [find, setFind] = useState('');
  const list = useRef(null);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        let hex = '';
        let size = Infinity;
        let name = '';
        for (let offset = 0; offset < size; offset += PAGE) {
          const page = await getArtefact(track, artefact.id, { offset, limit: PAGE }, { signal: controller.signal });
          hex += page.hex; size = page.size; name = page.name;
          setFile({ name, size, hex });
        }
      } catch (e) { if (!controller.signal.aborted) { setError(describeForensicsError(e)); } }
    })();
    return () => controller.abort();
  }, [track, artefact.id]);

  const rows = useMemo(() => hexRows(file.hex, 0, PER_ROW), [file.hex]);
  const matches = useMemo(() => {
    const needle = find.trim().toLowerCase();
    if (needle.length < 2) { return new Set(); }
    const hits = new Set();
    rows.forEach((row, i) => { if (row.ascii.toLowerCase().includes(needle) || row.hex.join('').includes(needle.replace(/\s/g, ''))) { hits.add(i); } });
    return hits;
  }, [rows, find]);

  const goTo = (offset) => {
    const row = Math.min(rows.length - 1, Math.max(0, Math.floor(offset / PER_ROW)));
    const node = list.current?.querySelector('.fx-scroller');
    if (node) { node.scrollTop = row * 22; }
  };
  const submitJump = (event) => {
    event.preventDefault();
    const value = jump.trim().toLowerCase().startsWith('0x') ? Number.parseInt(jump, 16) : Number.parseInt(jump, 10);
    if (Number.isFinite(value)) { goTo(value); }
  };

  return <section className="fx-tool" aria-label="Hex editor">
    <p className="fx-meta">{file.name || artefact.title} · {file.size} bytes · offsets in hex</p>
    <div className="fx-controls">
      <form onSubmit={submitJump} className="fx-inline">
        <label>Go to offset<input value={jump} onChange={(e) => setJump(e.target.value)} placeholder="1200 or 0x4b0" maxLength={10} inputMode="text" /></label>
        <button type="submit" className="secondary">Go</button>
        <button type="button" className="secondary" onClick={() => goTo(file.size)}>End of file</button>
      </form>
      <label className="fx-grow">Find text or hex<input value={find} onChange={(e) => setFind(e.target.value)} maxLength={40} placeholder="e.g. JFIF or ffd9" spellCheck="false" /></label>
    </div>
    <p className="fx-status" role="status">{matches.size > 0 ? `${matches.size} rows match (highlighted)` : 'Tip: a JPEG image ends with the marker ff d9.'}</p>
    {error && <p role="alert" className="error">{error}</p>}
    <div ref={list}>
      <VirtualList
        count={rows.length} rowHeight={22} label="File bytes" className="fx-hexlist"
        renderRow={(i) => {
          const row = rows[i];
          return <span className={`fx-hexrow${matches.has(i) ? ' is-hit' : ''}`}>
            <span className="fx-off">{offsetLabel(row.offset)}</span>
            <span className="fx-bytes">{row.hex.join(' ').padEnd(PER_ROW * 3 - 1)}</span>
            <span className="fx-ascii" aria-hidden="true">{row.ascii}</span>
          </span>;
        }}
      />
    </div>
  </section>;
}
