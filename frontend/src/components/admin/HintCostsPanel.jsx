import { useEffect, useState } from 'react';
import { saveSettings } from '../../api/admin.js';
import { useAct } from '../../admin/hooks.js';
import { stableKey } from '../../admin/draftSync.js';
import {
  FREE_HINTS, HINT_COST_DEFAULTS, HINT_COST_LABELS, costsBody, costsDirty, costsToDraft, isFreeDraft, presetDraft, previewRows,
  validateCostsDraft,
} from '../../admin/hintCostsForm.js';
import ConfirmDialog from './ConfirmDialog.jsx';
import { Badge, Panel } from './PageHeader.jsx';

const dash = (value) => (value === null ? '–' : value);

// Hint costs: what opening a hint deducts from a level, as a percentage of its base points. Its own form with its own
// buttons (the whole object is replaced at once); it only resets its draft when the saved costs change, so saving
// another panel never wipes unsaved edits here.
export default function HintCostsPanel({ saved, onSaved }) {
  const act = useAct();
  const [draft, setDraft] = useState(() => costsToDraft(saved));
  const [confirm, setConfirm] = useState(false);
  const savedKey = stableKey(saved ?? null);
  useEffect(() => { setDraft(costsToDraft(saved)); }, [savedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const errors = validateCostsDraft(draft);
  const invalid = Object.keys(errors).length > 0;
  const dirty = costsDirty(saved, draft);
  const free = !invalid && isFreeDraft(draft);
  const set = (field) => (event) => setDraft({ ...draft, [field]: event.target.value });

  const save = () => act.run('hintcosts', () => saveSettings(costsBody(draft)), { success: 'Hint costs saved.', after: onSaved }).then(() => setConfirm(false));
  function submit(event) {
    event.preventDefault();
    if (invalid || !dirty) return;
    setConfirm(true);
  }

  return <>
    <form className="adm-form" onSubmit={submit} noValidate>
      <Panel title="Hint costs" id="settings-hints">
        <p><Badge tone={draft.enabled && !free ? 'ok' : ''}>{!draft.enabled ? 'off' : free ? 'free' : 'on'}</Badge> {!draft.enabled ? 'Hints are free.' : free ? 'Every percentage is 0, so hints are free.' : 'Opening a hint deducts points when the team solves the level.'}</p>
        <p className="adm-muted">
          The cost of a hint is a percentage of the level&apos;s base points, by its position among the level&apos;s hints. The total for one level
          never goes above the cap, and a solve always awards at least 1 point. The deduction is taken when the level is solved; level points
          and the documented totals do not change. Admins never pay and nothing is recorded for them.
        </p>
        <label className="adm-check">
          <input type="checkbox" role="switch" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} /> Hints cost points
        </label>
        {Object.keys(HINT_COST_LABELS).map((field) => (
          <label key={field}>{HINT_COST_LABELS[field]}, % of the level&apos;s points
            <input type="number" inputMode="numeric" min={0} max={100} step={1} value={draft[field]} onChange={set(field)}
              aria-invalid={Boolean(errors[field])} aria-describedby={errors[field] ? `hint-err-${field}` : undefined} />
            {errors[field] && <span className="adm-field-error" id={`hint-err-${field}`}>{errors[field]}</span>}
          </label>
        ))}

        <h3 className="adm-h4">Preview</h3>
        <div className="adm-table-block">
          <div className="adm-scroll" role="region" aria-label="Hint cost preview, table" tabIndex={0}>
          <table className="adm-table adm-table-fit">
            <caption className="adm-muted">Points deducted per hint, the cap, and the points awarded when all three hint tiers are opened.</caption>
            <thead>
              <tr><th scope="col">Level worth</th><th scope="col">Nudge</th><th scope="col">Approach</th><th scope="col">Walkthrough</th><th scope="col">Cap</th><th scope="col">Awarded with all hints</th></tr>
            </thead>
            <tbody>
              {previewRows(draft).map((row) => (
                <tr key={row.base}>
                  <th scope="row">{row.base} pts</th>
                  <td>{dash(row.nudge)}</td><td>{dash(row.approach)}</td><td>{dash(row.walkthrough)}</td><td>{dash(row.cap)}</td><td>{dash(row.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>

        <div className="adm-actions-row">
          <button type="submit" disabled={!dirty || invalid || act.busy}>{act.isPending('hintcosts') ? 'Saving…' : 'Save hint costs'}</button>
          <button type="button" className="secondary" disabled={act.busy} onClick={() => setDraft(presetDraft(FREE_HINTS))}>Free hints</button>
          <button type="button" className="secondary" disabled={act.busy} onClick={() => setDraft(presetDraft(HINT_COST_DEFAULTS))}>Defaults</button>
          <button type="button" className="secondary" disabled={!dirty || act.busy} onClick={() => setDraft(costsToDraft(saved))}>Discard changes</button>
        </div>
      </Panel>
    </form>
    <ConfirmDialog open={confirm} title="Save these hint costs?" confirmLabel="Save hint costs" pending={act.isPending('hintcosts')}
      onCancel={() => setConfirm(false)} onConfirm={save}>
      <p>{free
        ? 'Hints become free: solves are no longer reduced by opened hints.'
        : 'Teams see the new prices right away. Levels solved earlier keep the points they were awarded.'}</p>
    </ConfirmDialog>
  </>;
}
