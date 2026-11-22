import { useEffect, useId, useRef, useState } from 'react';
import { announcement, buildLadder, confirmText, usedLabel } from './helpers.js';
import { useHintCosts } from './hooks.js';
import { deductionText, mergeSpent, pricingCovers } from './pricing.js';
import './hints.css';

// The one hint panel of every play screen. It only draws what the page already knows (the opened texts, the public total
// and the server's prices); `onOpen` does the category's own work (call the API, or just remember the open), may throw,
// and may return the server's hint-open answer so the panel can show what was spent without reloading the level.
//   pricing: the level view's `hintPricing`; spent: its `hintSpent`; base: the level's points.
//   priced: false (admins) hides every price and confirmation, whatever the server sent.
//   cumulative: the server prices each closed hint as what opening it first would add (Web Lab); this in-order ladder shows the
//   step each later hint will cost once the ones before it are open.
export default function HintLadder({
  category, hints, total, allowed = true, preview = false, canOpen = true, onOpen, describeError, title = 'Hints', previewNote = '',
  pricing, spent, base, priced = true, cumulative = false,
}) {
  const used = Array.isArray(hints) ? hints.length : 0;
  const count = Number.isInteger(total) && total > 0 ? total : 0;
  const showPrices = priced && !preview && canOpen && allowed && count > 0;
  const needFallback = showPrices && used < count && !pricingCovers(pricing, used, count);
  const platform = useHintCosts(needFallback);
  const [liveSpent, setLiveSpent] = useState(null);
  const ladder = buildLadder({
    total, shown: hints, allowed, preview, canOpen, priced, pricing, base, cumulative, costs: needFallback ? platform.costs : null,
    spent: mergeSpent(spent, liveSpent), pending: needFallback && !platform.costs && !platform.failed, unavailable: needFallback && platform.failed,
  });
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
  const openedCount = ladder.used;
  useEffect(() => {
    const position = focusPosition.current;
    if (position > 0 && openedCount >= position) {
      focusPosition.current = 0;
      root.current?.querySelector(`[data-position="${position}"]`)?.focus();
      setLive(announcement(latest.current, position));
    }
  }, [openedCount]);

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
      const answer = await onOpen();
      if (priced && answer?.spent) { setLiveSpent((current) => mergeSpent(current, answer.spent)); }
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

  const next = ladder.next;
  return <div className="hl" data-category={category} ref={root}>
    <p className="hl-head">
      {title && <strong id={`${id}-t`}>{title}</strong>}
      <span className="hl-used">{ladder.preview ? 'Admin preview' : usedLabel(ladder.used)}</span>
    </p>
    {ladder.costLine && <p className="hl-cost" aria-live="polite">{ladder.costLine}</p>}
    {ladder.preview && <p className="hl-note">{previewNote || 'Admin preview: nothing is logged.'}</p>}
    <ol className="hl-tiers" aria-label="Hint tiers">
      {ladder.tiers.map((tier) => <li key={tier.position} className={`hl-tier is-${tier.state}`} data-position={tier.position} tabIndex={tier.state === 'open' ? -1 : undefined}>
        <span className="hl-tier-name">Hint {tier.position} of {ladder.total}: {tier.label}</span>
        {tier.text !== null
          ? <span className="hl-text">{tier.text}</span>
          : <span className="hl-locked">{tier.state === 'next' ? 'Ready to open' : 'Locked'}{tier.priceText && <> &middot; <span className="hl-price">{tier.priceText}</span></>}</span>}
      </li>)}
    </ol>
    {error && <p role="alert" className="error">{error}</p>}
    {next && !confirming && <button type="button" className="secondary hl-button" ref={openButton} onClick={ask} disabled={busy}>
      {busy ? 'Opening...' : `${next.button} (${next.label})${next.priceText ? `: ${next.priceText}` : ''}`}
    </button>}
    {next && confirming && <div className="hl-confirm" role="group" aria-label={`Confirm opening hint ${next.position} of ${ladder.total}`} onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); cancel(); } }}>
      <p>{confirmText(next)}</p>
      <div className="hl-actions">
        <button type="button" className="hl-button" onClick={open} disabled={busy} autoFocus>Yes, open hint {next.position} of {ladder.total}</button>
        <button type="button" className="secondary hl-button" onClick={cancel}>Not yet</button>
      </div>
    </div>}
    {!next && !ladder.preview && ladder.used === ladder.total && <p className="hl-done">That was every hint.</p>}
    <p className="hl-live" role="status" aria-live="polite">{live}</p>
  </div>;
}

// "Hints used: N" for a level result, from the opened hints the page already holds.
export function HintsUsed({ count }) {
  return <p className="hl-result">{usedLabel(count)}</p>;
}

// 'Captured: 100 pts, minus 17 for hints = 83', only when the server reports that hints cost something.
export function HintDeduction({ result }) {
  const text = deductionText(result);
  return text ? <p className="hl-result hl-deduction">{text}</p> : null;
}
