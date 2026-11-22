import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { deleteSolve, listSolves, listSubmissions } from '../../api/admin.js';
import { useAct, useAdminData, useListState } from '../../admin/hooks.js';
import { useTeamChallengeOptions, withCurrent } from '../../admin/options.js';
import { validateReason } from '../../admin/forms.js';
import {
  challengeName, formatDate, formatNumber, formatSigned, orDeleted,
} from '../../admin/format.js';
import { dateRangeFilters, isObjectId } from '../../admin/query.js';
import ConfirmDialog from '../../components/admin/ConfirmDialog.jsx';
import DataTable from '../../components/admin/DataTable.jsx';
import FilterBar from '../../components/admin/FilterBar.jsx';
import PageHeader, { Badge } from '../../components/admin/PageHeader.jsx';

const TABS = [{ id: 'solves', label: 'Solves' }, { id: 'submissions', label: 'Flag attempts' }];

const mapFilters = (values) => ({ ...values, userId: isObjectId(values.userId) ? values.userId : '', ...dateRangeFilters(values) });

export default function Activity() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'submissions' ? 'submissions' : 'solves';
  const initial = {
    teamId: params.get('teamId') ?? '', challengeId: params.get('challengeId') ?? '', userId: params.get('userId') ?? '',
  };
  return <>
    <PageHeader title="Submissions &amp; solves" intro="Every scored solve and every flag attempt. Typed flag text is never stored or shown." />
    <div role="tablist" aria-label="Activity type" className="adm-tabs">
      {TABS.map((item) => <button key={item.id} type="button" role="tab" id={`tab-${item.id}`} aria-selected={tab === item.id} aria-controls="activity-panel"
        tabIndex={tab === item.id ? 0 : -1} className={tab === item.id ? '' : 'secondary'}
        onClick={() => setParams({ ...(item.id === 'solves' ? {} : { tab: item.id }) })}
        onKeyDown={(event) => { if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); setParams(tab === 'solves' ? { tab: 'submissions' } : {}); } }}>{item.label}</button>)}
    </div>
    <div id="activity-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
      {tab === 'solves' ? <SolvesTab key="solves" initial={initial} /> : <SubmissionsTab key="submissions" initial={initial} />}
    </div>
  </>;
}

function useActivityFilters(extra, initial, kind) {
  const options = useTeamChallengeOptions();
  const list = useListState({
    sort: kind === 'solves' ? '-solvedAt' : '-createdAt',
    filters: { ...initial, from: '', to: '', ...extra },
    resetFilters: { teamId: '', challengeId: '', userId: '', from: '', to: '', ...extra },
    mapFilters,
  });
  const values = list.values;
  const fields = [
    { name: 'teamId', label: 'Team', type: 'select', options: withCurrent(options.teams, values.teamId, 'All teams'), initial: '' },
    { name: 'challengeId', label: 'Challenge', type: 'select', options: withCurrent(options.challenges, values.challengeId, 'All challenges'), initial: '' },
    { name: 'userId', label: 'User id', type: 'text', placeholder: '24 hex characters', maxLength: 24, initial: '' },
  ];
  return { list, fields, values };
}

const dateFields = [
  { name: 'from', label: 'From (UTC day)', type: 'date', initial: '' },
  { name: 'to', label: 'To (UTC day)', type: 'date', initial: '' },
];

function UserIdHint({ value }) {
  return value && !isObjectId(value) ? <p role="status" className="adm-field-error">The user id must be 24 hexadecimal characters, so it is not used as a filter yet.</p> : null;
}

function SolvesTab({ initial }) {
  const { list, fields, values } = useActivityFilters({ adjustments: 'include' }, initial, 'solves');
  const { data, error, loading, reload } = useAdminData((signal) => listSolves(list.query, signal), [list.query]);
  const act = useAct();
  const [target, setTarget] = useState(null);
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const [done, setDone] = useState(null);
  const problem = validateReason(reason);
  const close = () => { setTarget(null); setReason(''); setTouched(false); setDone(null); };

  async function remove() {
    setTouched(true);
    if (problem) return;
    const outcome = await act.run('delete', () => deleteSolve(target.id, reason.trim()), { after: reload });
    if (outcome.ok) setDone(outcome.result);
  }

  const columns = [
    { key: 'solvedAt', header: 'When', sortKey: 'solvedAt', render: (solve) => formatDate(solve.solvedAt) },
    { key: 'team', header: 'Team', render: (solve) => (solve.team?.name ? <Link to={`/admin/teams?team=${encodeURIComponent(solve.team.id)}`}>{solve.team.name}</Link> : '(deleted)') },
    { key: 'user', header: 'Player', render: (solve) => (solve.user?.displayName ? <Link to={`/admin/users?user=${encodeURIComponent(solve.user.id)}`}>{solve.user.displayName}</Link> : '(deleted)') },
    { key: 'challenge', header: 'Challenge', render: (solve) => (solve.adjustment ? <><Badge tone="info">Adjustment</Badge> {solve.reason}</> : challengeName(solve.challenge)) },
    { key: 'points', header: 'Points', sortKey: 'points', align: 'right', render: (solve) => <>{formatSigned(solve.points)} {solve.firstBlood && <Badge tone="ok">First blood</Badge>}</> },
    { key: 'actions', header: <span className="adm-sr">Actions</span>, render: (solve) => <button type="button" className="secondary small" onClick={() => setTarget(solve)}>Delete<span className="adm-sr"> solve of {orDeleted(solve.team?.name)}</span></button> },
  ];

  return <>
    <FilterBar label="Filter solves" values={values} onChange={list.onChange} onReset={list.reset}
      fields={[...fields, { name: 'adjustments', label: 'Manual adjustments', type: 'select', initial: 'include', options: [{ value: 'include', label: 'Include' }, { value: 'only', label: 'Only adjustments' }, { value: 'exclude', label: 'Exclude' }] }, ...dateFields]} />
    <UserIdHint value={values.userId} />
    <DataTable caption="Solves" columns={columns} rows={data?.items ?? []} loading={loading} error={error} onRetry={reload}
      sort={list.state.sort} onSort={list.setSort} emptyTitle="No solves match" emptyHint="Change or reset the filters."
      pagination={{ page: list.state.page, limit: list.state.limit, total: data?.total ?? 0, onPage: list.setPage, onLimit: list.setLimit }} />

    <ConfirmDialog open={Boolean(target)} danger={!done} title={done ? 'Solve deleted' : 'Delete this solve?'} confirmLabel={done ? 'Done' : 'Delete solve'}
      cancelLabel="Close" pending={act.isPending('delete')} canConfirm={done ? true : !problem}
      onCancel={close} onConfirm={done ? close : remove}>
      {done
        ? <>
          <p role="status">Removed {formatNumber(done.pointsRemoved)} points. The team&apos;s recomputed score is now <strong>{formatNumber(done.teamScore)}</strong>.</p>
          <p className="adm-muted">The challenge solve counter was updated and first blood moved to the next solver if needed.</p>
        </>
        : target && <>
          <p>{target.adjustment ? 'Deletes this manual score adjustment' : `Deletes the solve of ${challengeName(target.challenge)} by ${orDeleted(target.team?.name)}`}
            {' '}({formatSigned(target.points)} points). The team score is recomputed. This cannot be undone.</p>
          <label>Reason (required, recorded in the audit log)
            <input value={reason} maxLength={200} onChange={(event) => setReason(event.target.value)} aria-invalid={touched && Boolean(problem)} />
            {touched && problem && <span className="adm-field-error">{problem}</span>}
          </label>
        </>}
    </ConfirmDialog>
  </>;
}

function SubmissionsTab({ initial }) {
  const { list, fields, values } = useActivityFilters({ result: '' }, initial, 'submissions');
  const { data, error, loading, reload } = useAdminData((signal) => listSubmissions(list.query, signal), [list.query]);
  const columns = [
    { key: 'createdAt', header: 'When', sortKey: 'createdAt', render: (item) => formatDate(item.createdAt) },
    { key: 'team', header: 'Team', render: (item) => (item.team?.name ? <Link to={`/admin/teams?team=${encodeURIComponent(item.team.id)}`}>{item.team.name}</Link> : '(deleted)') },
    { key: 'user', header: 'Player', render: (item) => (item.user?.displayName ? <Link to={`/admin/users?user=${encodeURIComponent(item.user.id)}`}>{item.user.displayName}</Link> : '(deleted)') },
    { key: 'challenge', header: 'Challenge', render: (item) => challengeName(item.challenge) },
    { key: 'correct', header: 'Result', render: (item) => (item.correct ? <Badge tone="ok">Correct</Badge> : <Badge>Wrong</Badge>) },
  ];
  return <>
    <FilterBar label="Filter flag attempts" values={values} onChange={list.onChange} onReset={list.reset}
      fields={[...fields, { name: 'result', label: 'Result', type: 'select', initial: '', options: [{ value: '', label: 'Any' }, { value: 'correct', label: 'Correct' }, { value: 'wrong', label: 'Wrong' }] }, ...dateFields]} />
    <UserIdHint value={values.userId} />
    <DataTable caption="Flag attempts" columns={columns} rows={data?.items ?? []} loading={loading} error={error} onRetry={reload}
      sort={list.state.sort} onSort={list.setSort} emptyTitle="No attempts match" emptyHint="Attempts older than 30 days no longer exist."
      pagination={{ page: list.state.page, limit: list.state.limit, total: data?.total ?? 0, onPage: list.setPage, onLimit: list.setLimit }} />
  </>;
}
