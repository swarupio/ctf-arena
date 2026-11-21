import { useState } from 'react';
import { listAudit } from '../../api/admin.js';
import { useAdminData, useListState } from '../../admin/hooks.js';
import { diffRows, formatDate, orDash } from '../../admin/format.js';
import { dateRangeFilters, isObjectId } from '../../admin/query.js';
import DataTable from '../../components/admin/DataTable.jsx';
import FilterBar from '../../components/admin/FilterBar.jsx';
import PageHeader from '../../components/admin/PageHeader.jsx';

// Actions listed in docs/API_SPEC.md "Audit log" (the `action` filter is an exact match).
export const AUDIT_ACTIONS = [
  'user.ban', 'user.unban', 'user.remove-from-team', 'user.reset-terminal', 'team.ban', 'team.unban', 'team.rename', 'team.delete',
  'team.remove-member', 'team.invite-code-regenerate', 'team.score-adjust', 'challenge.create', 'challenge.update', 'challenge.delete',
  'challenge.publish', 'challenge.hide', 'challenge.duplicate', 'challenge.reset-solves', 'challenge.import', 'solve.delete',
  'solve.delete-adjustment', 'integrity.resolve', 'integrity.dismiss', 'instance.kill', 'settings.update',
  'export.users', 'export.teams', 'export.submissions', 'export.leaderboard',
];
const TARGET_TYPES = ['user', 'team', 'challenge', 'solve', 'instance', 'settings', 'integrity', 'export'];

const FILTERS = [
  { name: 'q', label: 'Search actor, action or note', type: 'search', maxLength: 100, initial: '' },
  { name: 'action', label: 'Action', type: 'select', initial: '', options: [{ value: '', label: 'Any action' }, ...AUDIT_ACTIONS.map((value) => ({ value, label: value }))] },
  { name: 'targetType', label: 'Target type', type: 'select', initial: '', options: [{ value: '', label: 'Any' }, ...TARGET_TYPES.map((value) => ({ value, label: value }))] },
  { name: 'actorId', label: 'Actor id', type: 'text', maxLength: 24, initial: '' },
  { name: 'from', label: 'From (UTC day)', type: 'date', initial: '' },
  { name: 'to', label: 'To (UTC day)', type: 'date', initial: '' },
];
const mapFilters = (values) => ({ ...values, actorId: isObjectId(values.actorId) ? values.actorId : '', ...dateRangeFilters(values) });

export default function Audit() {
  const list = useListState({ sort: '-createdAt', filters: { action: '', targetType: '', actorId: '', from: '', to: '' }, mapFilters });
  const { data, error, loading, reload } = useAdminData((signal) => listAudit(list.query, signal), [list.query]);
  const [open, setOpen] = useState(() => new Set());
  const toggle = (id) => setOpen((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const columns = [
    { key: 'createdAt', header: 'When', sortKey: 'createdAt', render: (entry) => formatDate(entry.createdAt) },
    { key: 'actor', header: 'Admin', render: (entry) => orDash(entry.actor?.email) },
    { key: 'action', header: 'Action', render: (entry) => <code>{entry.action}</code> },
    { key: 'target', header: 'Target', render: (entry) => <>{entry.targetType}{entry.targetId ? <> <span className="adm-muted adm-mono">{entry.targetId}</span></> : null}</> },
    { key: 'note', header: 'Note', render: (entry) => orDash(entry.note) },
    { key: 'details', header: <span className="adm-sr">Details</span>, render: (entry) => <button type="button" className="secondary small" aria-expanded={open.has(entry.id)} aria-controls={`audit-${entry.id}`} onClick={() => toggle(entry.id)}>
      {open.has(entry.id) ? 'Hide' : 'Details'}<span className="adm-sr"> of {entry.action}</span></button> },
  ];

  return <>
    <PageHeader title="Audit log" intro="Every admin change, kept for 365 days. Entries cannot be edited or deleted. Secrets are never recorded." />
    <FilterBar label="Filter audit log" fields={FILTERS} values={list.values} onChange={list.onChange} onReset={list.reset} />
    {list.values.actorId && !isObjectId(list.values.actorId) && <p role="status" className="adm-field-error">The actor id must be 24 hexadecimal characters, so it is not used as a filter yet.</p>}
    <DataTable caption="Audit log" columns={columns} rows={data?.items ?? []} loading={loading} error={error} onRetry={reload}
      sort={list.state.sort} onSort={list.setSort} emptyTitle="No audit entries match" emptyHint="Change or reset the filters."
      rowClassName={(entry) => (open.has(entry.id) ? 'adm-row-open' : '')}
      renderExpanded={(entry) => open.has(entry.id) && <EntryDetails entry={entry} />}
      pagination={{ page: list.state.page, limit: list.state.limit, total: data?.total ?? 0, onPage: list.setPage, onLimit: list.setLimit }} />
  </>;
}

function EntryDetails({ entry }) {
  const rows = diffRows(entry.before, entry.after);
  return <div id={`audit-${entry.id}`} className="adm-details">
    <p className="adm-muted">By {orDash(entry.actor?.email)} from {orDash(entry.ip)}</p>
    {rows.length === 0
      ? <p className="adm-muted">No before/after summary was recorded for this action.</p>
      : <table className="adm-table adm-table-inner">
        <caption className="adm-sr">Changes of {entry.action}</caption>
        <thead><tr><th scope="col">Field</th><th scope="col">Before</th><th scope="col">After</th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.key} className={row.changed ? 'adm-changed' : undefined}>
          <th scope="row">{row.key}</th><td>{row.before}</td><td>{row.after}{row.changed ? <span className="adm-sr"> (changed)</span> : null}</td>
        </tr>)}</tbody>
      </table>}
  </div>;
}
