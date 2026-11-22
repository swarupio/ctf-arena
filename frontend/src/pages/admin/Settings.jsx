import { useEffect, useState } from 'react';
import { getSettings, saveSettings } from '../../api/admin.js';
import { useAct, useAdminData } from '../../admin/hooks.js';
import {
  ANNOUNCEMENT_LEVELS, ANNOUNCEMENT_MAX, settingsPatch, settingsToDraft, validateSettings,
} from '../../admin/forms.js';
import { stableKey } from '../../admin/draftSync.js';
import { formatDate } from '../../admin/format.js';
import { BannerView } from '../../components/AnnouncementBanner.jsx';
import AsyncBlock from '../../components/admin/AsyncBlock.jsx';
import ConfirmDialog from '../../components/admin/ConfirmDialog.jsx';
import EventPanel from '../../components/admin/EventPanel.jsx';
import HintCostsPanel from '../../components/admin/HintCostsPanel.jsx';
import PageHeader, { Panel } from '../../components/admin/PageHeader.jsx';

export default function Settings() {
  const { data, error, loading, reload } = useAdminData((signal) => getSettings(signal), []);
  return <>
    <PageHeader title="Settings" intro="Platform-wide switches and the announcement banner shown on every page." />
    <AsyncBlock loading={loading} error={error} hasData={Boolean(data)} onRetry={reload} label="the settings" lines={4}>
      {data && <SettingsForm saved={data} onSaved={reload} />}
    </AsyncBlock>
  </>;
}

function SettingsForm({ saved, onSaved }) {
  const act = useAct();
  const [draft, setDraft] = useState(() => settingsToDraft(saved));
  const [confirm, setConfirm] = useState(false);
  // Re-sync only when this form's own slice changed on the server; saving the event form must not wipe unsaved edits here.
  const sliceKey = stableKey(settingsToDraft(saved));
  useEffect(() => { setDraft(settingsToDraft(saved)); }, [sliceKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const patch = settingsPatch(saved, draft);
  const dirty = Object.keys(patch).length > 0;
  const errors = validateSettings(draft);
  const invalid = Object.keys(errors).length > 0;
  const freezing = patch.submissionsFrozen === true;
  const closing = patch.registrationOpen === false;
  const risky = freezing || closing;

  const setAnnouncement = (field) => (event) => setDraft({ ...draft, announcement: { ...draft.announcement, [field]: event.target.value } });
  const save = () => act.run('save', () => saveSettings(patch), { success: 'Settings saved.', after: onSaved }).then(() => setConfirm(false));
  function submit(event) {
    event.preventDefault();
    if (!dirty || invalid) return;
    if (risky) setConfirm(true); else save();
  }

  const text = draft.announcement.text.trim();
  return <>
    <form className="adm-form" onSubmit={submit} noValidate>
      <Panel title="Platform" id="settings-platform">
        <label className="adm-check"><input type="checkbox" checked={draft.registrationOpen} onChange={(event) => setDraft({ ...draft, registrationOpen: event.target.checked })} /> Registration is open</label>
        <p className="adm-muted">This is published to the web app only. Sign-up itself happens in Cognito, so closing it here does not block anyone who calls Cognito directly.</p>
        <label className="adm-check"><input type="checkbox" checked={draft.submissionsFrozen} onChange={(event) => setDraft({ ...draft, submissionsFrozen: event.target.checked })} /> Freeze flag submissions</label>
        <p className="adm-muted">While frozen, flag and terminal submissions are refused with &ldquo;423 submissions frozen&rdquo; and no attempt is recorded. Browsing, instances and the terminal commands keep working.</p>
      </Panel>

      <Panel title="Announcement banner" id="settings-banner">
        <label>Message ({draft.announcement.text.length}/{ANNOUNCEMENT_MAX}) &ndash; leave empty to hide the banner
          <textarea rows={3} value={draft.announcement.text} onChange={setAnnouncement('text')} maxLength={ANNOUNCEMENT_MAX} aria-invalid={Boolean(errors.announcement)} />
          {errors.announcement && <span className="adm-field-error">{errors.announcement}</span>}
        </label>
        <label>Level
          <select value={draft.announcement.level} onChange={setAnnouncement('level')}>
            {ANNOUNCEMENT_LEVELS.map((level) => <option key={level} value={level}>{level}</option>)}
          </select>
        </label>
        <h3 className="adm-h4">Preview</h3>
        <div className="adm-preview">
          {text ? <BannerView text={text} level={draft.announcement.level} /> : <p className="adm-muted">No banner is shown while the message is empty.</p>}
        </div>
        <p className="adm-muted">Players can dismiss the banner for their browser session. Critical messages are announced to screen readers immediately.</p>
      </Panel>

      <div className="adm-actions-row">
        <button type="submit" disabled={!dirty || invalid || act.busy}>{act.isPending('save') ? 'Saving…' : 'Save settings'}</button>
        <button type="button" className="secondary" disabled={!dirty || act.busy} onClick={() => setDraft(settingsToDraft(saved))}>Discard changes</button>
        {saved.updatedAt && <span className="adm-muted">Last saved {formatDate(saved.updatedAt)}</span>}
      </div>
    </form>

    <EventPanel saved={saved.event} onSaved={onSaved} />

    <HintCostsPanel saved={saved.hintCosts} onSaved={onSaved} />

    <ConfirmDialog open={confirm} danger title="Apply these settings?" confirmLabel="Save settings" pending={act.isPending('save')} onCancel={() => setConfirm(false)} onConfirm={save}>
      {freezing && <p>Players will not be able to submit flags or terminal answers until you unfreeze submissions.</p>}
      {closing && <p>The web app will tell visitors that registration is closed.</p>}
    </ConfirmDialog>
  </>;
}
