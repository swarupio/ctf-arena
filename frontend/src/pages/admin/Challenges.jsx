import { useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  createChallenge, deleteChallenge, duplicateChallenge, exportChallenges, getChallengeStats, importChallenges,
  listChallenges, resetChallengeSolves, setChallengeVisible, updateChallenge,
} from '../../api/admin.js';
import { useAct, useAdminData, useListState } from '../../admin/hooks.js';
import { parseImportFile } from '../../admin/download.js';
import {
  CATEGORIES, DIFFICULTIES, EMPTY_CHALLENGE, challengeBody, challengeToForm, importSummary, isReadOnlyType, readOnlyNote, validateChallenge,
} from '../../admin/forms.js';
import { formatDate, formatNumber, formatPercent } from '../../admin/format.js';
import AsyncBlock from '../../components/admin/AsyncBlock.jsx';
import ConfirmDialog from '../../components/admin/ConfirmDialog.jsx';
import DataTable from '../../components/admin/DataTable.jsx';
import Drawer from '../../components/admin/Drawer.jsx';
import FilterBar from '../../components/admin/FilterBar.jsx';
import PageHeader, { Badge } from '../../components/admin/PageHeader.jsx';

const TYPE_LABELS = { game: 'Range level' };
const typeLabel = (value) => TYPE_LABELS[value] ?? value;
const opts = (values) => [{ value: '', label: 'Any' }, ...values.map((value) => ({ value, label: typeLabel(value) }))];
const FILTERS = [
  { name: 'q', label: 'Search title or slug', type: 'search', maxLength: 100, initial: '' },
  { name: 'category', label: 'Category', type: 'select', options: opts([...CATEGORIES, 'terminal']), initial: '' },
  { name: 'difficulty', label: 'Difficulty', type: 'select', options: opts(DIFFICULTIES), initial: '' },
  { name: 'type', label: 'Type', type: 'select', options: opts(['static', 'docker', 'terminal', 'game', 'weblab', 'forensics', 'reversing', 'osint']), initial: '' },
  { name: 'visible', label: 'Visibility', type: 'select', options: [{ value: '', label: 'Any' }, { value: 'true', label: 'Published' }, { value: 'false', label: 'Hidden' }], initial: '' },
];

export default function Challenges() {
  const list = useListState({ sort: 'createdAt', filters: { category: '', difficulty: '', type: '', visible: '' } });
  const [params, setParams] = useSearchParams();
  const selected = params.get('challenge') ?? '';
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const { data, error, loading, reload } = useAdminData((signal) => listChallenges(list.query, signal), [list.query]);
  const act = useAct();
  const current = (data?.items ?? []).find((item) => item.id === selected) ?? null;

  const toggle = (challenge) => act.run(`vis:${challenge.id}`, () => setChallengeVisible(challenge.id, !challenge.visible), {
    success: challenge.visible ? `"${challenge.title}" hidden from players.` : `"${challenge.title}" published.`, after: reload,
  });

  const columns = [
    { key: 'title', header: 'Challenge', sortKey: 'title', render: (item) => <><strong>{item.title}</strong><br /><span className="adm-muted adm-mono">{item.slug}</span></> },
    { key: 'type', header: 'Type', render: (item) => <Badge tone={isReadOnlyType(item.type) ? 'muted' : ''}>{typeLabel(item.type)}</Badge> },
    { key: 'category', header: 'Category', render: (item) => `${item.category}, ${item.difficulty}` },
    { key: 'points', header: 'Points', sortKey: 'points', align: 'right', render: (item) => formatNumber(item.points) },
    { key: 'solveCount', header: 'Solves', sortKey: 'solveCount', align: 'right', render: (item) => formatNumber(item.solveCount) },
    { key: 'visible', header: 'Status', render: (item) => <button type="button" className="secondary small" aria-pressed={Boolean(item.visible)} disabled={act.busy} onClick={() => toggle(item)}>
      {act.isPending(`vis:${item.id}`) ? 'Saving…' : item.visible ? 'Published – hide' : 'Hidden – publish'}<span className="adm-sr"> {item.title}</span></button> },
    { key: 'actions', header: <span className="adm-sr">Actions</span>, render: (item) => <button type="button" className="secondary small" onClick={() => setParams({ challenge: item.id })}>Manage<span className="adm-sr"> {item.title}</span></button> },
  ];

  return <>
    <PageHeader title="Challenges" intro="Publish, edit, duplicate, import and export challenge definitions. Flags are never shown.">
      <button type="button" onClick={() => setCreating(true)}>New challenge</button>
      <button type="button" className="secondary" onClick={() => setImporting(true)}>Import JSON</button>
      <ExportButton />
    </PageHeader>
    <FilterBar label="Filter challenges" fields={FILTERS} values={list.values} onChange={list.onChange} onReset={list.reset} />
    <DataTable caption="Challenges" columns={columns} rows={data?.items ?? []} loading={loading} error={error} onRetry={reload}
      sort={list.state.sort} onSort={list.setSort} emptyTitle="No challenges match" emptyHint="Change the filters or create a challenge."
      pagination={{ page: list.state.page, limit: list.state.limit, total: data?.total ?? 0, onPage: list.setPage, onLimit: list.setLimit }} />

    <Drawer open={creating} title="New challenge" onClose={() => setCreating(false)} wide>
      {creating && <ChallengeForm challenge={null} onSaved={async () => { setCreating(false); await reload(); }} />}
    </Drawer>
    <Drawer open={Boolean(selected)} title={current?.title ?? 'Challenge'} subtitle={current?.slug} onClose={() => setParams({})} wide>
      {selected && (current
        ? <ManageChallenge key={selected} challenge={current} onChanged={reload} onGone={() => setParams({})} />
        : <p className="adm-muted">This challenge is not on the current page. Search for it by slug, then open it again.</p>)}
    </Drawer>
    <Drawer open={importing} title="Import challenges" onClose={() => setImporting(false)} wide>
      {importing && <ImportPanel onApplied={reload} />}
    </Drawer>
  </>;
}

function ExportButton() {
  const act = useAct();
  return <button type="button" className="secondary" disabled={act.busy} onClick={() => act.run('export', exportChallenges, { success: (name) => `Saved ${name}.` })}>
    {act.isPending('export') ? 'Exporting…' : 'Export JSON'}</button>;
}

function ChallengeForm({ challenge, onSaved }) {
  const editing = Boolean(challenge);
  const readOnly = editing && isReadOnlyType(challenge.type);
  const [form, setForm] = useState(editing ? challengeToForm(challenge) : EMPTY_CHALLENGE);
  const [touched, setTouched] = useState(false);
  const act = useAct();
  const errors = validateChallenge(form, { editing });
  const set = (field) => (event) => setForm({ ...form, [field]: event.target.type === 'checkbox' ? event.target.checked : event.target.value });
  const err = (field) => touched && errors[field];

  async function submit(event) {
    event.preventDefault();
    setTouched(true);
    if (readOnly || Object.keys(errors).length > 0) return;
    const body = challengeBody(form);
    await act.run('save', () => (editing ? updateChallenge(challenge.id, body) : createChallenge(body)), {
      success: editing ? 'Challenge updated.' : 'Challenge created (check its visibility).',
      after: async () => { setForm((value) => ({ ...value, flag: '' })); await onSaved(); },
    });
  }

  const field = (name, label, control) => <label>{label}{control}{err(name) && <span className="adm-field-error">{errors[name]}</span>}</label>;

  return <form className="adm-form adm-form-grid" onSubmit={submit} noValidate>
    {readOnly && <p className="notice adm-wide" role="note">{readOnlyNote(challenge.type)}</p>}
    <fieldset disabled={readOnly || act.busy} className="adm-fieldset">
      {field('slug', 'Slug', <input value={form.slug} onChange={set('slug')} required maxLength={80} readOnly={editing && challenge.type === 'terminal'} aria-invalid={Boolean(err('slug'))} />)}
      {field('title', 'Title', <input value={form.title} onChange={set('title')} required maxLength={100} aria-invalid={Boolean(err('title'))} />)}
      {field('category', 'Category', <select value={form.category} onChange={set('category')}>{[...CATEGORIES, ...(form.category === 'terminal' ? ['terminal'] : [])].map((value) => <option key={value}>{value}</option>)}</select>)}
      {field('difficulty', 'Difficulty', <select value={form.difficulty} onChange={set('difficulty')}>{DIFFICULTIES.map((value) => <option key={value}>{value}</option>)}</select>)}
      {field('points', 'Points', <input type="number" min="1" max="10000" value={form.points} onChange={set('points')} required aria-invalid={Boolean(err('points'))} />)}
      {field('type', 'Type', <select value={form.type} onChange={set('type')} disabled={editing}>
        {['static', 'docker', ...(isReadOnlyType(form.type) ? [form.type] : [])].map((value) => <option key={value} value={value}>{typeLabel(value)}</option>)}</select>)}
      {form.type === 'docker'
        ? <>
          {field('image', 'Image (must start with ctf/)', <input value={form.image} onChange={set('image')} placeholder="ctf/cookie-monster" aria-invalid={Boolean(err('image'))} />)}
          {field('internalPort', 'Internal port', <input type="number" min="1" max="65535" value={form.internalPort} onChange={set('internalPort')} aria-invalid={Boolean(err('internalPort'))} />)}
        </>
        : !readOnly && field('flag', `Flag${editing ? ' (leave empty to keep the stored one)' : ''}`, <input value={form.flag} onChange={set('flag')} autoComplete="off" spellCheck={false} aria-invalid={Boolean(err('flag'))} />)}
      {field('description', 'Description (markdown)', <textarea rows={6} value={form.description} onChange={set('description')} />)}
      {field('attachments', 'Attachments (one per line: name | /path or https://url)', <textarea rows={3} value={form.attachments} onChange={set('attachments')} aria-invalid={Boolean(err('attachments'))} />)}
      <label className="adm-check"><input type="checkbox" checked={form.visible} onChange={set('visible')} /> Visible to players</label>
    </fieldset>
    {!readOnly && <div className="adm-actions-row adm-wide">
      <button type="submit" disabled={act.busy}>{act.busy ? 'Saving…' : editing ? 'Save changes' : 'Create challenge'}</button>
    </div>}
  </form>;
}

function ManageChallenge({ challenge, onChanged, onGone }) {
  const stats = useAdminData((signal) => getChallengeStats(challenge.id, signal), [challenge.id]);
  const act = useAct();
  const [dialog, setDialog] = useState('');
  const [copy, setCopy] = useState({ slug: `${challenge.slug}-copy`, title: `${challenge.title} (copy)` });
  const [clearSubmissions, setClearSubmissions] = useState(false);
  const close = () => setDialog('');
  const changed = async () => { await Promise.all([stats.reload(), onChanged()]); };
  const run = (key, fn, success, after = changed) => act.run(key, fn, { success, after }).then((outcome) => { if (outcome.ok) close(); });
  const info = stats.data;
  const terminal = challenge.type === 'terminal';

  return <>
    <p>{challenge.visible ? <Badge tone="ok">Published</Badge> : <Badge tone="muted">Hidden</Badge>} <Badge>{typeLabel(challenge.type)}</Badge> {challenge.type === 'static' && (challenge.hasFlag ? <Badge>Flag set</Badge> : <Badge tone="danger">No flag</Badge>)}</p>

    <h4 className="adm-h4">Statistics</h4>
    <AsyncBlock loading={stats.loading} error={stats.error} hasData={Boolean(info)} onRetry={stats.reload} label="statistics" lines={3}>
      {info && <>
        <dl className="adm-facts">
          {[['Solves', formatNumber(info.solves)], ['Solve rate', formatPercent(info.solveRate)], ['Attempts (30 d)', formatNumber(info.submissions)],
            ['Wrong attempts', `${formatNumber(info.wrongSubmissions)} (${formatPercent(info.wrongRate)})`], ['Teams that tried', formatNumber(info.teamsAttempted)],
            ['First blood', info.firstBlood ? `${info.firstBlood.teamName ?? '(deleted)'}, ${formatDate(info.firstBlood.at)}` : '–']]
            .map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
        </dl>
        {terminal && <p className="adm-muted">For terminal challenges attempts are recorded against the mode&apos;s first code. Use the Overview terminal table instead.</p>}
      </>}
    </AsyncBlock>

    <h4 className="adm-h4">Edit</h4>
    <ChallengeForm key={challenge.id} challenge={challenge} onSaved={changed} />

    <h4 className="adm-h4">Danger zone</h4>
    <div className="adm-actions-row">
      <button type="button" className="secondary" disabled={act.busy || terminal} onClick={() => setDialog('duplicate')}>Duplicate</button>
      <button type="button" className="secondary" disabled={act.busy} onClick={() => setDialog('reset')}>Reset solves</button>
      <button type="button" className="adm-danger" disabled={act.busy} onClick={() => setDialog('delete')}>Delete challenge</button>
    </div>
    {terminal && <p className="adm-muted">Terminal challenges cannot be duplicated. Deleting one removes it until the next seed.</p>}

    <ConfirmDialog open={dialog === 'duplicate'} title="Duplicate challenge" confirmLabel="Create hidden copy" pending={act.isPending('duplicate')} onCancel={close}
      canConfirm={Boolean(copy.slug.trim() && copy.title.trim())}
      onConfirm={() => run('duplicate', () => duplicateChallenge(challenge.id, { slug: copy.slug.trim(), title: copy.title.trim() }), 'Hidden copy created.', onChanged)}>
      <p>The copy is hidden and has no solves. A static challenge keeps its flag.</p>
      <label>New slug<input value={copy.slug} maxLength={80} onChange={(event) => setCopy({ ...copy, slug: event.target.value })} /></label>
      <label>New title<input value={copy.title} maxLength={100} onChange={(event) => setCopy({ ...copy, title: event.target.value })} /></label>
    </ConfirmDialog>
    <ConfirmDialog open={dialog === 'reset'} danger title={`Reset solves of ${challenge.title}?`} confirmLabel="Reset solves" phrase={challenge.slug} pending={act.isPending('reset')} onCancel={close}
      onConfirm={() => run('reset', () => resetChallengeSolves(challenge.id, clearSubmissions), (result) => `Removed ${result.solvesRemoved} solves${result.submissionsRemoved ? ` and ${result.submissionsRemoved} attempts` : ''}.`)}>
      <p>Deletes every solve of this challenge. Team scores drop with them and the solve counter goes to 0. Manual score adjustments are kept. This cannot be undone.</p>
      <label className="adm-check"><input type="checkbox" checked={clearSubmissions} onChange={(event) => setClearSubmissions(event.target.checked)} /> Also delete the flag attempts</label>
    </ConfirmDialog>
    <ConfirmDialog open={dialog === 'delete'} danger title={`Delete ${challenge.title}?`} confirmLabel="Delete challenge" phrase={challenge.slug} pending={act.isPending('delete')} onCancel={close}
      onConfirm={() => run('delete', () => deleteChallenge(challenge.id), 'Challenge deleted.', async () => { await onChanged(); onGone(); })}>
      <p>Stops its running instances and removes it from every list. Existing solves are kept. This cannot be undone.</p>
    </ConfirmDialog>
  </>;
}

function ResultList({ title, items, render }) {
  if (!items?.length) return null;
  return <div><h5 className="adm-h5">{title} ({items.length})</h5><ul className="adm-list adm-list-plain">{items.map((item, index) => <li key={index}>{render ? render(item) : item}</li>)}</ul></div>;
}

function ImportPanel({ onApplied }) {
  const act = useAct();
  const fileRef = useRef(null);
  const [parsed, setParsed] = useState(null);
  const [fileError, setFileError] = useState('');
  const [mode, setMode] = useState('skip');
  const [preview, setPreview] = useState(null);
  const [confirm, setConfirm] = useState(false);

  async function onFile(event) {
    const file = event.target.files?.[0];
    setPreview(null);
    setParsed(null);
    setFileError('');
    if (!file) return;
    if (file.size > 2_000_000) { setFileError('This file is larger than 2 MB.'); return; }
    try { setParsed({ name: file.name, ...parseImportFile(await file.text()) }); }
    catch (failure) { setFileError(failure.message); }
  }

  const options = { mode };
  const dryRun = () => act.run('preview', () => importChallenges(parsed.challenges, { ...options, dryRun: true }))
    .then((outcome) => { if (outcome.ok) setPreview(outcome.result); });
  const apply = () => act.run('apply', () => importChallenges(parsed.challenges, { ...options, dryRun: false }), {
    success: (result) => `Import done: ${result.created.length} created, ${result.updated.length} updated, ${result.skipped.length} skipped.`, after: onApplied,
  }).then((outcome) => {
    if (outcome.ok) { setConfirm(false); setPreview({ ...outcome.result, applied: true }); }
  });
  const summary = preview ? importSummary(preview) : null;

  return <>
    <p className="adm-muted">Use a file exported from this page (<code>challenges.json</code>). Up to 100 challenges per import. Flags are not part of the file: a static challenge without a stored flag is saved hidden until you set one.</p>
    <div className="adm-form">
      <label>Challenge file (.json)
        <input ref={fileRef} type="file" accept="application/json,.json" onChange={onFile} />
      </label>
      {fileError && <p role="alert" className="error">{fileError}</p>}
      {parsed && <p role="status">{parsed.name}: {parsed.challenges.length} challenge(s) found.</p>}
      <fieldset className="adm-radios" disabled={act.busy}>
        <legend>When a slug already exists</legend>
        <label className="adm-check"><input type="radio" name="import-mode" checked={mode === 'skip'} onChange={() => { setMode('skip'); setPreview(null); }} /> Skip it (leave the challenge alone)</label>
        <label className="adm-check"><input type="radio" name="import-mode" checked={mode === 'update'} onChange={() => { setMode('update'); setPreview(null); }} /> Update its metadata (the stored flag is kept)</label>
      </fieldset>
      <div className="adm-actions-row">
        <button type="button" className="secondary" disabled={!parsed || act.busy} onClick={dryRun}>{act.isPending('preview') ? 'Checking…' : 'Preview (dry run)'}</button>
        <button type="button" disabled={!parsed || !preview || preview.applied || summary.writes === 0 || act.busy} onClick={() => setConfirm(true)}>Apply import</button>
      </div>
    </div>

    {summary && <section aria-live="polite" className="adm-import-result">
      <h4 className="adm-h4">{preview.applied ? 'Import applied' : 'Preview (nothing written yet)'}</h4>
      <dl className="adm-facts">
        {[['Created', summary.created], ['Updated', summary.updated], ['Skipped', summary.skipped], ['Saved hidden, need a flag', summary.needsFlag], ['Rejected', summary.errors]]
          .map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
      </dl>
      <ResultList title="Will be created" items={preview.created} />
      <ResultList title="Will be updated" items={preview.updated} />
      <ResultList title="Skipped (slug exists)" items={preview.skipped} />
      <ResultList title="Need a flag before publishing" items={preview.needsFlag} />
      <ResultList title="Rejected" items={preview.errors} render={(item) => `#${item.index + 1}${item.slug ? ` (${item.slug})` : ''}: ${item.message}`} />
    </section>}

    <ConfirmDialog open={confirm} title="Apply this import?" confirmLabel="Apply import" pending={act.isPending('apply')} onCancel={() => setConfirm(false)} onConfirm={apply}>
      {summary && <p>{summary.created} challenge(s) will be created and {summary.updated} updated. {summary.errors} rejected item(s) are ignored. Imported challenges without a flag stay hidden.</p>}
    </ConfirmDialog>
  </>;
}
