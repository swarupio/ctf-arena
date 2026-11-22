import { hintBarView } from './hintBar.js';

/**
 * Toolbar row under the log: Hints / Next hint buttons and a compact status line. The buttons call `onRun` with the exact
 * command a player could type, so the server's pacing, logging and fair-play signals see an ordinary command.
 */
export default function HintBar({ state, mode, isAdmin, busy, onRun }) {
  const view = hintBarView(state, { mode, isAdmin });
  if (!view.visible) { return null; }
  return <div className="tm-hintbar" role="group" aria-label="Hints">
    <button type="button" className="tm-chip tm-hint-btn" disabled={busy} onClick={() => onRun(view.firstCommand)} aria-label={view.nextCommand ? 'Hints: show the first hint for your next code' : 'Hints: show a hint for your next code'}>Hints</button>
    {view.nextCommand && <button type="button" className="tm-chip tm-hint-btn" disabled={busy} onClick={() => onRun(view.nextCommand)} aria-label={`Next hint: run ${view.nextCommand}`}>Next hint</button>}
    <span className="tm-hint-info">
      {view.tierText && <span>{view.tierText}</span>}
      {view.usedText && <span>{view.usedText}</span>}
      <span>{view.costText}</span>
    </span>
  </div>;
}
