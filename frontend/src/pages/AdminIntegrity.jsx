import { useEffect, useId, useRef, useState } from 'react';
import { dismissIntegrity, listIntegrity } from '../api/admin.js';
import { adminErrorMessage, startPolling } from './adminHelpers.js';
import {
  DEFAULT_LIMIT, EVIDENCE_NOTE, INTEGRITY_REFRESH_MS, SIGNAL_KINDS, canDismiss, dismissPrompt, entryKey, entryName,
  formatWhen, isAnonymous, kindHelp, kindLabel, prepareEntries, riskLabel, riskPips, riskText, severityLevel,
  signalCount, signalTooltip, teamLabel, timeAgo,
} from './integrityHelpers.js';
import './AdminDashboard.css';
import './AdminIntegrity.css';

function RiskPips({ risk }) {
  const pips = riskPips(risk);
  return <span className={`fp-risk fp-risk-${pips.level}`}>
    <span className="fp-pips" role="img" aria-label={riskLabel(pips)}>
      {Array.from({ length: pips.total }, (_, index) => <span key={index} className={index < pips.filled ? 'fp-pip fp-pip-on' : 'fp-pip'} />)}
    </span>
    <span className="fp-risk-num" aria-hidden="true">{riskText(risk)}</span>
  </span>;
}

// Rendered inside AdminDashboard (below its own "Fair play" heading). Loads, polls and dismisses on its own,
// so a failure here never blocks the rest of the dashboard.
export default function AdminIntegrity({ limit = DEFAULT_LIMIT }) {
  const [entries, setEntries] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [open, setOpen] = useState({});
  const refreshRef = useRef(async () => {});
  const lock = useRef(false);
  const uid = useId();

  useEffect(() => {
    let alive = true;
    let inflight = false;
    let again = false;
    // Overlapping calls (a poll plus a Dismiss) collapse into one extra fetch after the current one.
    async function refresh() {
      if (inflight) { again = true; return; }
      inflight = true;
      setLoading(true);
      try {
        do {
          again = false;
          try {
            const data = await listIntegrity(limit);
            if (!alive) return;
            setEntries(prepareEntries(data));
            setError('');
            setUpdatedAt(Date.now());
          } catch (failure) {
            if (alive) setError(adminErrorMessage(failure, 'Could not load the fair-play signals.'));
          }
        } while (again && alive);
      } finally {
        inflight = false;
        if (alive) setLoading(false);
      }
    }
    refreshRef.current = refresh;
    refresh();
    const stopPolling = startPolling(refresh, { intervalMs: INTEGRITY_REFRESH_MS });
    return () => { alive = false; stopPolling(); };
  }, [limit]);

  async function dismiss(entry) {
    if (lock.current || !canDismiss(entry)) return;
    if (!window.confirm(dismissPrompt(entry))) return;
    lock.current = true;
    setBusyId(entry.userId);
    setError('');
    setNotice('');
    try {
      await dismissIntegrity(entry.userId);
      setNotice(`Dismissed the signals for ${entryName(entry)}.`);
    } catch (failure) {
      if (failure?.code === 'NOT_FOUND') setNotice(`${entryName(entry)} had nothing left to dismiss.`);
      else setError(adminErrorMessage(failure, 'Could not dismiss the signals.'));
    } finally {
      lock.current = false;
      setBusyId(null);
      refreshRef.current();
    }
  }

  const toggle = (key) => setOpen((previous) => ({ ...previous, [key]: !previous[key] }));
  const now = updatedAt ?? Date.now();

  return <div className="fp-admin">
    <div className="fp-toolbar">
      <p className="fp-intro">Players whose activity looks automated or AI-assisted, highest risk first. {EVIDENCE_NOTE}</p>
      <div className="fp-meta">
        <span>{updatedAt ? `Updated ${new Date(updatedAt).toLocaleTimeString()} · refreshes every ${INTEGRITY_REFRESH_MS / 1000} s` : 'Not updated yet'}</span>
        <button className="secondary" onClick={() => refreshRef.current()} disabled={loading || busyId !== null}>{loading ? 'Refreshing…' : 'Refresh'}</button>
      </div>
    </div>

    <div role="status" className="fp-live">{notice && <p className="notice">{notice}</p>}</div>
    {error && <p role="alert" className="error">{error}</p>}

    {entries === null
      ? (error
        ? <button onClick={() => refreshRef.current()} disabled={loading}>Try again</button>
        : <p role="status" className="adm-empty">Loading fair-play signals…</p>)
      : entries.length === 0
        ? <p className="adm-empty">No suspicious activity recorded</p>
        : <div className="adm-scroll" role="region" aria-label="Players with fair-play signals" tabIndex={0}>
          <table className="adm-table fp-table">
            <caption className="adm-sr">Players with fair-play signals, highest risk first</caption>
            <thead><tr>
              <th scope="col">Player</th><th scope="col">Team</th><th scope="col">Risk</th><th scope="col">Signals</th>
              <th scope="col"><span className="adm-sr">Actions</span></th>
            </tr></thead>
            <tbody>{entries.map((entry, index) => {
              const key = entryKey(entry, index);
              const name = entryName(entry);
              const expanded = Boolean(open[key]);
              const evidenceId = `${uid}-evidence-${index}`;
              return <tr key={key}>
                <td className="adm-name" data-label="Player">
                  {name}
                  {isAnonymous(entry) && <> <span className="adm-badge">Not signed in</span></>}
                </td>
                <td className="adm-name" data-label="Team">{teamLabel(entry)}</td>
                <td data-label="Risk"><RiskPips risk={entry.risk} /></td>
                <td className="fp-signals" data-label="Signals">
                  {entry.signals.length === 0
                    ? <span className="fp-none">No signal details</span>
                    : <ul className="fp-chips" aria-label={`Signals for ${name}`}>
                      {entry.signals.map((signal, signalIndex) => {
                        const level = severityLevel(signal.severity);
                        return <li key={`${signal.kind}:${signalIndex}`} className={`fp-chip fp-sev-${level}`} title={signalTooltip(signal, now)}>
                          <span className="fp-chip-kind">{kindLabel(signal.kind)}</span>
                          <span className="fp-chip-count"><span aria-hidden="true">×</span>{signalCount(signal)}<span className="adm-sr"> times, {level} severity</span></span>
                          <span className="fp-chip-time">{timeAgo(signal.lastAt, now)}</span>
                        </li>;
                      })}
                    </ul>}
                  {expanded && <ul className="fp-evidence" id={evidenceId} aria-label={`Evidence for ${name}`}>
                    {entry.signals.map((signal, signalIndex) => <li key={`${signal.kind}:${signalIndex}`}>
                      <strong>{kindLabel(signal.kind)}</strong>
                      <span className="fp-evidence-meta"> · {severityLevel(signal.severity)} severity · seen {signalCount(signal)} {signalCount(signal) === 1 ? 'time' : 'times'}</span>
                      {signal.detail && <code className="fp-detail">{signal.detail}</code>}
                      <span className="fp-evidence-meta">First {formatWhen(signal.firstAt)}, last {formatWhen(signal.lastAt)}</span>
                      <span className="fp-evidence-meta">{kindHelp(signal.kind)}</span>
                    </li>)}
                  </ul>}
                </td>
                <td className="adm-actions" data-label="Actions">
                  <div className="fp-buttons">
                    {entry.signals.length > 0 && <button
                      className="secondary" aria-expanded={expanded} aria-controls={expanded ? evidenceId : undefined}
                      aria-label={`${expanded ? 'Hide details' : 'Details'} for ${name}`} onClick={() => toggle(key)}
                    >{expanded ? 'Hide details' : 'Details'}</button>}
                    {canDismiss(entry) && <button
                      className="secondary" aria-label={`Dismiss signals for ${name}`}
                      disabled={busyId !== null} onClick={() => dismiss(entry)}
                    >{busyId === entry.userId ? 'Dismissing…' : 'Dismiss'}</button>}
                  </div>
                </td>
              </tr>;
            })}</tbody>
          </table>
        </div>}

    <details className="fp-legend">
      <summary>What the signals mean</summary>
      <dl>
        {Object.keys(SIGNAL_KINDS).map((kind) => <div key={kind} className="fp-legend-row">
          <dt>{kindLabel(kind)}</dt>
          <dd>{kindHelp(kind)}</dd>
        </div>)}
      </dl>
      <p className="fp-legend-note">{EVIDENCE_NOTE} Look at the details and the player's history before you remove points or ban a team.</p>
    </details>
  </div>;
}
