import { useEffect, useRef, useState } from 'react';
import { fetchDashboard, killInstance, setTeamBanned } from '../api/admin.js';
import {
  REFRESH_MS, adminErrorMessage, banPrompt, challengeLabel, formatNumber, formatPercent, formatTimeLeft,
  killPrompt, nameOrDeleted, replicaRows, requestTotal, startPolling,
} from './adminHelpers.js';
import AdminIntegrity from './AdminIntegrity.jsx';
import './AdminDashboard.css';

export default function AdminDashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyKey, setBusyKey] = useState(null);
  const [updatedAt, setUpdatedAt] = useState(null);
  const refreshRef = useRef(async () => {});
  const actionLock = useRef(false);

  useEffect(() => {
    let alive = true;
    let inflight = false;
    let again = false;
    // Overlapping calls (a poll plus a Kill click) collapse into one extra fetch after the current one.
    async function refresh() {
      if (inflight) { again = true; return; }
      inflight = true;
      try {
        do {
          again = false;
          try {
            const next = await fetchDashboard();
            if (!alive) return;
            setData(next);
            setError('');
            setUpdatedAt(Date.now());
          } catch (failure) {
            if (alive) setError(adminErrorMessage(failure, 'Could not load the dashboard.'));
          }
        } while (again && alive);
      } finally { inflight = false; }
    }
    refreshRef.current = refresh;
    refresh();
    const stopPolling = startPolling(refresh, { intervalMs: REFRESH_MS });
    return () => { alive = false; stopPolling(); };
  }, []);

  async function act(key, action, success, notFoundMessage) {
    if (actionLock.current) return;
    actionLock.current = true;
    setBusyKey(key);
    setError('');
    setNotice('');
    try {
      await action();
      setNotice(success);
    } catch (failure) {
      setError(failure?.code === 'NOT_FOUND' ? notFoundMessage : adminErrorMessage(failure));
    } finally {
      actionLock.current = false;
      setBusyKey(null);
      refreshRef.current();
    }
  }

  function kill(instance) {
    if (!window.confirm(killPrompt(instance))) return;
    act(`kill:${instance.id}`, () => killInstance(instance.id), 'Instance stopped.', 'That instance is already stopped.');
  }

  function toggleBan(team) {
    const banned = !team.banned;
    if (banned && !window.confirm(banPrompt(team))) return;
    act(
      `ban:${team.id}`, () => setTeamBanned(team.id, banned),
      banned ? `Team "${team.name}" banned and its instances stopped.` : `Team "${team.name}" unbanned.`,
      'That team no longer exists.',
    );
  }

  if (!data) {
    return <section className="adm">
      <h1>Admin dashboard</h1>
      {error
        ? <><p role="alert" className="error">{error}</p><button onClick={() => refreshRef.current()}>Try again</button></>
        : <p role="status">Loading dashboard…</p>}
    </section>;
  }

  const { stats, instances, teams } = data;
  const replicas = replicaRows(stats.requestsByReplica);
  const now = Date.now();
  const cards = [
    ['Users', formatNumber(stats.users)],
    ['Teams', formatNumber(stats.teams)],
    ['Solves', formatNumber(stats.solves)],
    ['Submissions', formatNumber(stats.submissions)],
    ['Wrong flags', formatPercent(stats.wrongRate)],
    ['Active instances', formatNumber(stats.activeInstances)],
  ];

  return <section className="adm">
    <div className="adm-head">
      <h1>Admin dashboard</h1>
      <div className="adm-meta">
        <span>{updatedAt ? `Updated ${new Date(updatedAt).toLocaleTimeString()}` : 'Not updated yet'} · refreshes every {REFRESH_MS / 1000} s</span>
        <button className="secondary" onClick={() => refreshRef.current()}>Refresh now</button>
      </div>
    </div>

    {error && <p role="alert" className="error">{error}</p>}
    {notice && <p role="status" className="notice">{notice}</p>}

    <ul className="adm-cards" aria-label="Platform statistics">
      {cards.map(([label, value]) => <li key={label} className="adm-card">
        <span className="adm-card-value">{value}</span>
        <span className="adm-card-label">{label}</span>
      </li>)}
    </ul>

    <h2>Requests by replica</h2>
    {replicas.length === 0
      ? <p className="adm-empty">No requests counted yet. Totals appear a few seconds after the first API call.</p>
      : <ul className="adm-replicas">
        {replicas.map((row) => <li key={row.replica}>
          <span className="adm-replica-name">{row.replica}</span>
          <span className="adm-replica-count">{formatNumber(row.requests)} · {formatPercent(row.share)}</span>
          <span className="adm-bar" aria-hidden="true"><span style={{ width: `${Math.round(row.share * 100)}%` }} /></span>
        </li>)}
        <li className="adm-replica-total">{formatNumber(requestTotal(replicas))} requests in total</li>
      </ul>}

    <h2>Active instances</h2>
    {instances.length === 0
      ? <p className="adm-empty">No instances are running right now.</p>
      : <div className="adm-scroll" role="region" aria-label="Active instances" tabIndex={0}>
        <table className="adm-table">
          <thead><tr><th>Team</th><th>Challenge</th><th>Status</th><th>Port</th><th>Time left</th><th>Extended</th><th><span className="adm-sr">Actions</span></th></tr></thead>
          <tbody>{instances.map((instance) => <tr key={instance.id}>
            <td className="adm-name" data-label="Team">{nameOrDeleted(instance.team?.name)}</td>
            <td className="adm-name" data-label="Challenge">{challengeLabel(instance.challenge)}</td>
            <td data-label="Status">{instance.status}</td>
            <td data-label="Port"><a href={instance.url} target="_blank" rel="noreferrer">{instance.port}</a></td>
            <td data-label="Time left">{formatTimeLeft(instance.expiresAt, now)}</td>
            <td data-label="Extended">{instance.extended ? 'yes' : 'no'}</td>
            <td className="adm-actions"><button className="secondary" disabled={busyKey !== null} onClick={() => kill(instance)}>{busyKey === `kill:${instance.id}` ? 'Killing…' : 'Kill'}</button></td>
          </tr>)}</tbody>
        </table>
      </div>}

    <h2>Teams</h2>
    {teams.length === 0
      ? <p className="adm-empty">No teams have been created yet.</p>
      : <div className="adm-scroll" role="region" aria-label="Teams" tabIndex={0}>
        <table className="adm-table">
          <thead><tr><th>Team</th><th>Members</th><th>Solves</th><th>Score</th><th>Status</th><th><span className="adm-sr">Actions</span></th></tr></thead>
          <tbody>{teams.map((team) => <tr key={team.id}>
            <td className="adm-name" data-label="Team">{team.name}</td>
            <td data-label="Members">{team.members}/3</td>
            <td data-label="Solves">{formatNumber(team.solves)}</td>
            <td data-label="Score">{formatNumber(team.score)}</td>
            <td data-label="Status">{team.banned ? <span className="adm-badge adm-banned">Banned</span> : 'Active'}</td>
            <td className="adm-actions"><button className="secondary" disabled={busyKey !== null} onClick={() => toggleBan(team)}>
              {busyKey === `ban:${team.id}` ? 'Saving…' : team.banned ? 'Unban' : 'Ban'}
            </button></td>
          </tr>)}</tbody>
        </table>
      </div>}

    <h2>Fair play</h2>
    <AdminIntegrity />
  </section>;
}
