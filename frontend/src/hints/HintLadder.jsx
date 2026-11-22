import { useEffect, useId, useRef, useState } from 'react';
import { costLine } from './config.js';
import { announcement, buildLadder, usedLabel } from './helpers.js';
import './hints.css';

// The one hint panel of every play screen. It only draws what the page already knows (the opened texts and the public
// total); `onOpen` does the category's own work (call the API, or just remember the open) and may throw.
export default function HintLadder({
  category, hints, total, allowed = true, preview = false, canOpen = true, onOpen, describeError, title = 'Hints', previewNote = '',
}) {
  const ladder = buildLadder({ total, shown: hints, allowed, preview, canOpen, category });
  const id = useId();
  const root = useRef(null);
  const openButton = useRef(null);
  const focusPosition = useRef(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [live, setLive] = useState('');

  const latest = useRef(ladder);
  useEffect(() => { latest.current = ladder; });
  const used = ladder.used;
  useEffect(() => {
    const position = focusPosition.current;
    if (position > 0 && used >= position) {
      focusPosition.current = 0;
      root.current?.querySelector(`[data-position="${position}"]`)?.focus();
      setLive(announcement(latest.current, position));
    }
  }, [used]);

  if (ladder.kind === 'none') {
    return <div className="hl" data-category={category}>
      {title && <p className="hl-head"><strong id={`${id}-t`}>{title}</strong></p>}
      <p className="hl-none">{ladder.message}</p>
    </div>;
  }

  async function open() {
    if (busy || !ladder.next) { return; }
    setBusy(true);
    setError('');
    setConfirming(false);
    try {
      focusPosition.current = ladder.next.position;
      await onOpen();
    } catch (err) {
      focusPosition.current = 0;
      setError(describeError ? describeError(err) : 'Could not open that hint. Try again.');
    } finally { setBusy(false); }
  }
  function ask() {
    if (!ladder.next) { return; }
    if (ladder.next.confirm) { setConfirming(true); return; }
    open();
  }
  function cancel() {
    setConfirming(false);
    queueMicrotask(() => openButton.current?.focus());
  }

  const cost = costLine(category);
  return <div className="hl" data-category={category} ref={root}>
    <p className="hl-head">
      {title && <strong id={`${id}-t`}>{title}</strong>}
      <span className="hl-used">{ladder.preview ? 'Admin preview' : usedLabel(ladder.used)}</span>
    </p>
    <p className="hl-cost">{cost}</p>
    {ladder.preview && <p className="hl-note">{previewNote || 'Admin preview: nothing is logged.'}</p>}
    <ol className="hl-tiers" aria-label="Hint tiers">
      {ladder.tiers.map((tier) => <li key={tier.position} className={`hl-tier is-${tier.state}`} data-position={tier.position} tabIndex={tier.state === 'open' ? -1 : undefined}>
        <span className="hl-tier-name">Hint {tier.position} of {ladder.total}: {tier.label}</span>
        {tier.text !== null ? <span className="hl-text">{tier.text}</span> : <span className="hl-locked">{tier.state === 'next' ? 'Ready to open' : 'Locked'}</span>}
      </li>)}
    </ol>
    {error && <p role="alert" className="error">{error}</p>}
    {ladder.next && !confirming && <button type="button" className="secondary hl-button" ref={openButton} onClick={ask} disabled={busy} aria-describedby={`${id}-c`}>
      {busy ? 'Opening...' : `${ladder.next.button} (${ladder.next.label})`}
    </button>}
    {ladder.next && confirming && <div className="hl-confirm" role="group" aria-label="Confirm opening the last hint">
      <p>{ladder.next.label} nearly gives the answer away. {cost}. Open it?</p>
      <div className="hl-actions">
        <button type="button" className="hl-button" onClick={open} disabled={busy} autoFocus>Yes, open hint {ladder.next.position} of {ladder.total}</button>
        <button type="button" className="secondary hl-button" onClick={cancel}>Not yet</button>
      </div>
    </div>}
    {!ladder.next && !ladder.preview && ladder.used === ladder.total && <p className="hl-done">That was every hint.</p>}
    <span id={`${id}-c`} hidden>{cost}</span>
    <p className="hl-live" role="status" aria-live="polite">{live}</p>
  </div>;
}

// "Hints used: N" for a level result, from the opened hints the page already holds.
export function HintsUsed({ count }) {
  return <p className="hl-result">{usedLabel(count)}</p>;
}
