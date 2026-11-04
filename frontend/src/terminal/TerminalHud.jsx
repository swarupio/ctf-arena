import { useEffect, useMemo, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { CHEAT_SHEET, KEY_HINTS, MODES } from './data.js';
import { buildCodeRows, formatElapsed, pointsSummary } from './viewModel.js';

// The session timer is client-only: it starts on the first command and just counts up.
function SessionTimer({ startedAt }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAt === null) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);
  if (startedAt === null) return <span className="tm-timer is-idle">0:00 <span className="tm-hud-muted">starts with your first command</span></span>;
  return <span className="tm-timer" role="timer" aria-label="Session time">{formatElapsed(now - startedAt)}</span>;
}

/**
 * Side panel: mode title, codes found (??? until solved), points, session timer, cheat sheet, mode switcher and key
 * hints. On narrow screens it stacks under the terminal, starts collapsed and keeps a one-line summary visible.
 */
export default function TerminalHud({
  mode, info, modes, progress, progressFailed, onRetry, startedAt, isAdmin,
}) {
  const [open, setOpen] = useState(() => !(typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(max-width: 760px)').matches));
  const rows = useMemo(() => buildCodeRows(progress, info), [progress, info]);
  const { earned, total: pointsTotal } = pointsSummary(progress, info);
  const solvedCount = progress ? progress.solved.length : info?.solved ?? 0;
  const codeTotal = rows.length || info?.codes || 0;
  const titles = new Map((modes ?? []).map((item) => [item.mode, item.title]));

  return <aside className="tm-hud" aria-label="Terminal HUD">
    <div className="tm-hud-head">
      <div>
        <h2>{info?.title ?? mode}</h2>
        {info?.tagline && <p className="tm-hud-tagline">{info.tagline}</p>}
      </div>
      <button
        type="button"
        className="secondary small tm-hud-toggle"
        aria-expanded={open}
        aria-controls="tm-hud-body"
        onClick={() => setOpen((value) => !value)}
      >{open ? 'Hide HUD' : 'Show HUD'}</button>
    </div>
    <p className="tm-hud-summary">
      <strong>{solvedCount}/{codeTotal}</strong> codes <span aria-hidden="true">·</span> <strong>{earned}{pointsTotal ? `/${pointsTotal}` : ''}</strong> pts
    </p>

    <div id="tm-hud-body" className="tm-hud-body" hidden={!open}>
      {isAdmin && <p className="tm-hud-note">Admin preview: you can explore every mode, but only players can submit codes.</p>}

      <section aria-labelledby="tm-codes-title">
        <h3 id="tm-codes-title">Codes</h3>
        {progressFailed && <p className="tm-hud-note tm-hud-note--warn">Could not load your progress. <button type="button" className="small secondary" onClick={onRetry}>Retry</button></p>}
        <ul className="tm-codes">
          {rows.map((row) => <li key={row.n} className={row.solved ? 'is-solved' : undefined}>
            <span className="tm-code-mark" aria-hidden="true">{row.solved ? '[x]' : '[ ]'}</span>
            <span className="tm-sr">{row.solved ? 'Solved:' : 'Not solved yet:'}</span>
            <span className="tm-code-n">{row.n}</span>
            <span className="tm-code-title">{row.title}{row.firstBlood && <>{' '}<span className="tm-code-fb" title="Your team got first blood">FB</span></>}</span>
            {row.points !== null && row.points !== undefined && <span className="tm-code-points">+{row.points}</span>}
          </li>)}
          {rows.length === 0 && <li className="tm-hud-muted">No codes reported for this mode yet.</li>}
        </ul>
      </section>

      <dl className="tm-hud-stats">
        <div><dt>Points</dt><dd>{earned}{pointsTotal ? <span className="tm-hud-muted"> / {pointsTotal}</span> : null}</dd></div>
        <div><dt>Session</dt><dd><SessionTimer startedAt={startedAt} /></dd></div>
      </dl>

      <details className="tm-details">
        <summary>Cheat sheet</summary>
        <ul className="tm-cheats">
          {CHEAT_SHEET.map((row) => <li key={row.cmd}><code>{row.cmd}</code><span>{row.note}</span></li>)}
        </ul>
      </details>

      <nav className="tm-modes" aria-label="Switch mode">
        <h3>Modes</h3>
        <ul>
          {MODES.map((item) => <li key={item}>
            <NavLink to={`/terminal/${item}`}>{item}{titles.get(item) ? <span className="tm-hud-muted"> {titles.get(item)}</span> : null}</NavLink>
          </li>)}
          <li><Link to="/terminal">all modes</Link></li>
        </ul>
        <p className="tm-hud-muted">Switching modes starts a fresh terminal. Your codes are kept.</p>
      </nav>

      <section aria-labelledby="tm-keys-title">
        <h3 id="tm-keys-title">Keys</h3>
        <ul className="tm-keys">
          {KEY_HINTS.map((hint) => <li key={hint.note}>
            <span>{hint.keys.map((key, index) => <span key={key}>{index > 0 && (hint.join ?? ' + ')}<kbd>{key}</kbd></span>)}</span>
            <span>{hint.note}</span>
          </li>)}
        </ul>
      </section>
    </div>
  </aside>;
}
