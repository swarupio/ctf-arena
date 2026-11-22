import { useCallback, useMemo, useState } from 'react';
import { filterPackets, parseFilter } from '../../forensics/packetFilter.js';
import { combineFilter } from '../../forensics/packetLayers.js';
import { normalizePackets } from '../../forensics/packetRows.js';
import { buildStream, conversationNeighbours, indexConversations } from '../../forensics/packetStream.js';
import { packetPin } from '../../forensics/timeline.js';
import { usePagedArtefact } from './hooks.js';
import PacketDetail from './PacketDetail.jsx';
import PacketFilterBar from './PacketFilterBar.jsx';
import PacketStream from './PacketStream.jsx';
import VirtualList from './VirtualList.jsx';
import './packets.css';

const PAGE = 250;
// Rows are made safe once, here (null protocol or address, string numbers), so nothing below needs to guard each field.
const pick = (page) => normalizePackets(page.packets);

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through to the textarea copy */ }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch { return false; }
}

export default function PacketTable({ track, artefact, timeline }) {
  const { items, total, loading, error } = usePagedArtefact({ track, artefact: artefact.id, pageSize: PAGE, pick });
  const [source, setSource] = useState('');
  const [selectedN, setSelectedN] = useState(null);
  const [followN, setFollowN] = useState(null);
  const [view, setView] = useState('list');
  const [notice, setNotice] = useState(null);
  const [order, setOrder] = useState('capture');
  const parsed = useMemo(() => parseFilter(source), [source]);
  const shown = useMemo(() => (parsed.ok ? filterPackets(items, parsed) : items), [items, parsed]);
  const byNumber = useMemo(() => new Map(items.map((p) => [p.n, p])), [items]);
  const conversations = useMemo(() => indexConversations(items), [items]);
  const packet = selectedN === null ? null : byNumber.get(selectedN) ?? null;
  const selectedIndex = packet ? shown.findIndex((p) => p.n === packet.n) : -1;
  const neighbours = useMemo(() => (packet ? conversationNeighbours(conversations, packet) : null), [conversations, packet]);
  const stream = useMemo(() => {
    const followed = followN === null ? null : byNumber.get(followN);
    return followed ? buildStream(conversations, followed, { order }) : null;
  }, [conversations, byNumber, followN, order]);

  const select = useCallback((n) => { setSelectedN(n); setNotice(null); setView('detail'); }, []);
  const edit = (value) => { setSource(value); setNotice(null); };
  const step = (delta) => {
    if (shown.length === 0) { return; }
    const at = selectedIndex < 0 ? (delta > 0 ? 0 : shown.length - 1) : Math.min(shown.length - 1, Math.max(0, selectedIndex + delta));
    select(shown[at].n);
  };
  const jump = (n) => {
    select(n);
    if (parsed.ok && !shown.some((p) => p.n === n)) { setNotice(`Packet ${n} is hidden by the current filter. Clear the filter to find it in the list.`); }
  };
  const copy = async (text) => { setNotice((await copyText(text)) ? 'Copied to the clipboard.' : 'Copy is not available in this browser. Select the text and copy it by hand.'); };
  const filterOn = (expression) => { setSource((current) => combineFilter(parsed.ok ? current : '', expression)); setNotice(`Filter set: ${expression}`); setView('list'); };

  return <section className="fx-tool fxp" data-view={view} aria-label="Packet viewer">
    <div className="fxp-listpane">
      <PacketFilterBar value={source} onChange={edit} parsed={parsed} shown={shown.length} loaded={items.length} total={total} loading={loading} />
      {error && <p role="alert" className="error">{error}</p>}
      <div className="fx-pkt-wrap">
        <div className="fx-pkt-head" aria-hidden="true">
          <span>No.</span><span>Time</span><span>Source</span><span>Destination</span><span>Proto</span><span>Len</span><span>Info</span>
        </div>
        <VirtualList
          count={shown.length} rowHeight={24} label="Captured packets" className="fx-pkt" selected={selectedIndex < 0 ? null : selectedIndex}
          revealSelected onActivate={(i) => select(shown[i].n)}
          renderRow={(i) => {
            const p = shown[i];
            return <><span>{p.n}</span><span>{p.t}</span><span>{p.src}{p.sp ? `:${p.sp}` : ''}</span><span>{p.dst}{p.dp ? `:${p.dp}` : ''}</span>
              <span className={`fx-proto fx-proto-${String(p.proto ?? '').toLowerCase()}`}>{p.proto}</span><span>{p.len}</span><span className="fx-info">{p.info}</span></>;
          }}
        />
      </div>
    </div>
    <div className="fx-detail fxp-detail" role="region" aria-label="Selected packet">
      <div className="fx-row-buttons">
        <button type="button" className="secondary small fxp-back" onClick={() => setView('list')}>Back to packet list</button>
        <button type="button" className="secondary small" disabled={shown.length === 0} onClick={() => step(-1)}>Previous</button>
        <button type="button" className="secondary small" disabled={shown.length === 0} onClick={() => step(1)}>Next</button>
        <button type="button" className="small" disabled={!packet} onClick={() => setFollowN(packet.n)}>Follow stream</button>
        {timeline && <button type="button" className="small" disabled={!packet || timeline.has(`packet:${packet.n}`)} onClick={() => timeline.pin(packetPin(packet))}>
          {packet && timeline.has(`packet:${packet.n}`) ? 'Pinned' : 'Pin packet'}
        </button>}
      </div>
      {packet ? <>
        <h3>Packet {packet.n}</h3>
        <p className="fx-meta">{packet.src}:{packet.sp} {'->'} {packet.dst}:{packet.dp} · {packet.proto} · {packet.len} bytes · t={packet.t}s</p>
        <PacketDetail packet={packet} onFilter={filterOn} onCopy={copy} neighbours={neighbours} onJump={jump} notice={notice} />
      </> : <p className="fx-muted">Tap or click a row to select a packet and inspect its layers and payload.</p>}
      {stream && <PacketStream stream={stream} loading={loading} onClose={() => setFollowN(null)} onCopy={copy} onSelect={select} order={order} onOrder={setOrder} />}
    </div>
  </section>;
}
