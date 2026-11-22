import { useState } from 'react';
import { useThrottledValue } from '../../a11y/timed.js';
import { keyshortcutsAttr } from './shortcuts.js';
import { MAX_WATCH, decisionText, diffLines, parseWatchAddress, watchLabel, watchRows } from './timeline.js';

// Scrubber over the executed trace: Step back / Step forward and a slider from step 0 to the furthest step reached.
export function Scrubber({
  view, furthest, onSeek, onBack, onForward, forwardDisabled, replaying, shortcuts = true,
}) {
  // One short announcement at most every 500 ms; the full line below is visible text, not a live region.
  const announced = useThrottledValue(`Step ${view.steps} of ${furthest}`, 500);
  const text = `Step ${view.steps} of ${furthest}${view.status === 'running' ? '' : ', stopped'}, PC ${String(view.pc).padStart(3, '0')}`;
  return <div className="cm-scrub">
    <button type="button" className="secondary" onClick={onBack} disabled={view.steps === 0} aria-keyshortcuts={keyshortcutsAttr(shortcuts, 'B')}>
      Step back {shortcuts && <kbd aria-hidden="true">B</kbd>}
    </button>
    <label className="cm-scrub-range">
      <span className="cm-sr">Scrub through the executed steps</span>
      <input
        type="range"
        min={0}
        max={furthest}
        step={1}
        value={view.steps}
        onChange={(event) => onSeek(Number(event.target.value))}
        aria-valuetext={text}
        disabled={furthest === 0}
      />
    </label>
    <button type="button" className="secondary" onClick={onForward} disabled={forwardDisabled} aria-keyshortcuts={keyshortcutsAttr(shortcuts, 'S')}>
      Step forward {shortcuts && <kbd aria-hidden="true">S</kbd>}
    </button>
    <p className="cm-scrub-text">{text}{replaying ? ' (replaying the past: Run continues from the end)' : ''}</p>
    <span className="cm-sr" role="status">{announced}</span>
  </div>;
}

// "What changed" since the previous step, and the compare/branch that decided the result once the program has stopped.
export function ChangesPanel({ diff, running, decision, onShowDecision }) {
  return <section className="cm-panel" aria-labelledby="cm-diff-title">
    <h3 id="cm-diff-title">What changed</h3>
    {running
      ? <p className="cm-note">Pause the run to see what each step changed.</p>
      : <>
        {diff && <p className="cm-note">Step {diff.step}: <code>{diff.text}</code> at {String(diff.address).padStart(3, '0')}</p>}
        <ul className="cm-diff" aria-label="Changes made by this step">
          {diffLines(diff).map((line, position) => <li key={`${position}-${line}`}>{line}</li>)}
        </ul>
      </>}
    {decision && <div className="cm-decision" role="note" aria-label="What decided the result">
      <p><strong>What decided it.</strong> {decisionText(decision)}</p>
      {decision.branch && <button type="button" className="secondary small" onClick={onShowDecision}>Go to that step</button>}
    </div>}
  </section>;
}

// Pin memory cells: their value now and one step ago, flagged in words when this step changed them.
export function WatchPanel({
  list, before, after, vm, programLength, onAdd, onRemove, shortcuts = true,
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const rows = watchRows(before, after, list);

  function submit(event) {
    event.preventDefault();
    const parsed = parseWatchAddress(text, vm, programLength);
    if (parsed.error) { setError(parsed.error); return; }
    if (!list.includes(parsed.address) && list.length >= MAX_WATCH) { setError(`You can pin at most ${MAX_WATCH} cells.`); return; }
    setError('');
    setText('');
    onAdd(parsed.address);
  }

  return <section className="cm-panel" aria-labelledby="cm-watch-title">
    <h3 id="cm-watch-title">Watch cells <span className="cm-dim">({list.length} / {MAX_WATCH})</span></h3>
    <form className="cm-watch-form" onSubmit={submit} noValidate>
      <label>
        Cell address
        <input
          id="cm-watch-input"
          value={text}
          onChange={(event) => setText(event.target.value)}
          inputMode="numeric"
          autoComplete="off"
          maxLength={4}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby="cm-watch-help"
          aria-keyshortcuts={keyshortcutsAttr(shortcuts, 'W')}
        />
      </label>
      <button type="submit" className="secondary">Pin</button>
    </form>
    <p id="cm-watch-help" className="cm-note">{shortcuts ? 'Press W to focus this box, or tap a memory cell below.' : 'Tap a memory cell below to pin it.'} Code cells are {vm.codeBase} plus the instruction number.</p>
    {error && <p role="alert" className="error">{error}</p>}
    {rows.length === 0
      ? <p className="cm-note">Nothing pinned.</p>
      : <ul className="cm-watch" aria-label="Pinned cells">
        {rows.map((row) => <li key={row.address} className={row.changed ? 'is-changed' : undefined}>
          <span>{watchLabel(row.address, vm.codeBase)}</span>
          <strong>{row.value === null ? 'n/a' : row.value}</strong>
          <span className="cm-dim">{row.changed ? `changed, was ${row.previous}` : 'unchanged'}</span>
          <button type="button" className="secondary small" onClick={() => onRemove(row.address)} aria-label={`Unpin ${watchLabel(row.address, vm.codeBase)}`}>Unpin</button>
        </li>)}
      </ul>}
  </section>;
}
