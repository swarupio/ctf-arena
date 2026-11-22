import { useState } from 'react';
import { Link } from 'react-router-dom';
import { killInstance, listInstances } from '../../api/admin.js';
import { useAct, useAdminData, useListState } from '../../admin/hooks.js';
import { useTeamChallengeOptions, withCurrent } from '../../admin/options.js';
import { challengeName, formatDate, orDeleted, safeHref } from '../../admin/format.js';
import { formatTimeLeft } from '../adminHelpers.js';
import ConfirmDialog from '../../components/admin/ConfirmDialog.jsx';
import DataTable from '../../components/admin/DataTable.jsx';
import FilterBar from '../../components/admin/FilterBar.jsx';
import PageHeader, { Badge } from '../../components/admin/PageHeader.jsx';

const STATUSES = ['active', 'all', 'starting', 'running', 'stopping', 'stopped', 'failed'];
const POLL_MS = 15_000;

export default function Instances() {
  const options = useTeamChallengeOptions();
  const list = useListState({ sort: 'createdAt', filters: { status: 'active', teamId: '', challengeId: '' }, resetFilters: { status: 'active', teamId: '', challengeId: '' } });
  const { data, error, loading, reload, refresh, updatedAt } = useAdminData((signal) => listInstances(list.query, signal), [list.query], { pollMs: POLL_MS });
  const act = useAct();
  const [target, setTarget] = useState(null);
  const dockerOff = data?.dockerEnabled === false;
  const now = Date.now();

  async function kill() {
    const outcome = await act.run('kill', () => killInstance(target.id), { success: 'Instance stopped.', after: refresh });
    if (outcome.ok || outcome.error?.status === 404) setTarget(null);
  }

  const fields = [
    { name: 'status', label: 'Status', type: 'select', initial: 'active', options: STATUSES.map((value) => ({ value, label: value === 'active' ? 'Active (default)' : value })) },
    { name: 'teamId', label: 'Team', type: 'select', initial: '', options: withCurrent(options.teams, list.values.teamId, 'All teams') },
    { name: 'challengeId', label: 'Challenge', type: 'select', initial: '', options: withCurrent(options.challenges, list.values.challengeId, 'All challenges') },
  ];
  const columns = [
    { key: 'team', header: 'Team', render: (item) => (item.team?.name ? <Link to={`/admin/teams?team=${encodeURIComponent(item.team.id)}`}>{item.team.name}</Link> : orDeleted(null)) },
    { key: 'challenge', header: 'Challenge', render: (item) => challengeName(item.challenge) },
    { key: 'status', header: 'Status', render: (item) => <Badge tone={item.status === 'running' ? 'ok' : item.status === 'failed' ? 'danger' : ''}>{item.status}</Badge> },
    { key: 'port', header: 'Port', render: (item) => (safeHref(item.url) ? <a href={safeHref(item.url)} target="_blank" rel="noreferrer noopener">{item.port}</a> : item.port) },
    { key: 'expiresAt', header: 'Expires', sortKey: 'expiresAt', render: (item) => <>{formatTimeLeft(item.expiresAt, now)} <span className="adm-muted">({formatDate(item.expiresAt)})</span></> },
    { key: 'extended', header: 'Extended', render: (item) => (item.extended ? 'yes' : 'no') },
    { key: 'actions', header: <span className="adm-sr">Actions</span>, render: (item) => <button type="button" className="secondary small" disabled={act.busy} onClick={() => setTarget(item)}>Kill<span className="adm-sr"> {challengeName(item.challenge)} of {orDeleted(item.team?.name)}</span></button> },
  ];

  return <>
    <PageHeader title="Instances" intro={`Challenge containers. Refreshes every ${POLL_MS / 1000} s while this tab is visible.`}>
      <button type="button" className="secondary small" onClick={reload}>Refresh now</button>
    </PageHeader>
    <p className="adm-muted adm-meta" role="status">{updatedAt ? `Updated ${new Date(updatedAt).toLocaleTimeString()}` : 'Loading…'}</p>
    {dockerOff && <p className="notice" role="note">Docker is disabled on this server (DOCKER_ENABLED=false). No containers are started, and killing an instance only marks its record stopped.</p>}
    <FilterBar label="Filter instances" fields={fields} values={list.values} onChange={list.onChange} onReset={list.reset} />
    <DataTable caption="Instances" columns={columns} rows={data?.items ?? []} loading={loading} error={error} onRetry={reload}
      sort={list.state.sort} onSort={list.setSort}
      emptyTitle={dockerOff ? 'Docker disabled' : 'No instances match'}
      emptyHint={dockerOff ? 'This server runs without Docker, so players cannot start containers.' : 'Nothing is running with these filters.'}
      pagination={{ page: list.state.page, limit: list.state.limit, total: data?.total ?? 0, onPage: list.setPage, onLimit: list.setLimit }} />

    <ConfirmDialog open={Boolean(target)} danger title="Kill this instance?" confirmLabel="Kill instance" pending={act.isPending('kill')} onCancel={() => setTarget(null)} onConfirm={kill}>
      {target && <p>{challengeName(target.challenge)} of team &ldquo;{orDeleted(target.team?.name)}&rdquo;. The container is removed immediately and the team can start a new one.</p>}
    </ConfirmDialog>
  </>;
}
