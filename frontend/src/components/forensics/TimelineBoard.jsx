import { useState } from 'react';
import Info from '../Info.jsx';
import { MAX_PINS, clockOf, pinLabel, pinSummary, pinTime } from '../../forensics/timeline.js';

const HUNTER_NOTE = 'Cosmetic: you spotted two pieces of evidence that cannot both be true.';

// Vertical timeline of the lines and packets the player pinned. Newest-first is never assumed: the board is sorted by
// timestamp until the player moves something by hand. Drag an item (mouse) or use the Up/Down buttons (touch and keyboard).
export default function TimelineBoard({ timeline }) {
  const { state, findings } = timeline;
  const [dragging, setDragging] = useState(null);
  const conflictsOf = (id) => findings.filter((f) => f.a === id || f.b === id);
  const jump = (id) => {
    const node = document.getElementById(`fx-tl-${id}`);
    if (node) { node.scrollIntoView?.({ block: 'center' }); node.focus(); }
  };
  const label = (id) => { const pin = state.pins.find((p) => p.id === id); return pin ? pinLabel(pin) : id; };

  return <section className="fx-board fx-timeline" aria-labelledby="fx-timeline-title">
    <div className="fx-tl-head">
      <h2 id="fx-timeline-title">Timeline board</h2>
      {state.hunter && <><span className="fx-badge fx-badge-hunter" title={HUNTER_NOTE}>Contradiction hunter</span><Info label="the Contradiction hunter badge">{HUNTER_NOTE}</Info></>}
    </div>
    <p className="fx-muted">
      Select a log line or packet in the viewer and press Pin. The board sorts the evidence by time and warns you when two pinned
      items cannot both be true. It only looks at what you pinned. Kept in this browser; {state.pins.length}/{MAX_PINS} pinned.
    </p>
    <div className="fx-row-buttons">
      <button type="button" className="secondary small" onClick={timeline.sort} disabled={!state.manual}>Sort by time</button>
      <button type="button" className="secondary small" onClick={timeline.clear} disabled={state.pins.length === 0}>Clear board</button>
      {state.manual && <span className="fx-muted">Showing your own order.</span>}
    </div>
    <div role="status" aria-live="polite" className="fx-tl-findings">
      {findings.length === 0 ? <p className="fx-muted">No contradiction between the pinned items so far.</p>
        : <>
          <h3>Contradiction found ({findings.length})</h3>
          <ul>{findings.map((f) => <li key={f.id} className="fx-tl-finding">
            <span>{f.message}</span>{' '}
            <button type="button" className="secondary small" onClick={() => jump(f.a)}>Show {label(f.a)}</button>{' '}
            <button type="button" className="secondary small" onClick={() => jump(f.b)}>Show {label(f.b)}</button>
          </li>)}</ul>
        </>}
    </div>
    {state.pins.length === 0 ? <p className="fx-empty-note">Nothing pinned yet.</p>
      : <><p className="fx-muted fx-tl-tip">Tip: use the Up and Down buttons on each item to reorder it. Dragging an item also works where your browser supports it.</p>
      <ol className="fx-tl" aria-label="Pinned evidence in order">
        {state.pins.map((pin, index) => {
          const time = pinTime(pin);
          const conflicts = conflictsOf(pin.id);
          return <li
            key={pin.id} id={`fx-tl-${pin.id}`} tabIndex={-1}
            className={`fx-tl-item${conflicts.length ? ' is-conflict' : ''}${dragging === pin.id ? ' is-dragging' : ''}`}
            draggable onDragStart={(event) => { setDragging(pin.id); event.dataTransfer?.setData('text/plain', pin.id); }}
            onDragEnd={() => setDragging(null)}
            onDragOver={(event) => { if (dragging) { event.preventDefault(); } }}
            onDrop={(event) => { event.preventDefault(); if (dragging) { timeline.drop(dragging, pin.id); } setDragging(null); }}
          >
            <span className="fx-tl-dot" aria-hidden="true" />
            <div className="fx-tl-body">
              <p className="fx-tl-meta"><strong>{time === null ? 'no time' : `${clockOf(time)} UTC`}</strong> · {pinLabel(pin)}</p>
              <p className="fx-tl-text">{pinSummary(pin)}</p>
              {conflicts.map((f) => {
                const other = f.a === pin.id ? f.b : f.a;
                return <p key={f.id} className="fx-tl-flag">
                  <span aria-hidden="true">{'⚠ '}</span>Contradiction found with{' '}
                  <button type="button" className="fx-linklike" onClick={() => jump(other)}>{label(other)}</button>
                </p>;
              })}
              <div className="fx-row-buttons">
                <button type="button" className="secondary small" aria-label={`Move ${pinLabel(pin)} up`} disabled={index === 0} onClick={() => timeline.move(pin.id, -1)}>Up</button>
                <button type="button" className="secondary small" aria-label={`Move ${pinLabel(pin)} down`} disabled={index === state.pins.length - 1} onClick={() => timeline.move(pin.id, 1)}>Down</button>
                <button type="button" className="secondary small" aria-label={`Unpin ${pinLabel(pin)}`} onClick={() => timeline.unpin(pin.id)}>Unpin</button>
              </div>
            </div>
          </li>;
        })}
      </ol></>}
  </section>;
}
