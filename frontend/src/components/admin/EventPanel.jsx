import { useEffect, useState } from 'react';
import { saveSettings } from '../../api/admin.js';
import { useAct } from '../../admin/hooks.js';
import {
  CLEAR_EVENT_BODY, EVENT_NAME_MAX, PHASE_LABELS, eventBody, eventDirty, eventToDraft, isBlankDraft, validateEventDraft,
} from '../../admin/eventForm.js';
import { stableKey } from '../../admin/draftSync.js';
import { formatDate } from '../../admin/format.js';
import ConfirmDialog from './ConfirmDialog.jsx';
import { Badge, Panel } from './PageHeader.jsx';

const BLANK = { name: '', startsAt: '', endsAt: '', freezeAt: '' };
const zone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'local time'; } catch { return 'local time'; } };

// Scheduled Arena event: name, start, end and optional scoreboard freeze. Its own form with its own buttons (the event
// is replaced as a whole). Times are typed in the browser's time zone and stored as UTC.
export default function EventPanel({ saved, onSaved }) {
  const act = useAct();
  const [draft, setDraft] = useState(() => eventToDraft(saved));
  const [confirm, setConfirm] = useState(false);
  // Only the saved event itself resets the draft, not a reload that carries the same event.
  const eventKey = stableKey(saved ?? null);
  useEffect(() => { setDraft(eventToDraft(saved)); }, [eventKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const errors = validateEventDraft(draft);
  const invalid = Object.keys(errors).length > 0;
  const blank = isBlankDraft(draft);
  const dirty = eventDirty(saved, draft);
  const phase = saved?.phase ?? 'none';
  const set = (field) => (event) => setDraft({ ...draft, [field]: event.target.value });

  // A blank form is the same as clearing the event.
  const save = () => act.run('event', () => saveSettings(blank ? CLEAR_EVENT_BODY : eventBody(draft)), {
    success: blank ? 'Event cleared.' : 'Event saved.', after: onSaved,
  }).then(() => setConfirm(false));

  function submit(event) {
    event.preventDefault();
    if (invalid || !dirty) return;
    setConfirm(true);
  }

  return <>
    <form className="adm-form" onSubmit={submit} noValidate>
      <Panel title="Scheduled event" id="settings-event">
        <p>
          <Badge tone={phase === 'live' || phase === 'frozen' ? 'ok' : ''}>{saved ? phase : 'disabled'}</Badge> {PHASE_LABELS[phase]}
        </p>
        {!saved && <p className="adm-muted">Event disabled: the platform behaves as usual, with no countdown, no automatic freeze and no start or end limit on submissions.</p>}
        <p className="adm-muted">
          Times are in your browser&apos;s time zone ({zone()}) and are stored as UTC. While an event is scheduled, every flag and answer route
          refuses submissions before the start and after the end (423); the public scoreboard freezes at the freeze time and shows the final
          standings after the end. Admins always see live standings.
        </p>
        <label>Event name ({draft.name.length}/{EVENT_NAME_MAX}), optional
          <input type="text" value={draft.name} maxLength={EVENT_NAME_MAX} onChange={set('name')} aria-invalid={Boolean(errors.name)} />
          {errors.name && <span className="adm-field-error">{errors.name}</span>}
        </label>
        <label>Starts
          <input type="datetime-local" value={draft.startsAt} onChange={set('startsAt')} aria-invalid={Boolean(errors.startsAt)} />
          {errors.startsAt && <span className="adm-field-error">{errors.startsAt}</span>}
        </label>
        <label>Ends
          <input type="datetime-local" value={draft.endsAt} onChange={set('endsAt')} aria-invalid={Boolean(errors.endsAt)} />
          {errors.endsAt && <span className="adm-field-error">{errors.endsAt}</span>}
        </label>
        <label>Scoreboard freezes at, optional (between the start and the end)
          <input type="datetime-local" value={draft.freezeAt} onChange={set('freezeAt')} aria-invalid={Boolean(errors.freezeAt)} />
          {errors.freezeAt && <span className="adm-field-error">{errors.freezeAt}</span>}
        </label>
        {saved && <p className="adm-muted">Saved schedule: {formatDate(saved.startsAt)} to {formatDate(saved.endsAt)}{saved.freezeAt ? `, freeze at ${formatDate(saved.freezeAt)}` : ', no freeze'}.</p>}
        <div className="adm-actions-row">
          <button type="submit" disabled={!dirty || invalid || act.busy}>{act.isPending('event') ? 'Saving…' : blank ? 'Save (clears the event)' : 'Save event'}</button>
          <button type="button" className="secondary" disabled={!saved || act.busy} onClick={() => setDraft(BLANK)}>Clear</button>
          <button type="button" className="secondary" disabled={!dirty || act.busy} onClick={() => setDraft(eventToDraft(saved))}>Discard changes</button>
        </div>
      </Panel>
    </form>
    <ConfirmDialog open={confirm} danger={blank} title={blank ? 'Clear the event?' : 'Save this event?'} confirmLabel={blank ? 'Clear event' : 'Save event'}
      pending={act.isPending('event')} onCancel={() => setConfirm(false)} onConfirm={save}>
      {blank
        ? <p>The countdown disappears, the scoreboard is live for everybody and submissions are no longer limited by a start or end time.</p>
        : <p>Players see the countdown right away. Submissions are refused outside the start and end times, and the public scoreboard freezes at the freeze time.</p>}
    </ConfirmDialog>
  </>;
}
