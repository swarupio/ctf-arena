import { useState } from 'react';
import { submitPatch } from '../../api/crackme.js';
import { crackmeErrorMessage } from './helpers.js';
import { editOf, editsLabel, patchableRows, withEdit } from './patchEditor.js';

// Bonus mode of the hard and insane cabinets. The player rewrites a few branch/compare instructions of THEIR team's program;
// the server applies the same edits to its own copy and runs it on hidden inputs. Only counts come back; a valid patch earns a
// cosmetic badge (no points).
export default function PatchBay({
  puzzle, edits, onEdits, debugPatched, onDebugPatched, canSubmit, onDone,
}) {
  const bay = puzzle.patchBay;
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  // A result belongs to the edit set that produced it: any change of the edits clears it.
  const changeEdits = (next) => { onEdits(next); setResult(null); setError(''); };
  const rows = patchableRows(puzzle.program);
  const full = edits.length >= bay.maxEdits;

  async function submit(event) {
    event.preventDefault();
    if (!canSubmit || busy || edits.length === 0) { return; }
    setBusy(true);
    setError('');
    try {
      const response = await submitPatch(puzzle.id, edits);
      setResult(response);
      if (response.valid) { await onDone?.(); }
    } catch (err) {
      setError(crackmeErrorMessage(err));
    } finally { setBusy(false); }
  }

  return <section className="cm-box cm-patch" aria-labelledby="cm-patch-title">
    <h2 id="cm-patch-title">Patch Bay <span className="cm-dim">bonus, no points</span></h2>
    {bay.done && <p role="status" className="cm-badge-line"><span className="tag tag-badge">Patch badge earned</span> Your team already beat this Patch Bay. You can still experiment.</p>}
    <p className="cm-rule"><strong>The rule:</strong> change at most {bay.maxEdits} instructions so that the cabinet accepts <strong>every one of {bay.tests} hidden test inputs</strong> and
      still accepts your team&apos;s real serial. Those inputs are different for every team and you only ever learn how many pass.</p>
    <ul className="cm-note cm-patch-rules">
      <li>Allowed changes: <code>JNZ</code> to <code>JZ</code> or <code>POP</code>, <code>JZ</code> to <code>JNZ</code> or <code>POP</code>, <code>CMP</code> to <code>SUB</code> or <code>XOR</code>. A branch turned into <code>POP</code> never jumps.</li>
      <li>The server runs your patch with no debugger attached, at most {bay.steps.toLocaleString('en-US')} steps per input.</li>
      <li>Only the opcode changes: a flipped branch keeps its jump target. Opcodes are never encrypted, so the instruction you pick in the listing is the one you patch.</li>
    </ul>
    <label className="cm-check">
      <input type="checkbox" checked={debugPatched} onChange={(event) => onDebugPatched(event.target.checked)} disabled={edits.length === 0} />
      Show my patched program in the debugger
    </label>
    <p className="cm-note" role="status">{editsLabel(edits.length, bay.maxEdits)}{full ? ' (limit reached)' : ''}</p>
    <form onSubmit={submit} noValidate>
      <div className="cm-patch-list" role="group" aria-label="Patchable instructions">
        {rows.map((row) => {
          const current = editOf(edits, row.index);
          const id = `cm-patch-${row.index}`;
          return <div key={row.index} className={`cm-patch-row${current ? ' is-edited' : ''}`}>
            <label htmlFor={id}>
              <span className="cm-addr">{String(row.index).padStart(3, '0')}</span>{' '}
              <span className="cm-op">{row.op}</span> <span className="cm-arg">{row.operand}</span>
            </label>
            <select
              id={id}
              value={current}
              onChange={(event) => changeEdits(withEdit(edits, row.index, event.target.value, bay.maxEdits))}
              disabled={full && !current}
              aria-label={`Instruction ${row.index}, ${row.op}${row.operand ? ` ${row.operand}` : ''}: replace with`}
            >
              <option value="">keep {row.op}</option>
              {row.options.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </div>;
        })}
      </div>
      {!canSubmit && <p className="notice">Admins can preview the Patch Bay but cannot submit.</p>}
      <div className="cm-buttons">
        <button type="submit" disabled={!canSubmit || busy || edits.length === 0}>{busy ? 'Testing...' : 'Submit patch'}</button>
        <button type="button" className="secondary" onClick={() => changeEdits([])} disabled={edits.length === 0}>Clear edits</button>
      </div>
    </form>
    {error && <p role="alert" className="error">{error}</p>}
    {result && <p role="status" className={result.valid ? 'cm-win cm-patch-ok' : 'cm-wrong'}>
      {result.message} ({result.passed} of {result.total} test inputs pass; real serial {result.serialOk ? 'still accepted' : 'rejected'}.)
      {result.badge && <> <span className="tag tag-badge">Patch badge earned</span></>}
    </p>}
  </section>;
}
