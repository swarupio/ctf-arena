import { openHint } from '../../api/cipherlab.js';
import HintLadder from '../../hints/HintLadder.jsx';
import { cipherErrorMessage } from './helpers.js';

// Opening a hint is logged for the admin by the server. Insane levels have none. Admins preview every hint and log nothing.
export default function HintPanel({ puzzle, onOpened, isAdmin = false }) {
  return <section className="cl-box" aria-labelledby="cl-hints-title">
    <h2 id="cl-hints-title">Hints</h2>
    <HintLadder
      category="cipherlab" title="" hints={puzzle.hints} total={puzzle.hintsTotal} allowed={puzzle.hintsAllowed}
      preview={isAdmin} previewNote="Admin preview: every hint is shown and nothing is logged."
      pricing={puzzle.hintPricing} spent={puzzle.hintSpent} base={puzzle.points} priced={!isAdmin}
      onOpen={async () => { const answer = await openHint(puzzle.id); await onOpened(); return answer; }} describeError={cipherErrorMessage}
    />
  </section>;
}
