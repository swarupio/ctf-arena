import { useState, useEffect, useRef, useCallback } from 'react';
import {
  getStats,
  getInstances,
  killInstance,
  getTeams,
  banTeam,
} from '../api/admin.js';

const POLL_MS = 15_000;

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, accent }) {
  return (
    <div style={{
      background: '#1a1a2e',
      borderRadius: 8,
      padding: '16px 20px',
      minWidth: 140,
      flex: '1 1 140px',
      borderLeft: `4px solid ${accent || '#4f8ef7'}`,
    }}>
      <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 1 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, margin: '4px 0' }}>{value ?? '—'}</div>
      {sub && <div style={{ fontSize: 11, color: '#666' }}>{sub}</div>}
    </div>
  );
}

// ─── Confirm-action button (requires double-click) ────────────────────────────

function ActionButton({ label, confirmLabel, onClick, danger }) {
  const [confirming, setConfirming] = useState(false);
  const timerRef = useRef(null);

  const handleClick = () => {
    if (!confirming) {
      setConfirming(true);
      timerRef.current = setTimeout(() => setConfirming(false), 3000);
    } else {
      clearTimeout(timerRef.current);
      setConfirming(false);
      onClick();
    }
  };

  useEffect(() => () => clearTimeout(timerRef.current), []);

  return (
    <button
      onClick={handleClick}
      style={{
        padding: '3px 10px',
        fontSize: 12,
        borderRadius: 4,
        border: 'none',
        cursor: 'pointer',
        background: confirming ? '#c0392b' : danger ? '#7b2c2c' : '#2c4a7b',
        color: '#fff',
        transition: 'background 0.2s',
      }}
    >
      {confirming ? (confirmLabel ?? 'Confirm?') : label}
    </button>
  );
}

// ─── Main Admin Dashboard ─────────────────────────────────────────────────────

export default function AdminDashboard() {
  const [stats, setStats] = useState(null);
  const [instances, setInstances] = useState([]);
  const [teams, setTeams] = useState([]);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [busyIds, setBusyIds] = useState(new Set());
  const intervalRef = useRef(null);

  const fetchAll = useCallback(async () => {
    try {
      const [s, inst, t] = await Promise.all([getStats(), getInstances(), getTeams()]);
      setStats(s);
      setInstances(inst);
      setTeams(t);
      setLastUpdated(new Date());
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    intervalRef.current = setInterval(fetchAll, POLL_MS);
    return () => clearInterval(intervalRef.current);
  }, [fetchAll]);

  // ── Kill instance ──
  const handleKill = async (id) => {
    setBusyIds((prev) => new Set(prev).add(id));
    try {
      await killInstance(id);
      setInstances((prev) => prev.filter((i) => i.id !== id));
    } catch (err) {
      alert(`Kill failed: ${err.message}`);
    } finally {
      setBusyIds((prev) => { const s = new Set(prev); s.delete(id); return s; });
    }
  };

  // ── Ban / unban team ──
  const handleBan = async (id, currentlyBanned) => {
    setBusyIds((prev) => new Set(prev).add(id));
    try {
      await banTeam(id, !currentlyBanned);
      setTeams((prev) =>
        prev.map((t) => (t.id === id ? { ...t, banned: !currentlyBanned } : t))
      );
    } catch (err) {
      alert(`Ban action failed: ${err.message}`);
    } finally {
      setBusyIds((prev) => { const s = new Set(prev); s.delete(id); return s; });
    }
  };

  const wrongRate = stats
    ? stats.submissions > 0
      ? ((stats.wrongRate ?? ((stats.submissions - stats.solves) / stats.submissions)) * 100).toFixed(1)
      : '0.0'
    : null;

  return (
    <section style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>⚙️ Admin Dashboard</h1>
        {lastUpdated && (
          <span style={{ fontSize: 12, color: '#888' }}>
            Updated {lastUpdated.toLocaleTimeString()} · auto-refreshes every 15s
          </span>
        )}
      </div>

      {error && <p className="error">{error}</p>}

      {/* ── Stats Cards ── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 28 }}>
        <StatCard label="Users" value={stats?.users} accent="#4f8ef7" />
        <StatCard label="Teams" value={stats?.teams} accent="#4fc98e" />
        <StatCard label="Solves" value={stats?.solves} accent="#f7c84f" />
        <StatCard label="Submissions" value={stats?.submissions} accent="#c44ff7" />
        <StatCard
          label="Wrong Flag Rate"
          value={wrongRate != null ? `${wrongRate}%` : '—'}
          accent="#f76f4f"
        />
        <StatCard label="Active Instances" value={stats?.activeInstances} accent="#4ff7f1" />
      </div>

      {/* ── Per-Replica Requests ── */}
      {stats?.requestsByReplica && Object.keys(stats.requestsByReplica).length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <h2 style={{ fontSize: 15, marginBottom: 8 }}>Requests by Replica</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #333', textAlign: 'left' }}>
                <th style={thS}>Replica ID</th>
                <th style={thS}>Requests Handled</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(stats.requestsByReplica).map(([replica, count]) => (
                <tr key={replica} style={{ borderBottom: '1px solid #222' }}>
                  <td style={tdS}><code style={{ fontSize: 12 }}>{replica}</code></td>
                  <td style={tdS}>{count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Active Instances ── */}
      <div style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 15, marginBottom: 8 }}>
          Active Instances ({instances.length})
        </h2>
        {instances.length === 0 ? (
          <p className="notice">No active instances.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #333', textAlign: 'left' }}>
                  <th style={thS}>Team</th>
                  <th style={thS}>Challenge</th>
                  <th style={thS}>Port</th>
                  <th style={thS}>Status</th>
                  <th style={thS}>Expires</th>
                  <th style={thS}>Action</th>
                </tr>
              </thead>
              <tbody>
                {instances.map((inst) => (
                  <tr key={inst.id} style={{ borderBottom: '1px solid #222', opacity: busyIds.has(inst.id) ? 0.5 : 1 }}>
                    <td style={tdS}>{inst.teamName ?? inst.teamId}</td>
                    <td style={tdS}>{inst.challengeName ?? inst.challengeId}</td>
                    <td style={tdS}>{inst.port}</td>
                    <td style={tdS}>
                      <span style={{
                        padding: '2px 8px',
                        borderRadius: 10,
                        fontSize: 11,
                        background: inst.status === 'running' ? '#1a4a1a' : '#4a1a1a',
                        color: inst.status === 'running' ? '#4fc98e' : '#f76f4f',
                      }}>
                        {inst.status}
                      </span>
                    </td>
                    <td style={{ ...tdS, fontSize: 12, color: '#888' }}>
                      {inst.expiresAt ? new Date(inst.expiresAt).toLocaleString() : '—'}
                    </td>
                    <td style={tdS}>
                      <ActionButton
                        label="Kill"
                        confirmLabel="Kill!"
                        danger
                        onClick={() => handleKill(inst.id)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Teams ── */}
      <div style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 15, marginBottom: 8 }}>Teams ({teams.length})</h2>
        {teams.length === 0 ? (
          <p className="notice">No teams yet.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #333', textAlign: 'left' }}>
                  <th style={thS}>Name</th>
                  <th style={thS}>Members</th>
                  <th style={thS}>Score</th>
                  <th style={thS}>Status</th>
                  <th style={thS}>Action</th>
                </tr>
              </thead>
              <tbody>
                {teams.map((team) => (
                  <tr
                    key={team.id}
                    style={{
                      borderBottom: '1px solid #222',
                      opacity: busyIds.has(team.id) ? 0.5 : 1,
                      background: team.banned ? '#2a1a1a' : 'transparent',
                    }}
                  >
                    <td style={{ ...tdS, fontWeight: 600 }}>{team.name}</td>
                    <td style={tdS}>{team.memberCount ?? team.members?.length ?? '—'}</td>
                    <td style={tdS}>{team.score ?? 0}</td>
                    <td style={tdS}>
                      {team.banned ? (
                        <span style={{ color: '#f76f4f', fontSize: 12 }}>🚫 Banned</span>
                      ) : (
                        <span style={{ color: '#4fc98e', fontSize: 12 }}>✓ Active</span>
                      )}
                    </td>
                    <td style={tdS}>
                      <ActionButton
                        label={team.banned ? 'Unban' : 'Ban'}
                        confirmLabel={team.banned ? 'Unban?' : 'Ban?'}
                        danger={!team.banned}
                        onClick={() => handleBan(team.id, team.banned)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

const thS = { padding: '8px 12px', color: '#aaa', fontWeight: 600, fontSize: 13 };
const tdS = { padding: '10px 12px', fontSize: 14 };
