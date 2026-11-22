import { useEffect, useMemo, useRef, useState } from 'react';
import { printable } from '../../forensics/hex.js';
import { buildLayers, flattenTree, markOf } from '../../forensics/packetLayers.js';

const PER_ROW = 16;
const hex2 = (n) => n.toString(16).padStart(2, '0');

// Hex + ASCII of the frame (synthesised headers, then the captured payload); bytes inside `mark` ([start, end)) are
// highlighted (background, underline and an outline). Header bytes are tinted and the offsets tell the two parts apart too.
function HexPane({ bytes, mark, headerLength }) {
  const rows = [];
  for (let at = 0; at < bytes.length; at += PER_ROW) {
    const cells = [];
    const chars = [];
    for (let i = at; i < Math.min(bytes.length, at + PER_ROW); i += 1) {
      const hit = mark && i >= mark[0] && i < mark[1];
      const cls = hit ? 'fxp-hit' : (i < headerLength ? 'fxp-synth' : undefined);
      cells.push(<span key={i} className={cls}>{hex2(bytes[i])}{' '}</span>);
      chars.push(<span key={i} className={cls}>{printable(bytes[i])}</span>);
    }
    rows.push(<div key={at} className="fxp-hexrow"><span className="fx-off">{at.toString(16).padStart(4, '0')}</span><span className="fxp-bytes">{cells}</span><span className="fxp-chars">{chars}</span></div>);
  }
  return <div className="fxp-hexpane" role="group" aria-label="Frame hex and ASCII">{rows}</div>;
}

// Layered tree (arrow keys, Home/End, Enter or Space) + payload bytes + quick actions for the selected field.
export default function PacketDetail({ packet, onFilter, onCopy, neighbours, onJump, notice }) {
  const { nodes, bytes, frame, headerLength, hasOffsets } = useMemo(() => buildLayers(packet), [packet]);
  const [expanded, setExpanded] = useState(() => new Set(['app']));
  const [selectedId, setSelectedId] = useState(null);
  const [activeId, setActiveId] = useState(nodes[0].id);
  const treeRef = useRef(null);
  const focusNext = useRef(false);

  // A new packet starts with only its application layer open and nothing selected.
  useEffect(() => {
    setExpanded(new Set(['app']));
    setSelectedId(null);
    setActiveId(nodes[0].id);
  }, [nodes]);

  const visible = useMemo(() => flattenTree(nodes, expanded), [nodes, expanded]);
  const selected = visible.find((v) => v.node.id === selectedId)?.node ?? null;
  const mark = markOf(selected, headerLength);

  useEffect(() => {
    if (!focusNext.current) { return; }
    focusNext.current = false;
    treeRef.current?.querySelector(`[data-node="${CSS.escape(activeId)}"]`)?.focus();
  }, [activeId]);

  const moveTo = (id) => { focusNext.current = true; setActiveId(id); };
  const toggle = (id, open) => setExpanded((prev) => {
    const next = new Set(prev);
    if (open === undefined ? next.has(id) : !open) { next.delete(id); } else { next.add(id); }
    return next;
  });
  const choose = (node) => {
    setActiveId(node.id);
    setSelectedId(node.id);
    if (node.children?.length) { toggle(node.id); }
  };

  const onKeyDown = (event) => {
    const at = visible.findIndex((v) => v.node.id === activeId);
    if (at < 0) { return; }
    const { node, parent } = visible[at];
    const hasKids = Boolean(node.children?.length);
    const open = expanded.has(node.id);
    const handled = () => event.preventDefault();
    if (event.key === 'ArrowDown') { handled(); moveTo(visible[Math.min(visible.length - 1, at + 1)].node.id); }
    else if (event.key === 'ArrowUp') { handled(); moveTo(visible[Math.max(0, at - 1)].node.id); }
    else if (event.key === 'Home') { handled(); moveTo(visible[0].node.id); }
    else if (event.key === 'End') { handled(); moveTo(visible[visible.length - 1].node.id); }
    else if (event.key === 'ArrowRight') {
      handled();
      if (hasKids && !open) { toggle(node.id, true); } else if (hasKids) { moveTo(visible[at + 1].node.id); }
    } else if (event.key === 'ArrowLeft') {
      handled();
      if (hasKids && open) { toggle(node.id, false); } else if (parent) { moveTo(parent); }
    } else if (event.key === 'Enter' || event.key === ' ') { handled(); choose(node); }
  };

  const filterable = selected?.filter;
  const copyable = selected && selected.value !== '';
  let byteNote;
  if (!selected) { byteNote = 'Select a field to see its bytes.'; }
  else if (mark) {
    byteNote = `Frame bytes ${mark[0]} to ${mark[1] - 1} (${mark[1] - mark[0]} bytes) are highlighted${mark[1] <= headerLength ? ', inside the synthesised header' : ''}.`;
  } else if (!hasOffsets && selected.id === 'app') { byteNote = 'This packet has no payload bytes to highlight.'; }
  else { byteNote = 'This field is derived from the packet and has no bytes of its own, so nothing is highlighted.'; }

  return <div className="fxp-detail-body">
    <div className="fxp-grid">
      <div>
        <h4 id="fxp-tree-title">Packet details</h4>
        <div ref={treeRef} className="fxp-tree" role="tree" aria-labelledby="fxp-tree-title" onKeyDown={onKeyDown}>
          {visible.map(({ node, depth }) => {
            const hasKids = Boolean(node.children?.length);
            const open = expanded.has(node.id);
            return <div
              key={node.id} role="treeitem" data-node={node.id} aria-level={depth} aria-selected={selectedId === node.id}
              aria-expanded={hasKids ? open : undefined} tabIndex={activeId === node.id ? 0 : -1}
              className={`fxp-node${selectedId === node.id ? ' is-selected' : ''}${depth === 1 ? ' is-layer' : ''}`}
              style={{ paddingLeft: `calc(var(--space-2) + ${(depth - 1) * 16}px)` }}
              onClick={() => choose(node)} onFocus={() => setActiveId(node.id)}
            >
              <span className="fxp-twist" aria-hidden="true">{hasKids ? (open ? '[-]' : '[+]') : ''}</span>
              <span className="fxp-label">{node.label}</span>
              {node.value !== '' && <span className="fxp-value">{node.value}</span>}
            </div>;
          })}
        </div>
        <div className="fxp-actions" role="group" aria-label="Field actions">
          <button type="button" className="secondary small" disabled={!copyable} onClick={() => onCopy(selected.value)}>Copy value</button>
          <button type="button" className="secondary small" disabled={!filterable} onClick={() => onFilter(filterable)}
            title={filterable ? `Adds: ${filterable}` : 'This field has no matching filter'}>Filter on this value</button>
          {neighbours && <>
            <button type="button" className="secondary small" disabled={neighbours.prev === null} onClick={() => onJump(neighbours.prev)}>Previous in stream</button>
            <button type="button" className="secondary small" disabled={neighbours.next === null} onClick={() => onJump(neighbours.next)}>Next in stream</button>
          </>}
        </div>
        <p className="fx-muted fxp-note" role="status">
          {notice ?? (selected ? `${selected.label}${selected.value ? `: ${selected.value}` : ''}` : 'Keys: arrows move, Right and Left open and close, Enter selects.')}
          {neighbours && ` Packet ${neighbours.position} of ${neighbours.count} in this stream.`}
        </p>
      </div>
      <div>
        <h4>Frame bytes ({headerLength} header + {bytes.length} payload captured)</h4>
        <HexPane bytes={frame} mark={mark} headerLength={headerLength} />
        <p className="fx-muted fxp-note">Header bytes (tinted) are built from the packet fields. Lengths, addresses, ports, flags and the sequence number follow the packet; time to live, window and acknowledgment are placeholders and checksums are not computed.</p>
        <p className="fx-muted fxp-note" role="status">{byteNote}</p>
      </div>
    </div>
  </div>;
}
