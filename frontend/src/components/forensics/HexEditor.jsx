import { useEffect, useMemo, useRef, useState } from 'react';
import { getArtefact } from '../../api/forensics.js';
import { describeForensicsError } from '../../forensics/caseHelpers.js';
import { findMatches, hexRows, matchRows, offsetLabel } from '../../forensics/hex.js';
import VirtualList from './VirtualList.jsx';

const PAGE = 1024;
const PER_ROW = 16;

// Read-only hex editor for a small generated file. Pages of 1 KiB come from the server; rows are virtualised.
export default function HexEditor({ track, artefact }) {
  const [file, setFile] = useState({ name: '', size: 0, hex: '' });
  const [error, setError] = useState('');
  const [jump, setJump] = useState('');
  const [find, setFind] = useState('');
  const [current, setCurrent] = useState(0);
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
  // Matches are found in the whole file (not row by row), so one that straddles two rows is not missed.
  const matches = useMemo(() => findMatches(file.hex, find), [file.hex, find]);
  const hitRows = useMemo(() => {
    const hits = new Set();
    matches.forEach((match) => matchRows(match, PER_ROW).forEach((row) => hits.add(row)));
    return hits;
  }, [matches]);
  const active = matches.length > 0 ? matches[Math.min(current, matches.length - 1)] : null;
  const activeRows = useMemo(() => new Set(active ? matchRows(active, PER_ROW) : []), [active]);

  const goTo = (offset) => {
    const row = Math.min(rows.length - 1, Math.max(0, Math.floor(offset / PER_ROW)));
    const node = list.current?.querySelector('.fx-scroller');
    if (node) { node.scrollTop = row * 22; }
  };
  const step = (delta) => {
    if (matches.length === 0) { return; }
    const next = (Math.min(current, matches.length - 1) + delta + matches.length) % matches.length;
    setCurrent(next);
    goTo(matches[next].offset);
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
      <div className="fx-inline fx-grow">
      <label className="fx-grow">Find text or hex<input value={find} onChange={(e) => { setFind(e.target.value); setCurrent(0); }} maxLength={40} placeholder="e.g. JFIF or ffd9" spellCheck="false" /></label>
        <button type="button" className="secondary" onClick={() => step(-1)} disabled={matches.length === 0}>Previous match</button>
        <button type="button" className="secondary" onClick={() => step(1)} disabled={matches.length === 0}>Next match</button>
      </div>
    </div>
    <p className="fx-status" role="status">{matches.length > 0 ? `Match ${Math.min(current, matches.length - 1) + 1} of ${matches.length} (highlighted)` : find.trim().length >= 2 ? 'No match.' : 'Tip: a JPEG image ends with the marker ff d9.'}</p>
    {error && <p role="alert" className="error">{error}</p>}
    <div ref={list}>
      <VirtualList
        count={rows.length} rowHeight={22} label="File bytes" className="fx-hexlist"
        renderRow={(i) => {
          const row = rows[i];
          return <span className={`fx-hexrow${hitRows.has(i) ? ' is-hit' : ''}${activeRows.has(i) ? ' is-current' : ''}`}>
            <span className="fx-off">{offsetLabel(row.offset)}</span>
            <span className="fx-bytes">{row.hex.join(' ').padEnd(PER_ROW * 3 - 1)}</span>
            <span className="fx-ascii" aria-hidden="true">{row.ascii}</span>
          </span>;
        }}
      />
    </div>
  </section>;
}
