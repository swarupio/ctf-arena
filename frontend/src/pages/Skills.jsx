import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { GAMES } from '../games/registry.js';
import { CATALOGUE } from '../skills/levelSkills.js';
import { CATEGORY_IDS, loadCategory, mergeProgress } from '../skills/progress.js';
import {
  ADVANCED_NOTE, computeCoverage, filterRows, flattenCatalogue, frameworkSummary, groupByFramework, levelPath, portfolioStatus, splitAdvanced, summarize,
} from '../skills/coverage.js';
import { FRAMEWORKS, skillLabel } from '../skills/taxonomy.js';
import '../overview.css';
import '../skills/skills.css';

const ENTRIES = flattenCatalogue(CATALOGUE);
const CATEGORY_TITLE = new Map([...GAMES.map((game) => [game.id, game.title]), ...CATALOGUE.map((c) => [c.id, c.title])]);
const SHOW_OPTIONS = [
  ['all', 'All skills'],
  ['taught', 'Taught by at least one flag'],
  ['shown', 'Skills I have shown'],
  ['gaps', 'Not taught yet'],
];
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// Per-row meters are decorative: the visible text carries the numbers, so a screen reader hears no 36 progress bars.
function Meter({ row }) {
  if (row.total === 0) return <span className="sk-none">Not taught yet</span>;
  if (row.captured === null) return null;
  return <span className="sk-meter">
    <span className="sk-bar" aria-hidden="true">
      <span style={{ width: `${row.percent}%` }} />
    </span>
    <span className="sk-pct">{row.percent}%</span>
  </span>;
}

// One accessible summary per framework.
function FrameworkMeter({ rows, name }) {
  const summary = frameworkSummary(rows);
  if (!summary) return null;
  const label = `${name}: ${summary.shown} of ${plural(summary.taught, 'taught skill')} shown`;
  return <p className="sk-fw-summary">
    <span className="sk-bar" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={summary.percent}>
      <span style={{ width: `${summary.percent}%` }} />
    </span>
    <span className="sk-muted">{summary.shown} of {plural(summary.taught, 'taught skill')} shown</span>
  </p>;
}

function Detail({ row, challengeIds, id, open }) {
  const groups = CATALOGUE.map((category) => ({
    category,
    items: row.entries.filter((entry) => entry.category === category.id),
  })).filter((group) => group.items.length > 0);
  // The region always exists (aria-controls never dangles); its content is built only while open.
  if (!open) return <div id={id} className="sk-detail" hidden />;
  if (groups.length === 0) return <div id={id} className="sk-detail"><p className="sk-muted">No flag teaches this skill yet. It stays on the map so the gap is visible.</p></div>;
  return <div id={id} className="sk-detail">
    {groups.map(({ category, items }) => <div key={category.id}>
      <h4>{CATEGORY_TITLE.get(category.id) ?? category.title}</h4>
      <ul>
        {items.map((entry) => <li key={entry.key}>
          <Link to={levelPath(entry, challengeIds)}>{entry.title}</Link>
          <span className="sk-track">{entry.trackTitle}</span>
          {entry.state !== 'unknown' && <span className={`sk-state is-${entry.state}`}>{entry.state === 'captured' ? 'Captured' : 'Open'}</span>}
        </li>)}
      </ul>
    </div>)}
  </div>;
}

function Row({ row, open, onToggle, challengeIds }) {
  const detailId = `sk-detail-${row.skill.id}`;
  return <li className={`sk-row${open ? ' is-open' : ''}${row.total === 0 ? ' is-gap' : ''}`}>
    <button type="button" className="sk-head" aria-expanded={open} aria-controls={detailId} onClick={onToggle}>
      <span className="sk-name">
        {row.skill.code && <span className="sk-code">{row.skill.code}</span>}
        <span>{row.skill.name}</span>
      </span>
      <span className="sk-num sk-total">{plural(row.total, 'flag')}</span>
      <span className="sk-num sk-cap">{row.captured === null ? '' : `${row.captured} captured`}</span>
      <Meter row={row} />
    </button>
    <Detail row={row} challengeIds={challengeIds} id={detailId} open={open} />
  </li>;
}

function Portfolio({ rows, name, failed }) {
  const status = portfolioStatus(failed);
  const shown = rows.filter((row) => (row.captured ?? 0) > 0);
  const groups = groupByFramework(shown);
  return <section className="sk-card sk-portfolio" aria-labelledby="sk-portfolio-title">
    <div className="sk-portfolio-head">
      <h2 id="sk-portfolio-title">Skills I have shown</h2>
      <button type="button" className="secondary small sk-no-print" disabled={!status.complete} title={status.complete ? undefined : 'Available once every category has loaded'} onClick={() => window.print()}>Print or save as PDF</button>
    </div>
    <p className="sk-muted">{name ? `${name}, ` : ''}as of {new Date().toLocaleDateString()}. Each line counts the flags your team has captured that practise the skill.</p>
    {!status.complete && <p role="alert" className="sk-error">{status.note}. These counts may be too low.</p>}
    {groups.length === 0 && <p>No skills shown yet. Capture a flag and the skills it practises appear here.</p>}
    {groups.map(({ framework, rows: items }) => <div key={framework.id} className="sk-portfolio-group">
      <h3>{framework.name}</h3>
      <ul>
        {items.map((row) => <li key={row.skill.id}><span>{skillLabel(row.skill)}</span><strong>{row.captured} of {plural(row.total, 'flag')}</strong></li>)}
      </ul>
    </div>)}
    <p className="sk-muted">A record of practice on simulated targets. Aligned with public frameworks, not a certification.</p>
  </section>;
}

export default function Skills() {
  const { user, profile } = useAuth();
  const isAdmin = user?.role === 'admin';
  const withProgress = Boolean(user) && !isAdmin;
  const [results, setResults] = useState({});
  const [framework, setFramework] = useState('all');
  const [show, setShow] = useState('all');
  const [openId, setOpenId] = useState(null);

  const load = useCallback((ids, isActive) => {
    ids.forEach((id) => {
      loadCategory(id, (path) => apiGet(path, { ttl: 10_000 })).then((result) => {
        if (isActive()) setResults((current) => ({ ...current, [id]: result }));
      });
    });
  }, []);

  useEffect(() => {
    if (!withProgress) { setResults({}); return undefined; }
    let active = true;
    load(CATEGORY_IDS, () => active);
    return () => { active = false; };
  }, [withProgress, load]);

  const progress = useMemo(() => mergeProgress(Object.values(results)), [results]);
  const loaded = CATEGORY_IDS.every((id) => results[id]);
  const captured = withProgress ? progress.captured : null;
  const rows = useMemo(
    () => computeCoverage({ entries: ENTRIES, captured, failed: progress.failed }),
    [captured, progress.failed],
  );
  const totals = summarize(rows);
  const visible = filterRows(rows, { framework, show: captured === null && show === 'shown' ? 'all' : show });
  const groups = groupByFramework(visible);
  const { primary, advanced } = splitAdvanced(groups);
  const renderGroup = ({ framework: group, rows: items }) => <section key={group.id} className="sk-card" aria-labelledby={`sk-fw-${group.id}`}>
    <h2 id={`sk-fw-${group.id}`}>{group.name}</h2>
    <p className="sk-muted">{group.note}</p>
    <FrameworkMeter rows={rows.filter((row) => row.skill.framework === group.id)} name={group.name} />
    <ul className="sk-list">
      {items.map((row) => <Row key={row.skill.id} row={row} open={openId === row.skill.id}
        onToggle={() => setOpenId(openId === row.skill.id ? null : row.skill.id)} challengeIds={progress.challengeIds} />)}
    </ul>
  </section>;
  const retry = () => {
    setResults((current) => { const next = { ...current }; progress.failed.forEach((id) => { delete next[id]; }); return next; });
    load(progress.failed, () => true);
  };

  return <section className="sk-page ov-page">
    <header className="ov-header">
      <p className="ov-kicker">Skills map</p>
      <h1>What each flag teaches</h1>
      <p className="ov-lead">Every flag on CTF Arena is tagged with the skills it practises, using plain CTF skill areas and entries from public
        frameworks. Open a skill to see the flags behind it. <Link to="/range">Back to the Range</Link></p>
    </header>

    <section className="sk-card sk-no-print" aria-labelledby="sk-about-title">
      <h2 id="sk-about-title">How to read this</h2>
      <p>The tags are aligned with, or related to, the frameworks below. They are our own judgement of what a flag exercises, with at most
        three tags per flag. They are not certified, endorsed by the framework owners or a substitute for any exam. All targets are simulated.</p>
      <p>{totals.flags} flags carry tags and {totals.taught} of {totals.skills} listed skills are taught by at least one. Skills with no flag stay
        on the map so the gaps are honest.</p>
    </section>

    {!user && <p className="ov-note sk-no-print">You are looking at the catalogue. <Link to="/login">Sign in</Link> to see the flags your team has captured.</p>}
    {isAdmin && <p className="ov-note sk-no-print">Admin preview: the catalogue is shown without team progress.</p>}
    {withProgress && !loaded && <p role="status" className="sk-muted sk-no-print">Loading progress…</p>}
    {withProgress && progress.failed.length > 0 && <p role="alert" className="sk-error sk-no-print">
      Progress for {progress.failed.map((id) => CATEGORY_TITLE.get(id) ?? id).join(', ')} could not be loaded. Its flags still count as taught,
      but not as captured. <button type="button" className="secondary small" onClick={retry}>Retry</button>
    </p>}

    {withProgress && loaded && <Portfolio rows={rows} name={profile?.displayName} failed={progress.failed} />}

    <div className="sk-controls sk-no-print">
      <div className="sk-filter" role="group" aria-label="Filter by framework">
        {[{ id: 'all', short: 'All frameworks' }, ...FRAMEWORKS].map((item) => <button
          key={item.id} type="button" className={`secondary small${framework === item.id ? ' is-active' : ''}`}
          aria-pressed={framework === item.id} onClick={() => setFramework(item.id)}>{item.short}</button>)}
      </div>
      <label className="sk-show">Show
        <select value={show} onChange={(event) => setShow(event.target.value)}>
          {SHOW_OPTIONS.filter(([value]) => value !== 'shown' || captured !== null).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
    </div>

    <div className="sk-matrix sk-no-print">
      {groups.length === 0 && <p className="sk-muted">No skills match this filter.</p>}
      {primary.map(renderGroup)}
      {advanced.length > 0 && <details className="sk-advanced" open={framework !== 'all' && framework !== 'area'}>
        <summary>Advanced frameworks</summary>
        <p className="sk-muted">{ADVANCED_NOTE}</p>
        {advanced.map(renderGroup)}
      </details>}
    </div>

    <section className="sk-card sk-sources" aria-labelledby="sk-sources-title">
      <h2 id="sk-sources-title">Sources</h2>
      <ul>
        {FRAMEWORKS.map((item) => <li key={item.id}>
          <strong>{item.name}</strong>, {item.owner}.{' '}
          {item.url ? <a href={item.url} target="_blank" rel="noreferrer noopener">{item.url}</a> : 'Our own labels, no external standard.'}
        </li>)}
      </ul>
      <p className="sk-muted">OWASP, MITRE ATT&amp;CK and the NICE Framework belong to their owners. CTF Arena is not affiliated with them.</p>
    </section>
  </section>;
}
