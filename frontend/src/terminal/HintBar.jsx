import { useEffect, useRef, useState } from 'react';
import { useHintCosts } from '../hints/hooks.js';
import { hintBarView } from './hintBar.js';

/**
 * Toolbar row under the log: Hints / Next hint buttons and a compact status line. The buttons call `onRun` with the exact
 * command a player could type, so the server's pacing, logging and fair-play signals see an ordinary command. A hint that
 * costs points first asks for an inline confirmation (the typed command does not: the server charges at solve time).
 */
export default function HintBar({ state, mode, isAdmin, busy, onRun, info = null }) {
  const wantCosts = !isAdmin && !info;
  const platform = useHintCosts(wantCosts);
  const view = hintBarView(state, { mode, isAdmin, info, costs: platform.costs });
  const [pending, setPending] = useState(null);
  const group = useRef(null);
  const askAgain = useRef(null);
  useEffect(() => { if (pending) { group.current?.querySelector('button')?.focus(); } }, [pending]);
  if (!view.visible) { return null; }

  function press(command, confirm, priceTextValue, which) {
    if (confirm) { setPending({ command, priceText: priceTextValue, which }); return; }
    onRun(command);
  }
  function close(focusBack) {
    const which = pending?.which;
    setPending(null);
    if (focusBack) { queueMicrotask(() => askAgain.current?.querySelector(`[data-which="${which}"]`)?.focus()); }
  }
  function confirm() {
    const command = pending?.command;
    close(true);
    if (command) { onRun(command); }
  }

  return <div className="tm-hintbar" role="group" aria-label="Hints" ref={askAgain}>
    {pending ? <div className="tm-hint-confirm" role="group" aria-label="Confirm opening a hint" ref={group} onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); close(true); } }}>
      <span>This hint {pending.priceText.replace(/^Costs/, 'costs')}, taken from the code's points when you capture it. Open it?</span>
      <button type="button" className="tm-chip tm-hint-btn" disabled={busy} onClick={confirm}>Yes, open it</button>
      <button type="button" className="tm-chip tm-hint-btn" onClick={() => close(true)}>Not yet</button>
    </div> : <>
      <button type="button" className="tm-chip tm-hint-btn" data-which="first" disabled={busy} onClick={() => press(view.firstCommand, view.firstConfirm, view.firstPriceText, 'first')} aria-label={view.nextCommand ? 'Hints: show the first hint for your next code' : 'Hints: show a hint for your next code'}>Hints</button>
      {view.nextCommand && <button type="button" className="tm-chip tm-hint-btn" data-which="next" disabled={busy} onClick={() => press(view.nextCommand, view.nextConfirm, view.nextPriceText, 'next')} aria-label={`Next hint: run ${view.nextCommand}`}>Next hint</button>}
    </>}
    <span className="tm-hint-info">
      {view.tierText && <span>{view.tierText}</span>}
      {view.usedText && <span>{view.usedText}</span>}
      {view.costText && <span aria-live="polite">{view.costText}</span>}
    </span>
  </div>;
}
