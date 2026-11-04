import { useId } from 'react';
import './panels.css';

function prettySlug(slug) {
  return String(slug ?? '')
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function points(n) {
  return `${n} ${n === 1 ? 'point' : 'points'}`;
}

function summarise(list) {
  if (list.length === 0) return 'No teams yet';
  const leaders = list.filter((t) => t.rank === 1);
  const top = leaders.length > 0 ? leaders : [list[0]];
  const score = Number(top[0].score) || 0;
  if (score <= 0) return 'No points scored yet';
  if (top.length > 1) return `${top.map((t) => t.name).join(' and ')} are tied for first with ${points(score)}`;
  return `${top[0].name} leads with ${points(score)}`;
}

// Live leaderboard. Teams arrive already sorted by rank; the bars are proportional to the best score.
export default function Scoreboard({ teams }) {
  const titleId = useId();
  const list = Array.isArray(teams) ? teams : [];
  const max = list.reduce((best, t) => Math.max(best, Number(t.score) || 0), 0);

  return (
    <section className="demo-pnl demo-sb" aria-labelledby={titleId}>
      <div className="demo-pnl-head">
        <h3 className="demo-pnl-title" id={titleId}>Live scoreboard</h3>
      </div>
      <div className="demo-pnl-body">
        <p className="demo-sb-summary" aria-live="polite" aria-atomic="true">{summarise(list)}</p>
        {list.length > 0 ? (
          <ol className="demo-sb-list">
            {list.map((team, i) => {
              const score = Number(team.score) || 0;
              const rank = team.rank ?? i + 1;
              const solves = Array.isArray(team.solves) ? team.solves : [];
              const count = team.solveCount ?? solves.length;
              const pct = max > 0 ? Math.min(100, (score / max) * 100) : 0;
              const cls = ['demo-sb-row', rank === 1 ? 'is-first' : '', team.banned ? 'is-banned' : '']
                .filter(Boolean)
                .join(' ');
              return (
                <li className={cls} key={team.id ?? team.name}>
                  <div className="demo-sb-rank">
                    <span className="demo-pnl-sr">Rank </span>#{rank}
                  </div>
                  <div className="demo-sb-main">
                    <div className="demo-sb-head">
                      <span className="demo-sb-name">{team.name}</span>
                      {team.banned ? <span className="demo-sb-banned">BANNED</span> : null}
                      <span className="demo-sb-count">{count} {count === 1 ? 'solve' : 'solves'}</span>
                    </div>
                    <div className="demo-sb-track" aria-hidden="true">
                      <span className="demo-sb-fill" style={{ width: `${pct}%` }} />
                    </div>
                    <ul className="demo-sb-chips" aria-label={`${team.name} solved challenges`}>
                      {solves.length === 0 ? <li className="demo-sb-none">no solves yet</li> : null}
                      {solves.map((slug) => (
                        <li className="demo-sb-chip" key={slug}>{prettySlug(slug)}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="demo-sb-score">
                    {team.delta > 0 ? (
                      <span className="demo-sb-delta" key={`${team.id}-${score}`} aria-hidden="true">+{team.delta}</span>
                    ) : null}
                    <span className="demo-sb-value">{score}</span>
                    <span className="demo-sb-pts">pts</span>
                  </div>
                </li>
              );
            })}
          </ol>
        ) : null}
      </div>
    </section>
  );
}
