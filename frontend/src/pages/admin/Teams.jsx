import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  adjustTeamScore, deleteTeam, getTeam, listTeams, regenerateInviteCode, removeTeamMember, renameTeam, setTeamBanned,
} from '../../api/admin.js';
import { useAct, useAdminData, useListState } from '../../admin/hooks.js';
import { REASON_MAX, validateAdjustment } from '../../admin/forms.js';
import {
  challengeName, formatDate, formatNumber, formatSigned, orDeleted,
} from '../../admin/format.js';
import { copyText } from '../../terminal/clipboard.js';
import AsyncBlock from '../../components/admin/AsyncBlock.jsx';
import ConfirmDialog from '../../components/admin/ConfirmDialog.jsx';
import DataTable from '../../components/admin/DataTable.jsx';
import Drawer from '../../components/admin/Drawer.jsx';
import FilterBar from '../../components/admin/FilterBar.jsx';
import PageHeader, { Badge } from '../../components/admin/PageHeader.jsx';
import { useToasts } from '../../components/admin/Toasts.jsx';

const FILTERS = [
  { name: 'q', label: 'Search team name', type: 'search', placeholder: 'Rustaceans', maxLength: 100, initial: '' },
  { name: 'banned', label: 'Banned', type: 'select', options: [{ value: '', label: 'Any' }, { value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }], initial: '' },
];

export default function Teams() {
  const list = useListState({ sort: '-score', filters: { banned: '' } });
  const [params, setParams] = useSearchParams();
  const selected = params.get('team') ?? '';
  const { data, error, loading, reload } = useAdminData((signal) => listTeams(list.query, signal), [list.query]);

  const columns = [
    { key: 'name', header: 'Team', sortKey: 'name', render: (team) => <strong>{team.name}</strong> },
    { key: 'members', header: 'Members', sortKey: 'members', align: 'right', render: (team) => `${team.members}/3` },
    { key: 'score', header: 'Score', sortKey: 'score', align: 'right', render: (team) => formatNumber(team.score) },
    { key: 'solves', header: 'Solves', align: 'right', render: (team) => formatNumber(team.solves) },
    { key: 'status', header: 'Status', render: (team) => (team.banned ? <Badge tone="danger">Banned</Badge> : <Badge tone="ok">Active</Badge>) },
    { key: 'lastSolveAt', header: 'Last solve', render: (team) => formatDate(team.lastSolveAt) },
    { key: 'createdAt', header: 'Created', sortKey: 'createdAt', render: (team) => formatDate(team.createdAt) },
    { key: 'actions', header: <span className="adm-sr">Actions</span>, render: (team) => <button type="button" className="secondary small" onClick={() => setParams({ team: team.id })}>Details<span className="adm-sr"> for {team.name}</span></button> },
  ];

  return <>
    <PageHeader title="Teams" intro="Scores include manual adjustments; the solve count does not." />
    <FilterBar label="Filter teams" fields={FILTERS} values={list.values} onChange={list.onChange} onReset={list.reset} />
    <DataTable caption="Teams" columns={columns} rows={data?.items ?? []} loading={loading} error={error} onRetry={reload}
      sort={list.state.sort} onSort={list.setSort} emptyTitle="No teams match" emptyHint="Change or reset the filters."
      pagination={{ page: list.state.page, limit: list.state.limit, total: data?.total ?? 0, onPage: list.setPage, onLimit: list.setLimit }} />
    <Drawer open={Boolean(selected)} title="Team details" onClose={() => setParams({})} wide>
      {selected && <TeamDetail key={selected} id={selected} onChanged={reload} onGone={() => setParams({})} />}
    </Drawer>
  </>;
}

function TeamDetail({ id, onChanged, onGone }) {
  const { data: team, error, loading, reload } = useAdminData((signal) => getTeam(id, signal), [id]);
  const act = useAct();
  const toasts = useToasts();
  const [dialog, setDialog] = useState('');
  const [member, setMember] = useState(null);
  const [name, setName] = useState('');
  const [invite, setInvite] = useState('');
  const [form, setForm] = useState({ points: '', reason: '' });
  const [touched, setTouched] = useState(false);
  const check = validateAdjustment(form);
  const close = () => { setDialog(''); setMember(null); };
  const changed = async () => { await Promise.all([reload(), onChanged()]); };
  const run = (key, fn, success, after = changed) => act.run(key, fn, { success, after }).then((outcome) => { if (outcome.ok) close(); return outcome; });

  async function copyInvite() {
    toasts[(await copyText(invite)) ? 'success' : 'error'](invite ? 'Invite code copied.' : 'Nothing to copy.');
  }

  async function regenerate() {
    const outcome = await act.run('invite', () => regenerateInviteCode(id), { after: onChanged });
    if (outcome.ok) { setInvite(outcome.result.inviteCode); setDialog('invite-result'); }
  }

  function startAdjust(event) {
    event.preventDefault();
    setTouched(true);
    if (check.body) setDialog('adjust');
  }

  const empty = team && team.members.length === 0;
  const newScore = team && check.body ? team.score + check.body.points : null;

  return <AsyncBlock loading={loading} error={error} hasData={Boolean(team)} onRetry={reload} label="this team" lines={6}>
    {team && <>
      <h3 className="adm-h3">{team.name} {team.banned && <Badge tone="danger">Banned</Badge>}</h3>
      <dl className="adm-facts">
        {[['Score', formatNumber(team.score)], ['Solves', formatNumber(team.solves)], ['Manual adjustments', formatSigned(team.adjustmentsTotal)],
          ['Active instances', formatNumber(team.activeInstances)], ['Created', formatDate(team.createdAt)]]
          .map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
      </dl>

      <div className="adm-actions-row">
        {team.banned
          ? <button type="button" disabled={act.busy} onClick={() => setDialog('unban')}>Unban team</button>
          : <button type="button" className="adm-danger" disabled={act.busy} onClick={() => setDialog('ban')}>Ban team</button>}
        <button type="button" className="secondary" disabled={act.busy} onClick={() => { setName(team.name); setDialog('rename'); }}>Rename</button>
        <button type="button" className="secondary" disabled={act.busy} onClick={() => setDialog('regenerate')}>New invite code</button>
        <button type="button" className="secondary" disabled={act.busy || !empty} title={empty ? '' : 'Only teams without members can be deleted'} onClick={() => setDialog('delete')}>Delete team</button>
      </div>
      {!empty && <p className="adm-muted">Remove every member before deleting the team.</p>}

      <h4 className="adm-h4">Members ({team.members.length})</h4>
      {team.members.length === 0 ? <p className="adm-muted">This team has no members.</p>
        : <ul className="adm-list">{team.members.map((item) => <li key={item.id}>
          <span><Link to={`/admin/users?user=${encodeURIComponent(item.id)}`}>{item.displayName}</Link> <span className="adm-muted">{item.email}</span> {item.isCaptain && <Badge tone="info">Captain</Badge>} {item.banned && <Badge tone="danger">Banned</Badge>}</span>
          <button type="button" className="secondary small" disabled={act.busy} onClick={() => { setMember(item); setDialog('member'); }}>Remove<span className="adm-sr"> {item.displayName}</span></button>
        </li>)}</ul>}

      <h4 className="adm-h4">Adjust score</h4>
      <form className="adm-form" onSubmit={startAdjust} noValidate>
        <label>Points (signed)
          <input inputMode="numeric" value={form.points} onChange={(event) => setForm({ ...form, points: event.target.value })} placeholder="-50"
            aria-invalid={touched && Boolean(check.errors.points)} aria-describedby="adj-points-error" />
          {touched && check.errors.points && <span id="adj-points-error" className="adm-field-error">{check.errors.points}</span>}
        </label>
        <label>Reason (required, shown in the audit log)
          <input value={form.reason} maxLength={REASON_MAX} onChange={(event) => setForm({ ...form, reason: event.target.value })}
            aria-invalid={touched && Boolean(check.errors.reason)} aria-describedby="adj-reason-error" />
          {touched && check.errors.reason && <span id="adj-reason-error" className="adm-field-error">{check.errors.reason}</span>}
        </label>
        <button type="submit" disabled={act.busy}>Review adjustment</button>
      </form>

      <h4 className="adm-h4">Solve timeline</h4>
      {team.timeline.length === 0 ? <p className="adm-muted">No solves yet.</p>
        : <ol className="adm-timeline">{[...team.timeline].reverse().map((entry) => <li key={entry.id}>
          <span className="adm-timeline-points">{formatSigned(entry.points)}</span>
          <span>
            {entry.adjustment ? <><Badge tone="info">Adjustment</Badge> {entry.reason}</> : <strong>{challengeName(entry.challenge)}</strong>}
            {entry.firstBlood && <> <Badge tone="ok">First blood</Badge></>}
            <span className="adm-muted"> by {orDeleted(entry.user?.displayName)} &middot; {formatDate(entry.solvedAt)}</span>
          </span>
        </li>)}</ol>}
      <p className="adm-muted">Showing up to the last 100 entries. Undo a bogus solve or adjustment under <Link to={`/admin/activity?teamId=${encodeURIComponent(id)}`}>Submissions &amp; solves</Link>.</p>

      <ConfirmDialog open={dialog === 'ban'} danger title={`Ban ${team.name}?`} confirmLabel="Ban team" pending={act.isPending('ban')} onCancel={close}
        onConfirm={() => run('ban', () => setTeamBanned(id, true), `${team.name} banned and its instances stopped.`)}>
        <p>Its running instances are stopped and it cannot submit flags or start instances until you unban it. It disappears from the public leaderboard.</p>
      </ConfirmDialog>
      <ConfirmDialog open={dialog === 'unban'} title={`Unban ${team.name}?`} confirmLabel="Unban team" pending={act.isPending('unban')} onCancel={close}
        onConfirm={() => run('unban', () => setTeamBanned(id, false), `${team.name} unbanned.`)}>
        <p>The team can play again immediately.</p>
      </ConfirmDialog>
      <ConfirmDialog open={dialog === 'rename'} title="Rename team" confirmLabel="Rename" canConfirm={name.trim().length >= 3 && name.trim().length <= 24 && name.trim() !== team.name}
        pending={act.isPending('rename')} onCancel={close} onConfirm={() => run('rename', () => renameTeam(id, name.trim()), 'Team renamed.')}>
        <label>New name (3-24 characters)<input value={name} maxLength={24} onChange={(event) => setName(event.target.value)} /></label>
      </ConfirmDialog>
      <ConfirmDialog open={dialog === 'regenerate'} danger title="Generate a new invite code?" confirmLabel="Generate code" pending={act.isPending('invite')} onCancel={close}
        onConfirm={() => { close(); regenerate(); }}>
        <p>The old code stops working at once. The new code is shown once, so copy it before closing the next window.</p>
      </ConfirmDialog>
      <ConfirmDialog open={dialog === 'invite-result'} title="New invite code" confirmLabel="Done" cancelLabel="Close" onCancel={() => { setInvite(''); close(); }} onConfirm={() => { setInvite(''); close(); }}>
        <p>Shown only now. It is not stored in this page after you close it.</p>
        <div className="adm-copy">
          <input readOnly value={invite} aria-label="Invite code" onFocus={(event) => event.target.select()} />
          <button type="button" className="secondary" onClick={copyInvite}>Copy</button>
        </div>
      </ConfirmDialog>
      <ConfirmDialog open={dialog === 'delete'} danger title={`Delete ${team.name}?`} confirmLabel="Delete team" phrase="DELETE" pending={act.isPending('delete')} onCancel={close}
        onConfirm={() => run('delete', () => deleteTeam(id), 'Team deleted.', async () => { await onChanged(); onGone(); })}>
        <p>Stops the team&apos;s instances and deletes its solves. This cannot be undone.</p>
      </ConfirmDialog>
      <ConfirmDialog open={dialog === 'member'} danger title="Remove member?" confirmLabel="Remove member" pending={act.isPending('member')} onCancel={close}
        onConfirm={() => run('member', () => removeTeamMember(id, member.id), `${member.displayName} removed from the team.`)}>
        <p>{member?.displayName} leaves {team.name}.{member?.isCaptain ? ' They are the captain, so the first remaining member takes over.' : ''}</p>
      </ConfirmDialog>
      <ConfirmDialog open={dialog === 'adjust'} danger={Boolean(check.body && check.body.points < 0)} title="Apply score adjustment?" confirmLabel="Apply adjustment" pending={act.isPending('adjust')} onCancel={close}
        onConfirm={() => run('adjust', () => adjustTeamScore(id, check.body), (result) => `Score adjusted. New team score: ${formatNumber(result.teamScore)}.`)
          .then((outcome) => { if (outcome.ok) { setForm({ points: '', reason: '' }); setTouched(false); } })}>
        {check.body && <>
          <p><strong>{team.name}</strong>: {formatSigned(check.body.points)} points ({formatNumber(team.score)} &rarr; {formatNumber(newScore)}).</p>
          <p>Reason: &ldquo;{check.body.reason}&rdquo;. It is recorded in the audit log. To undo it, delete the adjustment under Submissions &amp; solves.</p>
        </>}
      </ConfirmDialog>
    </>}
  </AsyncBlock>;
}
