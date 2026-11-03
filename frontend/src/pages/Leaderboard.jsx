import { useEffect, useMemo, useRef, useState } from 'react';
import { getLeaderboard, getTimeline } from '../api/leaderboard.js';
import { useTeam } from '../layout/TeamContext.jsx';
import {
  assignSeriesStyles, buildChart, findMyStanding, formatTick, hasSolves, isMyTeam,
  leaderboardErrorMessage, scoresAt, snapToTime, sortStandings,
} from './leaderboardHelpers.js';
import { POLL_INTERVAL_MS, startPolling } from './poller.js';
import './Leaderboard.css';

const TIP_WIDTH = 210;
const EMPTY ={ standings: null, timeline: null, updatedAt: null, error: '', chartError: '' };

function useElementWidth(ref) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const update = () => setWidth(Math.round(element.getBoundingClientRect().width));
    update();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

function LineKey({ style, width = 22 }) {
  return <svg className="lb-key" width={width} height="10" viewBox={`0 0 ${width} 10`} aria-hidden="true">
    <line x1="0" y1="5" x2={width} y2="5" stroke={style.color} strokeWidth="3" strokeDasharray={style.dash || undefined} />
  </svg>;
}

function ScoreChart({ teams, myTeamId }) {
  const wrapRef = useRef(null);
  const measured = useElementWidth(wrapRef);
  const [hover, setHover] = useState(null);
  const [focused, setFocused] = useState(null);

  const width = Math.max(260, measured || 600);
  const height = Math.round(Math.min(340, Math.max(220, width * 0.5)));
  const chart = useMemo(
    () => buildChart(teams, { width, height, xTickCount: width < 480 ? 3 : 5 }),
    [teams, width, height],
  );
  const styles = useMemo(() => assignSeriesStyles(teams), [teams]);
  const span = chart.tMax - chart.tMin;
  const { plot } = chart;

  // Draw highlighted lines last so they sit on top.
  const emphasised = (line) => line.teamId === focused || (focused === null && isMyTeam(line, myTeamId));
  const drawOrder = [...chart.series].sort((a, b) => Number(emphasised(a)) - Number(emphasised(b)));

  const readout = hover ? { ...hover, rows: scoresAt(chart, hover.ms) } : null;
  // Fixed-width readout beside the crosshair, flipped to its left near the right edge, always inside the chart.
  const tipWidth = Math.min(TIP_WIDTH, width - 16);
  const tipLeft = readout ? Math.min(Math.max(0, readout.x + 12 + tipWidth > width ? readout.x - 12 - tipWidth : readout.x + 12), width - tipWidth) : 0;
  function onPointer(event) {
    const box = event.currentTarget.ownerSVGElement.getBoundingClientRect();
    const snapped = snapToTime(chart, event.clientX - box.left);
    setHover(snapped);
  }

  return <div className="lb-chart-wrap">
    <div className="lb-chart" ref={wrapRef}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img"
        aria-label={`Score over time for the top ${teams.length} teams. The standings table lists the same scores.`}>
        <g className="lb-grid">
          {chart.yTicks.map((tick) => <line key={tick.value} x1={plot.left} x2={plot.right} y1={tick.y} y2={tick.y} />)}
        </g>
        <g className="lb-axis">
          <line x1={plot.left} x2={plot.right} y1={plot.bottom} y2={plot.bottom} />
          {chart.yTicks.map((tick) => <text key={tick.value} x={plot.left - 8} y={tick.y} textAnchor="end" dominantBaseline="middle">{tick.value}</text>)}
          {chart.xTicks.map((tick) => <text key={tick.ms} x={tick.x} y={plot.bottom + 18} textAnchor={tick.anchor}>{formatTick(tick.ms, span)}</text>)}
        </g>
        {drawOrder.map((line) => {
          const style = styles.get(line.teamId);
          const strong = emphasised(line);
          const dim = focused !== null && !strong;
          return <g key={line.teamId} opacity={dim ? 0.25 : 1}>
            <path className="lb-line" d={line.path} stroke={style.color} strokeWidth={strong ? 3.5 : 2} strokeDasharray={style.dash || undefined} />
            <circle className="lb-dot" cx={line.end.x} cy={line.end.y} r="5" fill={style.color} />
          </g>;
        })}
        {readout && <g className="lb-hover" pointerEvents="none">
          <line className="lb-crosshair" x1={readout.x} x2={readout.x} y1={plot.top} y2={plot.bottom} />
          {readout.rows.map((row) => <circle className="lb-dot" key={row.teamId} cx={readout.x} cy={row.y} r="5" fill={styles.get(row.teamId).color} />)}
        </g>}
        <rect className="lb-hit" x={plot.left} y={plot.top} width={plot.right - plot.left} height={plot.bottom - plot.top}
          fill="transparent" onPointerMove={onPointer} onPointerDown={onPointer} onPointerLeave={() => setHover(null)} onPointerCancel={() => setHover(null)} />
      </svg>
      {readout && <div className="lb-tip" style={{ left: tipLeft, top: plot.top, width: tipWidth }} aria-hidden="true">
        <div className="lb-tip-time">{formatTick(readout.ms, span)}</div>
        <ul>
          {readout.rows.map((row) => <li key={row.teamId}>
            <LineKey style={styles.get(row.teamId)} width={14} />
            <strong>{row.score}</strong>
            <span>{row.teamName}</span>
          </li>)}
        </ul>
      </div>}
    </div>
    <ul className="lb-legend" aria-label="Teams on the chart">
      {teams.map((team) => <li key={team.teamId} onPointerEnter={() => setFocused(team.teamId)} onPointerLeave={() => setFocused(null)}>
        <LineKey style={styles.get(String(team.teamId))} />
        <span>{team.teamName}{isMyTeam(team, myTeamId) && <span className="lb-you">You</span>}</span>
      </li>)}
    </ul>
  </div>;
}

export default function Leaderboard() {
  const { team, profile } = useTeam() ?? {};
  const myTeamId = team?.id ?? profile?.team?.id ?? null;
  const [state, setState] = useState(EMPTY);
  const poller = useRef(null);

  useEffect(() => {
    let active = true;
    poller.current = startPolling(async () => {
      const [board, line] = await Promise.allSettled([getLeaderboard(), getTimeline()]);
      if (!active) return;
      setState((previous) => ({
        standings: board.status === 'fulfilled' ? sortStandings(board.value) : previous.standings,
        timeline: line.status === 'fulfilled' ? line.value : previous.timeline,
        updatedAt: board.status === 'fulfilled' ? new Date() : previous.updatedAt,
        error: board.status === 'rejected' ? leaderboardErrorMessage(board.reason) : '',
        chartError: line.status === 'rejected' ? leaderboardErrorMessage(line.reason) : '',
      }));
    });
    return () => { active = false; poller.current.stop(); };
  }, []);

  const { standings, timeline, updatedAt, error, chartError } = state;
  if (standings === null) {
    return <section className="lb-page">
      <h1>Leaderboard</h1>
      {error
        ? <><p role="alert" className="error">{error}</p><button type="button" onClick={() => poller.current.refresh()}>Retry</button></>
        : <p role="status">Loading the leaderboard…</p>}
    </section>;
  }

  const mine = findMyStanding(standings, myTeamId);
  const chartTeams = timeline?.teams ?? [];
  const showChart = chartTeams.length > 0 && hasSolves(standings);
  return <section className="lb-page">
    <div className="lb-heading">
      <h1>Leaderboard</h1>
      <p className="lb-updated">
        {updatedAt && `Updated ${updatedAt.toLocaleTimeString()} · `}refreshes every {POLL_INTERVAL_MS / 1000} s
      </p>
    </div>
    {error && <p role="alert" className="error">Could not refresh the leaderboard, showing the last data. {error}</p>}
    {mine && <p className="lb-summary">Your team <strong>{mine.teamName}</strong> is ranked #{mine.rank} with {mine.points} {mine.points === 1 ? 'point' : 'points'}.</p>}
    {!mine && myTeamId === null && <p className="lb-summary">Join or create a team on the Team page to appear on the leaderboard.</p>}
    {!mine && team?.banned && <p className="lb-summary">Your team has been banned and is hidden from the leaderboard.</p>}

    <div className="lb-card">
      <h2>Standings</h2>
      {standings.length === 0
        ? <p className="lb-note">No teams yet. Create a team on the Team page, then solve a challenge to get on the board.</p>
        : <table className="lb-table">
          <caption className="lb-sr">Team standings</caption>
          <thead><tr>
            <th scope="col" className="lb-rank">Rank</th><th scope="col">Team</th>
            <th scope="col" className="lb-num">Points</th><th scope="col" className="lb-num">Solves</th>
          </tr></thead>
          <tbody>
            {standings.map((row) => {
              const you = isMyTeam(row, myTeamId);
              return <tr key={row.teamId} className={you ? 'lb-mine' : undefined} aria-current={you ? 'true' : undefined}>
                <td className="lb-rank">{row.rank}</td>
                <td className="lb-team">{row.teamName}{you && <span className="lb-you">Your team</span>}</td>
                <td className="lb-num">{row.points}</td>
                <td className="lb-num">{row.solves}</td>
              </tr>;
            })}
          </tbody>
        </table>}
    </div>

    <div className="lb-card">
      <h2>Score over time</h2>
      {chartError && <p role="alert" className="error">The chart could not be refreshed. {chartError}</p>}
      {timeline !== null && (showChart
        ? <ScoreChart teams={chartTeams} myTeamId={myTeamId} />
        : <p className="lb-note">No flags captured yet. The chart appears after the first solve.</p>)}
    </div>
  </section>;
}
