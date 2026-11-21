import { useMemo, useState } from 'react';
import { hexRows } from '../../forensics/hex.js';
import { filterPackets, followStream, parseFilter } from '../../forensics/packetFilter.js';
import { usePagedArtefact } from './hooks.js';
import VirtualList from './VirtualList.jsx';

const PAGE = 250;
const pick = (page) => page.packets;
const EXAMPLES = ['proto == dns', 'ip.addr == 10.0.1.21', 'proto == http && info contains "beacon"', 'port == 9001', 'payload contains "x-task"'];

export default function PacketTable({ track, artefact }) {
  const { items, total, loading, error } = usePagedArtefact({ track, artefact: artefact.id, pageSize: PAGE, pick });
  const [source, setSource] = useState('');
  const [selected, setSelected] = useState(null);
  const [stream, setStream] = useState(null);
  const parsed = useMemo(() => parseFilter(source), [source]);
  const shown = useMemo(() => (parsed.ok ? filterPackets(items, parsed) : items), [items, parsed]);
  const packet = selected === null ? null : shown[selected] ?? null;
  // The dump only changes with the selected packet, not with every keystroke in the filter box.
  const dump = useMemo(() => (packet?.hex
    ? hexRows(packet.hex).map((row) => `${row.offset.toString(16).padStart(4, '0')}  ${row.hex.join(' ').padEnd(47)}  ${row.ascii}`).join('\n')
    : null), [packet]);

  return <section className="fx-tool" aria-label="Packet viewer">
    <form className="fx-controls" onSubmit={(event) => event.preventDefault()} role="search">
      <label className="fx-grow">Display filter
        <input
          value={source} onChange={(event) => { setSource(event.target.value); setSelected(null); }} maxLength={200} spellCheck="false"
          autoComplete="off" placeholder='e.g. proto == dns && ip.src == 10.0.1.21' aria-invalid={!parsed.ok} aria-describedby="fx-pkt-help" list="fx-pkt-examples"
        />
        <datalist id="fx-pkt-examples">{EXAMPLES.map((example) => <option key={example} value={example} />)}</datalist>
      </label>
      <button type="button" className="secondary" onClick={() => { setSource(''); setSelected(null); }} disabled={source === ''}>Clear</button>
    </form>
    <p id="fx-pkt-help" className="fx-status" role="status">
      {!parsed.ok ? <span className="fx-bad">{parsed.error}</span>
        : `${shown.length.toLocaleString()} of ${items.length.toLocaleString()} packets${loading ? ` (loading ${items.length}/${total || '?'})` : ''}`}
      {' · fields: ip.addr ip.src ip.dst port proto frame.len info payload'}
    </p>
    {error && <p role="alert" className="error">{error}</p>}
    <div className="fx-pkt-wrap">
      <div className="fx-pkt-head" aria-hidden="true">
        <span>No.</span><span>Time</span><span>Source</span><span>Destination</span><span>Proto</span><span>Len</span><span>Info</span>
      </div>
      <VirtualList
        count={shown.length} rowHeight={24} label="Captured packets" className="fx-pkt" selected={selected} onActivate={setSelected}
        renderRow={(i) => {
          const p = shown[i];
          return <><span>{p.n}</span><span>{p.t}</span><span>{p.src}{p.sp ? `:${p.sp}` : ''}</span><span>{p.dst}{p.dp ? `:${p.dp}` : ''}</span>
            <span className={`fx-proto fx-proto-${p.proto.toLowerCase()}`}>{p.proto}</span><span>{p.len}</span><span className="fx-info">{p.info}</span></>;
        }}
      />
    </div>
    <div className="fx-detail">
      <div className="fx-row-buttons">
        <button type="button" className="secondary small" disabled={selected === null || shown.length === 0}
          onClick={() => setSelected((s) => Math.max(0, (s ?? 0) - 1))}>Previous</button>
        <button type="button" className="secondary small" disabled={shown.length === 0}
          onClick={() => setSelected((s) => Math.min(shown.length - 1, (s ?? -1) + 1))}>Next</button>
        <button type="button" className="small" disabled={!packet || !packet.hex} onClick={() => setStream(followStream(items, packet))}>Follow stream</button>
      </div>
      {packet ? <>
        <h3>Packet {packet.n}</h3>
        <p className="fx-meta">{packet.src}:{packet.sp} {'->'} {packet.dst}:{packet.dp} · {packet.proto} · {packet.len} bytes · t={packet.t}s</p>
        {packet.hex ? <pre className="fx-hex" aria-label="Payload hex dump">{dump}</pre>
          : <p className="fx-muted">No payload.</p>}
      </> : <p className="fx-muted">Select a packet (click a row) to inspect its payload.</p>}
      {stream && <div className="fx-stream" role="region" aria-label="Followed stream">
        <div className="fx-row-buttons"><h3>Stream ({stream.length} packets)</h3><button type="button" className="secondary small" onClick={() => setStream(null)}>Close</button></div>
        <pre>{stream.map((s) => `${s.outbound ? '>> ' : '<< '}[${s.n}] ${s.text}`).join('\n')}</pre>
      </div>}
    </div>
  </section>;
}
