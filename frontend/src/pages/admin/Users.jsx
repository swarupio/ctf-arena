import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  getUser, listUsers, removeUserFromTeam, resetUserTerminal, setUserBanned,
} from '../../api/admin.js';
import { useAct, useAdminData, useListState } from '../../admin/hooks.js';
import {
  challengeName, formatDate, formatDateCompact, formatNumber, formatSigned, orDash, timeAgo,
} from '../../admin/format.js';
import AsyncBlock from '../../components/admin/AsyncBlock.jsx';
import ConfirmDialog from '../../components/admin/ConfirmDialog.jsx';
import DataTable from '../../components/admin/DataTable.jsx';
import Drawer from '../../components/admin/Drawer.jsx';
import FilterBar from '../../components/admin/FilterBar.jsx';
import PageHeader, { Badge } from '../../components/admin/PageHeader.jsx';

const YES_NO = [{ value: '', label: 'Any' }, { value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }];
const FILTERS = [
  { name: 'q', label: 'Search name or email', type: 'search', placeholder: 'alice@example.com', maxLength: 100, initial: '' },
  { name: 'role', label: 'Role', type: 'select', options: [{ value: '', label: 'Any' }, { value: 'player', label: 'Player' }, { value: 'admin', label: 'Admin' }], initial: '' },
  { name: 'banned', label: 'Banned', type: 'select', options: YES_NO, initial: '' },
  { name: 'hasTeam', label: 'Has a team', type: 'select', options: YES_NO, initial: '' },
];
const RESET_PHRASE = 'RESET';

export default function Users() {
  const list = useListState({ sort: '-createdAt', filters: { role: '', banned: '', hasTeam: '' } });
  const [params, setParams] = useSearchParams();
  const selected = params.get('user') ?? '';
  const { data, error, loading, reload } = useAdminData((signal) => listUsers(list.query, signal), [list.query]);

  const columns = [
    { key: 'displayName', header: 'Name', sortKey: 'displayName', className: 'adm-wrap-any', render: (user) => <strong>{user.displayName}</strong> },
    { key: 'email', header: 'Email', sortKey: 'email', className: 'adm-wrap-any', render: (user) => user.email },
    { key: 'role', header: 'Role', render: (user) => <Badge tone={user.role === 'admin' ? 'info' : ''}>{user.role}</Badge> },
    { key: 'status', header: 'Status', render: (user) => (user.banned ? <Badge tone="danger">Banned</Badge> : <Badge tone="ok">Active</Badge>) },
    { key: 'team', header: 'Team', render: (user) => (user.team ? <Link to={`/admin/teams?team=${encodeURIComponent(user.team.id)}`}>{user.team.name ?? '(deleted)'}</Link> : <span className="adm-muted">No team</span>) },
    { key: 'createdAt', header: 'Joined (UTC)', sortKey: 'createdAt', className: 'adm-nowrap', render: (user) => formatDateCompact(user.createdAt) },
    { key: 'actions', header: <span className="adm-sr">Actions</span>, render: (user) => <button type="button" className="secondary small" onClick={() => setParams({ user: user.id })}>Details<span className="adm-sr"> for {user.displayName}</span></button> },
  ];

  return <>
    <PageHeader title="Users" intro="Search players, review their activity and moderate them." />
    <FilterBar label="Filter users" fields={FILTERS} values={list.values} onChange={list.onChange} onReset={list.reset} />
    <DataTable caption="Users" columns={columns} rows={data?.items ?? []} loading={loading} error={error} onRetry={reload}
      sort={list.state.sort} onSort={list.setSort} emptyTitle="No users match" emptyHint="Change or reset the filters."
      pagination={{ page: list.state.page, limit: list.state.limit, total: data?.total ?? 0, onPage: list.setPage, onLimit: list.setLimit }} />
    <Drawer open={Boolean(selected)} title="User details" onClose={() => setParams({})}>
      {selected && <UserDetail key={selected} id={selected} onChanged={reload} />}
    </Drawer>
  </>;
}

function Facts({ items }) {
  return <dl className="adm-facts">{items.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}

function UserDetail({ id, onChanged }) {
  const { data: user, error, loading, reload } = useAdminData((signal) => getUser(id, signal), [id]);
  const act = useAct();
  const [dialog, setDialog] = useState('');
  const [reason, setReason] = useState('');
  const close = () => { setDialog(''); setReason(''); };
  const changed = async () => { await Promise.all([reload(), onChanged()]); };

  const run = (key, fn, success) => act.run(key, fn, { success, after: changed }).then((outcome) => { if (outcome.ok) close(); });

  return <AsyncBlock loading={loading} error={error} hasData={Boolean(user)} onRetry={reload} label="this user" lines={6}>
    {user && <>
      <h3 className="adm-h3">{user.displayName} {user.banned && <Badge tone="danger">Banned</Badge>} {user.role === 'admin' && <Badge tone="info">Admin</Badge>}</h3>
      <Facts items={[
        ['Email', user.email], ['Joined', formatDate(user.createdAt)],
        ['Team', user.team ? <Link to={`/admin/teams?team=${encodeURIComponent(user.team.id)}`}>{user.team.name}{user.team.banned ? ' (banned)' : ''}</Link> : 'No team'],
        ['Solves', formatNumber(user.solveCount)], ['Flag attempts', formatNumber(user.submissionCount)],
      ]} />

      <div className="adm-actions-row">
        {user.banned
          ? <button type="button" disabled={act.busy} onClick={() => setDialog('unban')}>Unban user</button>
          : <button type="button" className="adm-danger" disabled={act.busy || user.role === 'admin'} onClick={() => setDialog('ban')}>Ban user</button>}
        <button type="button" className="secondary" disabled={act.busy || !user.team} onClick={() => setDialog('remove')}>Remove from team</button>
        <button type="button" className="secondary" disabled={act.busy} onClick={() => setDialog('reset')}>Reset terminal progress</button>
      </div>
      {user.role === 'admin' && <p className="adm-muted">Admins cannot be banned. Roles are managed in AWS Cognito.</p>}

      <h4 className="adm-h4">Terminal</h4>
      <Facts items={[
        ['Codes solved', formatNumber(user.terminal?.codesSolved)], ['Points', formatNumber(user.terminal?.points)],
        ['By mode', Object.entries(user.terminal?.solvedByMode ?? {}).map(([mode, count]) => `${mode}: ${count}`).join(', ') || '–'],
        ['Commands (48 h)', formatNumber(user.terminal?.commandsLast48h)], ['Last command', user.terminal?.lastCommandAt ? timeAgo(user.terminal.lastCommandAt) : '–'],
      ]} />

      <h4 className="adm-h4">Fair play</h4>
      {user.integrity?.signals
        ? <Facts items={[
          ['Signals', formatNumber(user.integrity.signals)], ['Events', formatNumber(user.integrity.events)],
          ['Max severity', orDash(user.integrity.maxSeverity)], ['Last signal', user.integrity.lastAt ? timeAgo(user.integrity.lastAt) : '–'],
        ]} />
        : <p className="adm-muted">No fair-play signals.</p>}
      {user.integrity?.signals > 0 && <p><Link to={`/admin/integrity?q=${encodeURIComponent(user.displayName)}`}>Review in Fair play</Link></p>}

      <h4 className="adm-h4">Recent solves</h4>
      {user.recentSolves?.length
        ? <ul className="adm-list">{user.recentSolves.map((solve) => <li key={solve.id}>
          <span><strong>{challengeName(solve.challenge)}</strong> {solve.firstBlood && <Badge tone="ok">First blood</Badge>}</span>
          <span>{formatSigned(solve.points)} pts &middot; {formatDate(solve.solvedAt)}</span>
        </li>)}</ul>
        : <p className="adm-muted">No solves yet.</p>}

      <h4 className="adm-h4">Recent attempts</h4>
      {user.recentSubmissions?.length
        ? <ul className="adm-list">{user.recentSubmissions.map((item) => <li key={item.id}>
          <span>{challengeName(item.challenge)}</span>
          <span>{item.correct ? <Badge tone="ok">Correct</Badge> : <Badge>Wrong</Badge>} {formatDate(item.createdAt)}</span>
        </li>)}</ul>
        : <p className="adm-muted">No attempts in the last 30 days.</p>}

      <ConfirmDialog open={dialog === 'ban'} danger title={`Ban ${user.displayName}?`} confirmLabel="Ban user" pending={act.isPending('ban')} onCancel={close}
        onConfirm={() => run('ban', () => setUserBanned(id, true, reason.trim()), `${user.displayName} banned.`)}>
        <p>A banned user can still sign in and read, but cannot submit flags, start instances or use the terminal. This is recorded in the audit log.</p>
        <label>Reason (optional)<input value={reason} maxLength={200} onChange={(event) => setReason(event.target.value)} /></label>
      </ConfirmDialog>
      <ConfirmDialog open={dialog === 'unban'} title={`Unban ${user.displayName}?`} confirmLabel="Unban user" pending={act.isPending('unban')} onCancel={close}
        onConfirm={() => run('unban', () => setUserBanned(id, false), `${user.displayName} unbanned.`)}>
        <p>The user can play again immediately.</p>
      </ConfirmDialog>
      <ConfirmDialog open={dialog === 'remove'} danger title="Remove from team?" confirmLabel="Remove from team" pending={act.isPending('remove')} onCancel={close}
        onConfirm={() => run('remove', () => removeUserFromTeam(id), `${user.displayName} removed from the team.`)}>
        <p>{user.displayName} leaves {user.team?.name ?? 'the team'}. If they were captain, the first remaining member takes over. An emptied team stays until you delete it.</p>
      </ConfirmDialog>
      <ConfirmDialog open={dialog === 'reset'} danger title="Reset terminal progress?" confirmLabel="Reset progress" phrase={RESET_PHRASE} pending={act.isPending('reset')} onCancel={close}
        onConfirm={() => run('reset', () => resetUserTerminal(id), (result) => `Terminal progress reset: ${result.solvesRemoved} solves and ${result.activityRemoved} activity records removed.`)}>
        <p>Deletes the terminal solves that {user.displayName} submitted (their team&apos;s score drops by those points; terminal codes carry no first-blood bonus, so no other team&apos;s score changes) and their command pacing records. Teammates&apos; solves stay. This cannot be undone.</p>
      </ConfirmDialog>
    </>}
  </AsyncBlock>;
}
