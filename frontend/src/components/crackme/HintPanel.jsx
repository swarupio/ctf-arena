import { openHint } from '../../api/crackme.js';
import HintLadder from '../../hints/HintLadder.jsx';
import { crackmeErrorMessage } from './helpers.js';

// Opening a hint is logged for the admin by the server. Insane cabinets have none. Admins cannot open hints.
export default function HintPanel({ puzzle, onOpened, disabled }) {
  return <section className="cm-box" aria-labelledby="cm-hints-title">
    <h2 id="cm-hints-title">Hints</h2>
    <HintLadder
      category="crackme" title="" hints={puzzle.hints} total={puzzle.hintsTotal} allowed={puzzle.hintsAllowed}
      canOpen={!disabled} previewNote="Admin preview: only players can open hints."
      preview={disabled && puzzle.hints.length === 0}
      pricing={puzzle.hintPricing} spent={puzzle.hintSpent} base={puzzle.points} priced={!disabled}
      onOpen={async () => { const answer = await openHint(puzzle.id); await onOpened(); return answer; }} describeError={crackmeErrorMessage}
    />
  </section>;
}
