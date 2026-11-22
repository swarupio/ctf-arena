import { useState } from 'react';
import { Link } from 'react-router-dom';
import { getOverview } from '../../api/admin.js';
import { sumSeries } from '../../admin/chart.js';
import { useAdminData } from '../../admin/hooks.js';
import { formatDay, formatNumber, formatPercent } from '../../admin/format.js';
import AsyncBlock from '../../components/admin/AsyncBlock.jsx';
import DataTable from '../../components/admin/DataTable.jsx';
import EventSummary, { EventSummarySkeleton } from '../../components/admin/EventSummary.jsx';
import PageHeader, { Badge, Panel } from '../../components/admin/PageHeader.jsx';
import StatCard, { StatGrid } from '../../components/admin/StatCard.jsx';
import { SvgBarChart, SvgLineChart } from '../../components/admin/SvgCharts.jsx';

const RANGES = [7, 30, 90];
export const OVERVIEW_POLL_MS = 15_000;

const SIGNUPS = [{ key: 'signups', label: 'Signups', className: 'adm-s1' }];
const SUBMISSIONS = [
  { key: 'submissions', label: 'Submissions', className: 'adm-s2' },
  { key: 'wrongSubmissions', label: 'Wrong flags', className: 'adm-s4' },
];
const SOLVES = [{ key: 'solves', label: 'Solves', className: 'adm-s3' }];

const challengeColumns = [
  { key: 'title', header: 'Challenge', render: (item) => <><strong>{item.title}</strong> <span className="adm-muted">{item.category}, {item.difficulty}</span></> },
  { key: 'points', header: 'Points', align: 'right', render: (item) => formatNumber(item.points) },
  { key: 'solves', header: 'Solves', align: 'right', render: (item) => formatNumber(item.solves) },
  { key: 'solveRate', header: 'Solve rate', align: 'right', render: (item) => formatPercent(item.solveRate) },
  { key: 'submissions', header: 'Attempts', align: 'right', render: (item) => formatNumber(item.submissions) },
  { key: 'wrongRate', header: 'Wrong rate', align: 'right', render: (item) => formatPercent(item.wrongRate) },
];

const terminalColumns = [
  { key: 'mode', header: 'Mode', render: (row) => <strong>{row.mode}</strong> },
  { key: 'codes', header: 'Flags', align: 'right', render: (row) => formatNumber(row.codes) },
  { key: 'teamsPlaying', header: 'Teams playing', align: 'right', render: (row) => formatNumber(row.teamsPlaying) },
  { key: 'completions', header: 'Completions', align: 'right', render: (row) => formatNumber(row.completions) },
  { key: 'averageScore', header: 'Average score', align: 'right', render: (row) => formatNumber(Math.round((row.averageScore ?? 0) * 10) / 10) },
  { key: 'maxScore', header: 'Best score', align: 'right', render: (row) => formatNumber(row.maxScore) },
];

const STAT_LABELS = ['Users', 'Teams', 'Solves', 'Submissions', 'Wrong flags', 'Active instances'];

// The first load: the Event panel and the six stat cards at their final size (no list of lines that turns into the real page).
function OverviewSkeleton() {
  return <div className="adm-loading" aria-busy="true">
    <p role="status" className="adm-sr">Loading the overview</p>
    <EventSummarySkeleton />
    <StatGrid label="Platform totals">
      {STAT_LABELS.map((label) => <StatCard key={label} label={label} value="0000" hint={label === 'Submissions' ? 'last 30 days kept' : ''} loading />)}
    </StatGrid>
  </div>;
}

export default function Overview() {
  const [days, setDays] = useState(14);
  const { data, error, loading, updatedAt, reload, refresh } = useAdminData((signal) => getOverview(days, signal), [days], { pollMs: OVERVIEW_POLL_MS });
  const totals = data?.totals ?? {};
  const series = data?.series ?? [];
  const docker = data?.instances?.dockerEnabled !== false;
  const topTeams = (data?.topTeams ?? []).map((team) => ({ key: team.id, label: team.name, value: team.score, text: `${formatNumber(team.score)} pts` }));

  return <>
    <PageHeader title="Overview" intro="Live numbers for the whole platform.">
      <div className="adm-range" role="group" aria-label="Chart range">
        {RANGES.map((value) => <button key={value} type="button" className={`small${value === days ? '' : ' secondary'}`} aria-pressed={value === days} onClick={() => setDays(value)}>{value} days</button>)}
      </div>
      <button type="button" className="secondary small" onClick={refresh}>Refresh now</button>
    </PageHeader>
    <p className="adm-muted adm-meta" role="status">{updatedAt ? `Updated ${new Date(updatedAt).toLocaleTimeString()}` : 'Loading…'} &middot; refreshes every {OVERVIEW_POLL_MS / 1000} s while this tab is visible</p>

    <AsyncBlock loading={loading} error={error} hasData={Boolean(data)} onRetry={reload} label="the overview" fallback={<OverviewSkeleton />}>
      {error && <p role="alert" className="error">{error}</p>}
      <EventSummary />
      <StatGrid label="Platform totals">
        <StatCard label="Users" value={formatNumber(totals.users)} to="/admin/users" hint={totals.bannedUsers ? `${formatNumber(totals.bannedUsers)} banned` : ''} />
        <StatCard label="Teams" value={formatNumber(totals.teams)} to="/admin/teams" hint={totals.bannedTeams ? `${formatNumber(totals.bannedTeams)} banned` : ''} />
        <StatCard label="Solves" value={formatNumber(totals.solves)} to="/admin/activity" />
        <StatCard label="Submissions" value={formatNumber(totals.submissions)} to="/admin/activity?tab=submissions" hint="last 30 days kept" />
        <StatCard label="Wrong flags" value={formatPercent(totals.wrongRate)} />
        <StatCard label="Active instances" value={docker ? formatNumber(data?.instances?.active ?? totals.activeInstances) : 'Off'} hint={docker ? '' : 'Docker disabled'} to="/admin/instances" tone={docker ? '' : 'muted'} />
      </StatGrid>

      <div className="adm-grid-2">
        <Panel title={`Signups per day (${sumSeries(series, 'signups')} in ${days} days)`} id="ov-signups">
          <SvgLineChart rows={series} series={SIGNUPS} formatX={formatDay} label={`Signups per day, last ${days} days`} />
        </Panel>
        <Panel title={`Solves per day (${sumSeries(series, 'solves')} in ${days} days)`} id="ov-solves">
          <SvgLineChart rows={series} series={SOLVES} formatX={formatDay} label={`Solves per day, last ${days} days`} />
        </Panel>
      </div>
      <Panel title={`Submissions per day (${sumSeries(series, 'submissions')} in ${days} days)`} id="ov-subs">
        <SvgLineChart rows={series} series={SUBMISSIONS} formatX={formatDay} label={`Submissions and wrong flags per day, last ${days} days`} />
      </Panel>

      <div className="adm-grid-2">
        <Panel title="Top teams" id="ov-top">
          {topTeams.length === 0
            ? <p className="adm-muted">No team has scored yet.</p>
            : <>
              <SvgBarChart items={topTeams} label="Top teams by score" className="adm-bar-accent" />
              <p className="adm-muted"><Link to="/admin/teams">Open all teams</Link></p>
            </>}
        </Panel>
        <Panel title="Instances" id="ov-instances">
          {docker
            ? ((data?.instances?.active ?? 0) > 0
              ? <><p><strong>{formatNumber(data.instances.active)}</strong> active challenge containers.</p><p><Link to="/admin/instances">Manage instances</Link></p></>
              : <div className="adm-state"><p><strong>No containers running</strong></p><p className="adm-muted">Containers appear here while players run Docker challenges.</p><p><Link to="/admin/instances">Open instances</Link></p></div>)
            : <div className="adm-state"><p><Badge tone="muted">Docker disabled</Badge></p><p className="adm-muted">This server runs with DOCKER_ENABLED=false, so no containers are started or counted.</p></div>}
        </Panel>
      </div>

      <Panel title="Hardest challenges" id="ov-hard">
        <DataTable caption="Hardest challenges" columns={challengeColumns} rows={data?.challenges?.hardest ?? []} emptyTitle="No visible challenges yet" />
      </Panel>
      <Panel title="Easiest challenges" id="ov-easy">
        <DataTable caption="Easiest challenges" columns={challengeColumns} rows={data?.challenges?.easiest ?? []} emptyTitle="No visible challenges yet" />
      </Panel>
      <Panel title="Wrong-flag rate per challenge" id="ov-wrong">
        <DataTable caption="Wrong-flag rate per challenge" columns={challengeColumns} rows={data?.challenges?.wrongRates ?? []}
          emptyTitle="No attempts recorded yet" emptyHint="Attempts are kept for 30 days." />
      </Panel>
      <Panel title="Arena Terminal per mode" id="ov-terminal">
        <DataTable caption="Terminal statistics per mode" columns={terminalColumns} rows={data?.terminal?.modes ?? []} rowKey={(row) => row.mode}
          emptyTitle="The Arena Terminal is not seeded" emptyHint="Run npm run seed:terminal on the backend." />
      </Panel>
    </AsyncBlock>
  </>;
}
