import { useId } from 'react';
import './panels.css';

const DEFAULT_TTL_MINUTES = 30;
const LOW_MINUTES = 5;

const STATUS_LABEL = {
  running: 'RUNNING',
  solved: 'STOPPED: flag solved',
  stopped: 'STOPPED',
  expired: 'REAPED: TTL expired',
  killed: 'KILLED by admin',
};

function teamLabel(team) {
  const raw = String(team ?? '');
  if (/alpha/i.test(raw)) return 'Alpha';
  if (/beta/i.test(raw)) return 'Beta';
  const cleaned = raw.replace(/^(demo|team)[-_ ]*/i, '');
  return cleaned ? cleaned.charAt(0).toUpperCase() + cleaned.slice(1) : '?';
}

function hardeningChips(own, global) {
  // Per-instance numbers win over the global limits; only chips for values that exist are shown.
  const pick = (key) => own?.[key] ?? global?.[key];
  const chips = [];
  const mem = pick('memoryMb');
  if (mem != null) chips.push(`mem ${mem} MB`);
  const cpu = pick('cpu');
  if (cpu != null) chips.push(`cpu ${cpu}`);
  const pids = pick('pids');
  if (pids != null) chips.push(`pids ${pids}`);
  const cap = pick('capDrop');
  if (cap) chips.push(`cap_drop ${Array.isArray(cap) ? cap.join(',') : cap === true ? 'ALL' : cap}`);
  if (pick('noNewPrivileges')) chips.push('no-new-privileges');
  if (pick('readOnlyRoot')) chips.push('read-only fs');
  return chips;
}

// The Docker containers the platform has started for players, with TTL countdown and hardening flags.
export default function InstancePanel({ instances, limits }) {
  const titleId = useId();
  const list = Array.isArray(instances) ? instances : [];
  const sorted = [...list].sort((a, b) => (a.status === 'running' ? 0 : 1) - (b.status === 'running' ? 0 : 1));
  const running = list.filter((inst) => inst.status === 'running').length;
  const ttl = Number(limits?.ttlMinutes) > 0 ? Number(limits.ttlMinutes) : DEFAULT_TTL_MINUTES;
  const rules = [
    limits?.ttlMinutes != null ? `TTL ${limits.ttlMinutes} min` : null,
    limits?.maxPerTeam != null ? `max ${limits.maxPerTeam} per team` : null,
  ].filter(Boolean);

  return (
    <section className="demo-pnl demo-ip" aria-labelledby={titleId}>
      <div className="demo-pnl-head">
        <h3 className="demo-pnl-title" id={titleId}>Challenge containers</h3>
        <span className="demo-pnl-tag">{running} running</span>
      </div>
      <div className="demo-pnl-body">
        {sorted.length === 0 ? (
          <p className="demo-ip-empty">No containers running</p>
        ) : (
          <ul className="demo-ip-list">
            {sorted.map((inst) => {
              const isRunning = inst.status === 'running';
              // A container that is no longer running has no time left, whatever the scenario last reported.
              const left = isRunning ? Math.max(0, Number(inst.minutesLeft) || 0) : 0;
              const pct = Math.min(100, (left / ttl) * 100);
              const low = isRunning && left < LOW_MINUTES;
              const label = STATUS_LABEL[inst.status] ?? String(inst.status ?? '').toUpperCase();
              const team = teamLabel(inst.team);
              const chips = hardeningChips(inst.limits, limits);
              const cls = ['demo-ip-card', isRunning ? 'is-running' : 'is-ended', low ? 'is-low' : '']
                .filter(Boolean)
                .join(' ');
              return (
                <li className={cls} key={inst.id}>
                  <div className="demo-ip-top">
                    <span className={`demo-ip-team demo-ip-team-${team.toLowerCase()}`}>{team}</span>
                    <span className="demo-ip-title">{inst.title ?? inst.challenge}</span>
                    <span className="demo-ip-status">{label}</span>
                  </div>
                  <div className="demo-ip-line">
                    <code className="demo-ip-port">localhost:{inst.port}</code>
                    {inst.startedMinute != null ? (
                      <span className="demo-ip-started">started T+{String(inst.startedMinute).padStart(2, '0')}:00</span>
                    ) : null}
                  </div>
                  <div className="demo-ip-ttl">
                    <div
                      className="demo-ip-bar"
                      role="progressbar"
                      aria-label={`Time to live for ${inst.title ?? inst.challenge}`}
                      aria-valuemin={0}
                      aria-valuemax={ttl}
                      aria-valuenow={Math.min(left, ttl)}
                      aria-valuetext={isRunning ? `${left} minutes left` : 'no time left, container ended'}
                    >
                      <span className="demo-ip-fill" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="demo-ip-left">
                      {isRunning ? `${left} min left${low ? ' - reaper soon' : ''}` : 'ended'}
                    </span>
                  </div>
                  {chips.length > 0 ? (
                    <ul className="demo-ip-chips" aria-label="Container hardening">
                      {chips.map((chip) => (
                        <li className="demo-ip-chip" key={chip}>{chip}</li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        {rules.length > 0 ? <p className="demo-ip-rules">{rules.join(' / ')}</p> : null}
      </div>
    </section>
  );
}
