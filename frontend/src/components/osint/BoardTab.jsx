import { useEffect, useRef, useState } from 'react';
import { listEvidence } from '../../api/osint.js';
import { useDesk } from './DeskContext.jsx';
import { useBoard } from './useBoard.js';
import { describeOsintError } from '../../osint/helpers.js';
import {
  DRAG_THRESHOLD, KINDS, KIND_LABEL, checkText, checksLeftText, keyMove, levelPercent, levelText, nextPinPosition, suggestRelation, whyNot, describeLink,
} from '../../osint/board.js';

// Pin cards are this big (CSS pixels); the lines are drawn between their centres.
const PIN_W = 132;
const PIN_H = 54;

function Meter({ board, check, checked, checkError, pending }) {
  const percent = levelPercent(board.progress);
  // The exact count only describes the board as it was SAVED when it was checked.
  const fresh = checked && checked.version === board.version && pending === 0;
  return <section className="os-paper os-stack" aria-labelledby="os-board-title">
    <h3 id="os-board-title">Case theory</h3>
    <div className="os-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={levelText(board.progress)} aria-label="Case theory progress"><span style={{ width: `${percent}%` }} /></div>
    <p><strong>{levelText(board.progress)}</strong>{board.unlocked ? ' - the final question is open.' : ''}</p>
    {!board.readOnly && <div className="os-stack">
      <button type="button" className="secondary" onClick={check} disabled={pending > 0 || board.unlocked}>Check my chain</button>
      <p className="os-muted" role="status" aria-live="polite">
        {checkError || (fresh ? `${checkText(checked)} ${checksLeftText(checked.checksLeft)}` : (checked ? 'The board changed since the last check. Check again for a fresh count.' : 'Checks the saved board and shows an exact count. Limited to 3 a minute and 10 an hour.'))}
      </p>
    </div>}
    <p className="os-muted" aria-live="polite">{board.nudge}</p>
    <p className="os-muted">
      The final question opens once your team&apos;s board connects the suspect to the crime. Pin the evidence that matters, then
      link two pieces only when a source really ties them together and say how. Only the evidence and the kind of link are
      compared; the answer is never revealed. Spare links are limited ({board.limits.links} at most), so guessing every pair cannot work.
      The board is shared: teammates see your changes and can split the case.
    </p>
    <p className="os-muted">Pins {board.pins.length}/{board.limits.pins} · Links {board.links.length}/{board.limits.links}</p>
  </section>;
}

function Canvas({ board, selected, onSelect, dispatch, readOnly }) {
  const canvasRef = useRef(null);
  const [size, setSize] = useState({ w: 640, h: 480 });
  const [drag, setDrag] = useState(null);
  useEffect(() => {
    const node = canvasRef.current;
    if (!node || typeof ResizeObserver === 'undefined') { return undefined; }
    const observer = new ResizeObserver(([entry]) => setSize({ w: entry.contentRect.width, h: entry.contentRect.height }));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const spanX = Math.max(1, size.w - PIN_W);
  const spanY = Math.max(1, size.h - PIN_H);
  const shown = board.pins.map((p) => (drag?.id === p.id ? { ...p, x: drag.x, y: drag.y } : p));
  const centre = (p) => ({ cx: (p.x / 1000) * spanX + PIN_W / 2, cy: (p.y / 1000) * spanY + PIN_H / 2 });
  const byId = new Map(shown.map((p) => [p.id, p]));

  function down(event, pin) {
    if (readOnly || event.button > 0) { return; }
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDrag({ id: pin.id, startX: event.clientX, startY: event.clientY, x: pin.x, y: pin.y, ox: pin.x, oy: pin.y, moved: false });
  }
  function move(event) {
    if (!drag) { return; }
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    const moved = drag.moved || Math.hypot(dx, dy) > DRAG_THRESHOLD;
    if (!moved) { return; }
    const clamp = (v) => Math.min(1000, Math.max(0, Math.round(v)));
    setDrag({ ...drag, moved, x: clamp(drag.ox + (dx / spanX) * 1000), y: clamp(drag.oy + (dy / spanY) * 1000) });
  }
  function up(pin) {
    if (!drag) { return; }
    if (drag.moved) { dispatch({ type: 'move', id: pin.id, x: drag.x, y: drag.y }); } else { onSelect(pin.id); }
    setDrag(null);
  }
  function key(event, pin) {
    if (readOnly) { return; }
    const target = keyMove(pin, event.key, event.shiftKey);
    if (target) {
      event.preventDefault();
      dispatch({ type: 'move', id: pin.id, ...target });
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      dispatch({ type: 'unpin', id: pin.id });
      onSelect(pin.id, true);
    }
  }

  return <div className="os-board-scroll" role="region" aria-label="Pinboard, scrolls sideways on small screens" tabIndex={0}>
    <div className="os-board-canvas" ref={canvasRef}>
      <svg className="os-board-lines" width={size.w} height={size.h} aria-hidden="true" focusable="false">
        {board.links.map((l) => {
          const a = byId.get(l.a);
          const b = byId.get(l.b);
          if (!a || !b) { return null; }
          const p = centre(a);
          const q = centre(b);
          return <g key={`${l.rel}|${l.a}|${l.b}`}>
            <line x1={p.cx} y1={p.cy} x2={q.cx} y2={q.cy} className="os-string" />
            <text x={(p.cx + q.cx) / 2} y={(p.cy + q.cy) / 2 - 4} className="os-string-label" textAnchor="middle">{l.rel}</text>
          </g>;
        })}
      </svg>
      {board.pins.length === 0 && <p className="os-board-empty os-muted">Nothing pinned yet. Add evidence from the list below.</p>}
      {shown.map((p) => <button
        key={p.id} type="button" className={`os-pin os-pin-${p.kind}${selected.includes(p.id) ? ' is-selected' : ''}${drag?.id === p.id && drag.moved ? ' is-dragging' : ''}`}
        style={{ '--x': p.x / 1000, '--y': p.y / 1000, width: PIN_W, height: PIN_H }}
        aria-pressed={selected.includes(p.id)}
        aria-label={`${KIND_LABEL[p.kind] ?? 'Evidence'}: ${p.label}. Enter selects it for linking. ${readOnly ? '' : 'Arrow keys move it, Delete removes it.'}`}
        onPointerDown={(e) => down(e, p)} onPointerMove={move} onPointerUp={() => up(p)} onPointerCancel={() => setDrag(null)}
        onKeyDown={(e) => key(e, p)} onClick={(e) => { if (e.detail === 0) { onSelect(p.id); } }}
      ><span className="os-pin-kind">{KIND_LABEL[p.kind] ?? 'Item'}</span><span className="os-pin-label">{p.label}</span></button>)}
    </div>
  </div>;
}

function Connect({ board, selected, setSelected, dispatch }) {
  const [rel, setRel] = useState('linked');
  const [touched, setTouched] = useState(false);
  const [a, b] = selected;
  const pinOf = (id) => board.pins.find((p) => p.id === id);
  useEffect(() => {
    if (!touched && pinOf(a) && pinOf(b)) { setRel(suggestRelation(pinOf(a).kind, pinOf(b).kind)); }
    // The suggestion only depends on the two chosen pins.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a, b, touched]);
  const op = { type: 'link', link: { a, b, rel } };
  const problem = a && b ? whyNot(board, op) : null;
  const ready = Boolean(pinOf(a) && pinOf(b)) && !problem;
  function submit(event) {
    event.preventDefault();
    if (!ready) { return; }
    dispatch(op);
    setSelected(['', '']);
    setTouched(false);
  }
  const options = board.pins.map((p) => <option key={p.id} value={p.id}>{p.label}</option>);
  return <form className="os-paper os-stack" onSubmit={submit} aria-label="Draw a link">
    <h3>Draw a link</h3>
    <p className="os-muted">Select two pins on the board (tap or click, or Enter on a focused pin), or choose them here. Then say how they are tied.</p>
    <div className="os-controls">
      <label className="os-grow">From<select value={a} onChange={(e) => setSelected([e.target.value, b])}><option value="">Choose a pin</option>{options}</select></label>
      <label>Relation<select value={rel} onChange={(e) => { setRel(e.target.value); setTouched(true); }}>
        {board.relations.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
      </select></label>
      <label className="os-grow">To<select value={b} onChange={(e) => setSelected([a, e.target.value])}><option value="">Choose a pin</option>{options}</select></label>
      <button type="submit" disabled={!ready}>Add link</button>
    </div>
    <p className="os-muted" aria-live="polite">{problem ?? board.relations.find((r) => r.id === rel)?.help}</p>
  </form>;
}

function Links({ board, dispatch, readOnly }) {
  return <section className="os-paper os-stack" aria-labelledby="os-links-title">
    <h3 id="os-links-title">Links ({board.links.length}/{board.limits.links})</h3>
    {board.links.length === 0 ? <p className="os-muted">No links yet.</p>
      : <ul className="os-plain os-link-list">{board.links.map((l) => <li key={`${l.rel}|${l.a}|${l.b}`}>
        <span>{describeLink(board, l)}</span>
        {!readOnly && <button type="button" className="secondary small" onClick={() => dispatch({ type: 'unlink', link: l })}>Remove<span className="os-sr"> link: {describeLink(board, l)}</span></button>}
      </li>)}</ul>}
  </section>;
}

function Picker({ board, dispatch }) {
  const desk = useDesk();
  const [source, setSource] = useState('cast');
  const [text, setText] = useState('');
  const [applied, setApplied] = useState({ source: 'cast', q: '' });
  const [state, setState] = useState({ items: [], total: 0, loading: true, error: '' });
  const abort = useRef(null);

  async function load(offset, replace) {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const page = await listEvidence(desk.track, { source: applied.source, q: applied.q, offset, limit: 20 }, { signal: controller.signal });
      setState((s) => ({ items: replace ? page.items : [...s.items, ...page.items], total: page.total, loading: false, error: '' }));
    } catch (error) {
      if (error?.name !== 'AbortError') { setState((s) => ({ ...s, loading: false, error: describeOsintError(error) })); }
    }
  }
  useEffect(() => {
    void load(0, true);
    return () => abort.current?.abort();
    // Reload when the applied filter or the case changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applied, desk.track]);

  const pinned = new Set(board.pins.map((p) => p.id));
  const full = board.pins.length >= board.limits.pins;
  return <section className="os-paper os-stack" aria-labelledby="os-picker-title">
    <h3 id="os-picker-title">Add evidence</h3>
    <form className="os-controls" onSubmit={(e) => { e.preventDefault(); setApplied({ source, q: text.trim() }); }}>
      <label>Kind<select value={source} onChange={(e) => { setSource(e.target.value); setApplied({ source: e.target.value, q: text.trim() }); }}>
        {KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
      </select></label>
      <label className="os-grow">Filter<input type="search" value={text} maxLength={64} onChange={(e) => setText(e.target.value)} placeholder="a name, a handle, a street..." autoComplete="off" /></label>
      <button type="submit" className="secondary">Filter</button>
    </form>
    <div aria-live="polite">
      {state.error && <p role="alert" className="error">{state.error}</p>}
      {full && <p className="os-muted">The board is full ({board.limits.pins} pins). Remove one to add another.</p>}
    </div>
    <ul className="os-plain os-evidence-list" aria-label="Evidence you can pin">
      {state.items.map((item) => <li key={item.id}>
        <span>{item.label}</span>
        <button
          type="button" className="secondary small" disabled={pinned.has(item.id) || full}
          onClick={() => dispatch({ type: 'pin', pin: { ...item, ...nextPinPosition(board.pins) } })}
        >{pinned.has(item.id) ? 'Pinned' : 'Pin'}<span className="os-sr"> {item.label}</span></button>
      </li>)}
    </ul>
    {!state.loading && state.items.length === 0 && !state.error && <p className="os-muted">Nothing matches.</p>}
    {state.items.length < state.total && <button type="button" className="secondary" disabled={state.loading} onClick={() => load(state.items.length, false)}>
      {state.loading ? 'Loading...' : `Load more (${state.items.length} of ${state.total})`}
    </button>}
  </section>;
}

const STATUS_TEXT = { loading: 'Loading the board...', saving: 'Saving...', saved: 'Saved. Your team sees it.', idle: '', merged: '', error: '' };

// The red-string pinboard: the team's shared case theory, saved on the server and checked against the hidden chain.
export default function BoardTab() {
  const desk = useDesk();
  const { board, status, dispatch, reload, pending, check, checked, checkError } = useBoard(desk.track, { onUnlocked: desk.refresh });
  const [selected, setSelected] = useState(['', '']);
  useEffect(() => { setSelected(['', '']); }, [desk.track]);

  if (!board) {
    return status.kind === 'error'
      ? <p role="alert" className="error">{status.message} <button type="button" className="secondary small" onClick={reload}>Retry</button></p>
      : <p role="status" className="os-muted">{STATUS_TEXT.loading}</p>;
  }
  const readOnly = board.readOnly;
  function select(id, clear = false) {
    setSelected(([a, b]) => {
      if (clear) { return [a === id ? '' : a, b === id ? '' : b]; }
      if (a === id) { return ['', b]; }
      if (b === id) { return [a, '']; }
      if (!a) { return [id, b]; }
      if (!b) { return [a, id]; }
      return [b, id];
    });
  }
  const text = status.message || STATUS_TEXT[status.kind] || (pending > 0 ? 'Unsaved changes...' : '');
  return <div className="os-stack">
    <Meter board={board} check={check} checked={checked} checkError={checkError} pending={pending} />
    {readOnly && <p className="os-note">Preview only: this is the board of the preview world. Only players in a team can pin and link.</p>}
    <p className={`os-muted os-board-status${status.kind === 'error' ? ' error' : ''}`} role="status" aria-live="polite">{text}{status.kind === 'error' && <> <button type="button" className="secondary small" onClick={reload}>Reload board</button></>}</p>
    <Canvas board={board} selected={selected} onSelect={select} dispatch={dispatch} readOnly={readOnly} />
    {!readOnly && <Connect board={board} selected={selected} setSelected={setSelected} dispatch={dispatch} />}
    <Links board={board} dispatch={dispatch} readOnly={readOnly} />
    {!readOnly && <Picker board={board} dispatch={dispatch} />}
  </div>;
}
