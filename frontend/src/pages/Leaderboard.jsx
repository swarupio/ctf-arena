import { useState, useEffect, useRef, useCallback } from 'react';
import { getLeaderboard, getTimeline } from '../api/leaderboard.js';
import { useTeam } from '../layout/TeamContext.jsx';

const POLL_MS = 10_000;
const MAX_CHART_TEAMS = 10;

// ─── SVG Score-Over-Time Chart ───────────────────────────────────────────────

function TimelineChart({ data }) {
  const W = 700, H = 260, PAD = { top: 16, right: 130, bottom: 40, left: 52 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  if (!data || data.teams.length === 0) {
    return <p className="notice">No timeline data yet.</p>;
  }

  const teams = data.teams.slice(0, MAX_CHART_TEAMS);

  // Gather all timestamps and scores
  const allTimes = teams.flatMap((t) => t.points.map((p) => new Date(p.t).getTime()));
  const allScores = teams.flatMap((t) => t.points.map((p) => p.score));

  if (allTimes.length === 0) return <p className="notice">No solve events yet.</p>;

  const tMin = Math.min(...allTimes);
  const tMax = Math.max(...allTimes) || tMin + 1;
  const sMax = Math.max(...allScores, 1);

  const tx = (t) => ((new Date(t).getTime() - tMin) / (tMax - tMin)) * innerW;
  const ty = (s) => innerH - (s / sMax) * innerH;

  const COLORS = [
    '#4f8ef7','#f76f4f','#4fc98e','#f7c84f','#c44ff7',
    '#4ff7f1','#f74fa8','#a8f74f','#f7a84f','#4f6af7',
  ];

  // Y axis ticks
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((r) => Math.round(r * sMax));

  // X axis ticks (up to 5)
  const xTicks = [];
  for (let i = 0; i <= 4; i++) {
    const t = tMin + (i / 4) * (tMax - tMin);
    xTicks.push(t);
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: '100%', maxWidth: W, display: 'block', fontFamily: 'inherit' }}
        aria-label="Score over time chart"
      >
        <g transform={`translate(${PAD.left},${PAD.top})`}>
          {/* Grid lines */}
          {yTicks.map((v) => (
            <line key={v} x1={0} y1={ty(v)} x2={innerW} y2={ty(v)}
              stroke="#333" strokeWidth={0.5} strokeDasharray="4 3" />
          ))}

          {/* Y axis labels */}
          {yTicks.map((v) => (
            <text key={v} x={-6} y={ty(v) + 4} textAnchor="end"
              fontSize={10} fill="#aaa">{v}</text>
          ))}

          {/* X axis labels */}
          {xTicks.map((t, i) => (
            <text key={i} x={tx(t)} y={innerH + 18} textAnchor="middle"
              fontSize={9} fill="#aaa">
              {new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </text>
          ))}

          {/* Axes */}
          <line x1={0} y1={0} x2={0} y2={innerH} stroke="#555" strokeWidth={1} />
          <line x1={0} y1={innerH} x2={innerW} y2={innerH} stroke="#555" strokeWidth={1} />

          {/* Team lines */}
          {teams.map((team, idx) => {
            const color = COLORS[idx % COLORS.length];
            const pts = team.points;
            if (pts.length === 0) return null;

            const d = pts
              .map((p, i) => `${i === 0 ? 'M' : 'L'}${tx(p.t)},${ty(p.score)}`)
              .join(' ');

            return (
              <g key={team.teamId}>
                <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
                {pts.map((p, i) => (
                  <circle key={i} cx={tx(p.t)} cy={ty(p.score)} r={3} fill={color} />
                ))}
              </g>
            );
          })}

          {/* Legend */}
          {teams.map((team, idx) => {
            const color = COLORS[idx % COLORS.length];
            const ly = idx * 18;
            return (
              <g key={team.teamId} transform={`translate(${innerW + 10},${ly})`}>
                <rect width={10} height={10} fill={color} rx={2} />
                <text x={14} y={9} fontSize={10} fill="#ccc"
                  style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {team.teamName.length > 12 ? team.teamName.slice(0, 12) + '…' : team.teamName}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}

// ─── Main Leaderboard Component ───────────────────────────────────────────────

export default function Leaderboard() {
  const { team: myTeam } = useTeam();
  const [board, setBoard] = useState([]);
  const [timeline, setTimeline] = useState(null);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const intervalRef = useRef(null);

  const fetchAll = useCallback(async () => {
    try {
      const [lb, tl] = await Promise.all([getLeaderboard(), getTimeline()]);
      setBoard(lb);
      setTimeline(tl);
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

  const myTeamId = myTeam?.id;

  return (
    <section style={{ maxWidth: 860, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, marginBottom: 8 }}>
        <h1 style={{ margin: 0 }}>🏆 Leaderboard</h1>
        {lastUpdated && (
          <span style={{ fontSize: 12, color: '#888' }}>
            Updated {lastUpdated.toLocaleTimeString()}
          </span>
        )}
      </div>

      {error && <p className="error">{error}</p>}

      {/* Score-Over-Time Chart */}
      <div style={{ background: '#1a1a2e', borderRadius: 8, padding: 16, marginBottom: 24 }}>
        <h2 style={{ marginTop: 0, fontSize: 15, color: '#aaa' }}>Score Over Time (top {MAX_CHART_TEAMS})</h2>
        <TimelineChart data={timeline} />
      </div>

      {/* Rankings Table */}
      {board.length === 0 && !error ? (
        <p className="notice">No solves yet — be the first to plant your flag!</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #333', textAlign: 'left' }}>
              <th style={thStyle}>#</th>
              <th style={thStyle}>Team</th>
              <th style={thStyle}>Points</th>
              <th style={thStyle}>Solves</th>
              <th style={thStyle}>Last Solve</th>
            </tr>
          </thead>
          <tbody>
            {board.map((entry) => {
              const isMe = myTeamId && entry.teamId === myTeamId;
              return (
                <tr
                  key={entry.teamId}
                  style={{
                    background: isMe ? '#1a3a1a' : 'transparent',
                    borderBottom: '1px solid #222',
                  }}
                >
                  <td style={tdStyle}>
                    {entry.rank === 1 ? '🥇' : entry.rank === 2 ? '🥈' : entry.rank === 3 ? '🥉' : entry.rank}
                  </td>
                  <td style={{ ...tdStyle, fontWeight: isMe ? 700 : 400 }}>
                    {entry.teamName}
                    {isMe && <span style={{ marginLeft: 6, fontSize: 11, color: '#4fc98e' }}>← you</span>}
                  </td>
                  <td style={tdStyle}>{entry.points}</td>
                  <td style={tdStyle}>{entry.solves}</td>
                  <td style={{ ...tdStyle, fontSize: 12, color: '#888' }}>
                    {entry.lastSolveAt ? new Date(entry.lastSolveAt).toLocaleString() : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

const thStyle = { padding: '8px 12px', color: '#aaa', fontWeight: 600, fontSize: 13 };
const tdStyle = { padding: '10px 12px', fontSize: 14 };
