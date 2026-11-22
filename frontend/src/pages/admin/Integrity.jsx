import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { dismissIntegrity, getIntegritySummary, listIntegrityUsers, resolveIntegrity } from '../../api/admin.js';
import { useAct, useAdminData, useListState } from '../../admin/hooks.js';
import { validateReason } from '../../admin/forms.js';
import { formatDate, formatNumber, timeAgo } from '../../admin/format.js';
import {
  EVIDENCE_NOTE, SIGNAL_KINDS, kindHelp, kindLabel, severityLevel, signalCount,
} from '../integrityHelpers.js';
import Info from '../../components/Info.jsx';
import AsyncBlock from '../../components/admin/AsyncBlock.jsx';
import ConfirmDialog from '../../components/admin/ConfirmDialog.jsx';
import DataTable from '../../components/admin/DataTable.jsx';
import Drawer from '../../components/admin/Drawer.jsx';
import FilterBar from '../../components/admin/FilterBar.jsx';
import PageHeader, { Badge, Panel } from '../../components/admin/PageHeader.jsx';
import StatCard, { StatGrid } from '../../components/admin/StatCard.jsx';

const FILTERS = [
  { name: 'q', label: 'Search player or team', type: 'search', maxLength: 100, initial: '' },
  { name: 'kind', label: 'Signal kind', type: 'select', initial: '', options: [{ value: '', label: 'Any kind' }, ...Object.keys(SIGNAL_KINDS).map((kind) => ({ value: kind, label: kindLabel(kind) }))] },
  { name: 'minRisk', label: 'Minimum risk', type: 'text', maxLength: 4, placeholder: '0', initial: '' },
];

// minRisk must be a whole number; anything else is not sent.
const mapFilters = (values) => ({ ...values, minRisk: /^\d{1,4}$/.test(String(values.minRisk).trim()) ? String(values.minRisk).trim() : '' });
const isAnonymous = (entry) => !entry.userId;

export default function Integrity() {
  const [params] = useSearchParams();
  const list = useListState({ sort: '-risk', q: params.get('q') ?? '', filters: { kind: '', minRisk: '' }, mapFilters });
  const [selected, setSelected] = useState(null);
  const summary = useAdminData((signal) => getIntegritySummary(signal), []);
  const { data, error, loading, reload } = useAdminData((signal) => listIntegrityUsers(list.query, signal), [list.query]);
  const threshold = summary.data?.highRiskThreshold ?? 10;
  const entry = selected ? (data?.items ?? []).find((item) => (item.userId ?? 'anonymous') === selected) : null;

  const columns = [
    { key: 'player', header: 'Player', render: (item) => <strong>{isAnonymous(item) ? 'Anonymous scrapers' : item.displayName}</strong> },
    { key: 'team', header: 'Team', render: (item) => item.teamName ?? '–' },
    { key: 'risk', header: 'Risk', sortKey: 'risk', align: 'right', render: (item) => <>{formatNumber(item.risk)} {item.risk >= threshold && <Badge tone="danger">High</Badge>}</> },
    { key: 'signals', header: 'Signals', render: (item) => <span className="adm-tags">{item.signals.map((signal) => <Badge key={`${signal.kind}:${signal.detail}`}>{kindLabel(signal.kind)}{signalCount(signal) > 1 ? ` x${signalCount(signal)}` : ''}</Badge>)}</span> },
    { key: 'lastSignalAt', header: 'Last signal', sortKey: 'lastSignalAt', render: (item) => timeAgo(item.lastSignalAt) },
    { key: 'actions', header: <span className="adm-sr">Actions</span>, render: (item) => <button type="button" className="secondary small" onClick={() => setSelected(item.userId ?? 'anonymous')}>Review<span className="adm-sr"> {item.displayName}</span></button> },
  ];

  const info = summary.data;
  return <>
    <PageHeader title="Fair play" intro={EVIDENCE_NOTE} />
    <AsyncBlock loading={summary.loading} error={summary.error} hasData={Boolean(info)} onRetry={summary.reload} label="the summary" lines={2}>
      {info && <>
        <StatGrid label="Fair-play summary">
          <StatCard label="Flagged users" value={formatNumber(info.flaggedUsers)} tone={info.flaggedUsers ? 'warn' : ''} />
          <StatCard label="Signal rows" value={formatNumber(info.signalRows)} />
          <StatCard label="Signal events" value={formatNumber(info.signalEvents)} />
          <StatCard label="Active last 24 h" value={formatNumber(info.activeLast24h)} />
        </StatGrid>
        <Panel title="Signals by kind" id="integrity-kinds">
          <ul className="adm-list">{info.byKind.map((row) => <li key={row.kind}>
            <span title={kindHelp(row.kind)}><strong>{kindLabel(row.kind)}</strong> <span className="adm-muted adm-mono">{row.kind}</span> <Info label={kindLabel(row.kind)}>{kindHelp(row.kind)}</Info></span>
            <span>{formatNumber(row.rows)} users/rows &middot; {formatNumber(row.events)} events &middot; {row.lastAt ? timeAgo(row.lastAt) : 'never'}</span>
          </li>)}</ul>
          <p className="adm-muted">High risk is {threshold} or more (severity times events, up to 5 per signal).</p>
        </Panel>
      </>}
    </AsyncBlock>

    <FilterBar label="Filter fair-play entries" fields={FILTERS} values={list.values} onChange={list.onChange} onReset={list.reset} />
    <DataTable caption="Fair-play entries" columns={columns} rows={data?.items ?? []} rowKey={(item) => item.userId ?? 'anonymous'} loading={loading} error={error} onRetry={reload}
      sort={list.state.sort} onSort={list.setSort} emptyTitle="Nobody is flagged" emptyHint="No signals match these filters."
      pagination={{ page: list.state.page, limit: list.state.limit, total: data?.total ?? 0, onPage: list.setPage, onLimit: list.setLimit }} />

    <Drawer open={Boolean(selected)} title="Fair-play review" onClose={() => setSelected(null)} wide>
      {selected && (entry
        ? <Review entry={entry} onChanged={async () => { await Promise.all([reload(), summary.reload()]); }} onDone={() => setSelected(null)} />
        : <p className="adm-muted">This entry is no longer on the current page.</p>)}
    </Drawer>
  </>;
}

function Review({ entry, onChanged, onDone }) {
  const act = useAct();
  const [dialog, setDialog] = useState('');
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);
  const problem = validateReason(note, { min: 3, max: 500 });
  const close = () => { setDialog(''); setNote(''); setTouched(false); };
  const name = isAnonymous(entry) ? 'Anonymous scrapers' : entry.displayName;

  async function resolve() {
    setTouched(true);
    if (problem) return;
    const outcome = await act.run('resolve', () => resolveIntegrity(entry.userId, note.trim()), {
      success: (result) => `Resolved: ${result.resolved.signals} signals cleared.`, after: onChanged,
    });
    if (outcome.ok) { close(); onDone(); }
  }
  async function dismiss() {
    const outcome = await act.run('dismiss', () => dismissIntegrity(entry.userId), { success: 'Signals dismissed.', after: onChanged });
    if (outcome.ok) { close(); onDone(); }
  }

  return <>
    <h3 className="adm-h3">{name}</h3>
    <dl className="adm-facts">
      {[['Team', entry.teamName ?? '–'], ['Risk', formatNumber(entry.risk)], ['Last signal', formatDate(entry.lastSignalAt)]]
        .map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
    </dl>
    <p className="adm-muted">{EVIDENCE_NOTE} Resolving or dismissing never bans anyone; use the user or team pages for that.</p>
    {!isAnonymous(entry) && <p><Link to={`/admin/users?user=${encodeURIComponent(entry.userId)}`}>Open the user</Link></p>}

    <h4 className="adm-h4">Signals</h4>
    <ul className="adm-list">{entry.signals.map((signal) => <li key={`${signal.kind}:${signal.detail}`}>
      <span>
        <strong>{kindLabel(signal.kind)}</strong> <Badge tone={severityLevel(signal.severity) === 'high' ? 'danger' : ''}>severity {String(signal.severity)}</Badge><br />
        <span className="adm-muted">{kindHelp(signal.kind)}</span>
        {signal.detail && <><br />Detail: <code>{signal.detail}</code></>}
      </span>
      <span>{signalCount(signal)} time(s)<br /><span className="adm-muted">first {formatDate(signal.firstAt)}<br />last {formatDate(signal.lastAt)}</span></span>
    </li>)}</ul>

    {isAnonymous(entry)
      ? <p className="adm-muted">Signals of callers that are not signed in cannot be resolved individually.</p>
      : <div className="adm-actions-row">
        <button type="button" disabled={act.busy} onClick={() => setDialog('resolve')}>Resolve with note</button>
        <button type="button" className="secondary" disabled={act.busy} onClick={() => setDialog('dismiss')}>Dismiss signals</button>
      </div>}

    <ConfirmDialog open={dialog === 'resolve'} title={`Resolve ${name}?`} confirmLabel="Resolve" pending={act.isPending('resolve')} canConfirm={!problem} onCancel={close} onConfirm={resolve}>
      <p>Clears the player&apos;s signals and records your note in the audit log. New suspicious activity will show up again.</p>
      <label>Note (required, 3-500 characters)
        <textarea rows={3} value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} aria-invalid={touched && Boolean(problem)} />
        {touched && problem && <span className="adm-field-error">{problem}</span>}
      </label>
    </ConfirmDialog>
    <ConfirmDialog open={dialog === 'dismiss'} danger title={`Dismiss the signals of ${name}?`} confirmLabel="Dismiss" pending={act.isPending('dismiss')} onCancel={close} onConfirm={dismiss}>
      <p>Deletes every signal recorded for this player without a note (the action itself is audited). Prefer &ldquo;Resolve with note&rdquo; when you reviewed them.</p>
    </ConfirmDialog>
  </>;
}
