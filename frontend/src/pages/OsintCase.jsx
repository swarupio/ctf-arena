import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getCase } from '../api/osint.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { DeskProvider, useDesk } from '../components/osint/DeskContext.jsx';
import BoardTab from '../components/osint/BoardTab.jsx';
import FeedTab from '../components/osint/FeedTab.jsx';
import MapTab from '../components/osint/MapTab.jsx';
import NotesTab from '../components/osint/NotesTab.jsx';
import PhotosTab from '../components/osint/PhotosTab.jsx';
import Questions from '../components/osint/Questions.jsx';
import RegistryTab from '../components/osint/RegistryTab.jsx';
import SearchBox from '../components/osint/SearchBox.jsx';
import WebTab from '../components/osint/WebTab.jsx';
import { START_HERE, useBriefingOpen } from './caseBriefing.js';
import { DIFFICULTY_LABEL, afterCaseLoadFailure, describeOsintError, nextOpenQuestion, progressPercent } from '../osint/helpers.js';
import '../components/osint/osint.css';

const TABS = [
  { id: 'feed', label: 'Social Feed', Panel: FeedTab },
  { id: 'web', label: 'Web Archive', Panel: WebTab },
  { id: 'registry', label: 'Registry / WHOIS (who owns a domain)', Panel: RegistryTab },
  { id: 'map', label: 'Map', Panel: MapTab },
  { id: 'photos', label: 'Photos', Panel: PhotosTab },
  { id: 'board', label: 'Case board', Panel: BoardTab },
  { id: 'notes', label: 'Notes', Panel: NotesTab },
];

function Tabs({ tab, onTab }) {
  const desk = useDesk();
  const refs = useRef({});
  function onKeyDown(event) {
    const index = TABS.findIndex((t) => t.id === tab);
    const next = event.key === 'ArrowRight' ? (index + 1) % TABS.length : event.key === 'ArrowLeft' ? (index + TABS.length - 1) % TABS.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : -1;
    if (next >= 0) { event.preventDefault(); onTab(TABS[next].id); refs.current[TABS[next].id]?.focus(); }
  }
  const Active = TABS.find((t) => t.id === tab).Panel;
  return <>
    <div className="os-tabs" role="tablist" aria-label="Investigation tools" onKeyDown={onKeyDown}>
      {TABS.map((t) => <button
        key={t.id} ref={(node) => { refs.current[t.id] = node; }} type="button" role="tab" id={`os-tab-${t.id}`}
        aria-selected={t.id === tab} aria-controls="os-panel" tabIndex={t.id === tab ? 0 : -1}
        className={t.id === tab ? '' : 'secondary'} onClick={() => onTab(t.id)}
      >{t.label}{t.id === 'notes' && desk.notes.length > 0 ? ` (${desk.notes.length})` : ''}</button>)}
    </div>
    <div id="os-panel" role="tabpanel" aria-labelledby={`os-tab-${tab}`} className="os-panel"><Active /></div>
  </>;
}

function Briefing({ view, email }) {
  const open = useBriefingOpen(email, 'osint', view.solved);
  return <>
    <p className="case-start" role="note">{START_HERE.osint}</p>
    <details className="os-briefing" open={open}>
      <summary>Case briefing</summary>
      {view.story.map((line, index) => <p key={index}>{line}</p>)}
      <p className="os-muted">Points are fixed per question and the whole case is worth {view.maxPoints}. There is no first-blood bonus and no time pressure.{view.hintsAllowed ? ' Hints are free; admins can see which ones were opened.' : ' This case gives no hints.'}</p>
    </details>
  </>;
}

function Desk({ view, canAnswer, onSolved }) {
  const [tab, setTab] = useState('feed');
  const percent = progressPercent(view.solved, view.total);
  const next = nextOpenQuestion(view.questions);
  return <DeskProvider track={view.id} onOpenTab={setTab} onRefresh={onSolved}>
    <div className="os-layout">
      <div className="os-desk" role="region" aria-label="Investigation desk">
        <h2>Investigation desk</h2>
        <SearchBox />
        <Tabs tab={tab} onTab={setTab} />
      </div>
      <div className="os-questions" role="region" aria-label="Questions" tabIndex={0}>
        <h2>Questions</h2>
        <div className="os-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label="Case progress"><span style={{ width: `${percent}%` }} /></div>
        {next && <p className="os-muted">Next open: {next}.</p>}
        <Questions view={view} canAnswer={canAnswer} onSolved={onSolved} />
      </div>
    </div>
  </DeskProvider>;
}

export default function OsintCase() {
  const { track } = useParams();
  const { user } = useAuth();
  const [state, setState] = useState({ view: null, error: '' });
  const latest = useRef(0);
  // Only the newest request may change the page: a slow earlier response (or one for a case we left) is dropped.
  // `keep` is for the reload after a correct answer: if it fails, the case and the flag just shown stay on screen.
  const load = useCallback(async (keep = false) => {
    latest.current += 1;
    const mine = latest.current;
    try {
      const next = await getCase(track);
      if (mine === latest.current) { setState({ view: next, error: '' }); }
    } catch (error) {
      if (mine === latest.current) { setState((current) => afterCaseLoadFailure(current, describeOsintError(error), keep)); }
    }
  }, [track]);
  const reload = useCallback(() => load(true), [load]);
  useEffect(() => {
    setState({ view: null, error: '' });
    void load();
    return () => { latest.current += 1; };
  }, [load]);

  const { view, error } = state;
  if (error && !view) { return <section className="os-page"><Link className="back-link" to="/osint">Back to the trail</Link><p role="alert" className="error">{error}</p></section>; }
  if (!view) { return <section className="os-page"><p role="status">Pulling the case file...</p></section>; }

  return <section className={`os-page os-level-${view.difficulty}`}>
    <Link className="back-link" to="/osint">Back to the trail</Link>
    {error && <p role="alert" className="error">{error} Your answer was saved; <button type="button" className="secondary small" onClick={() => load(true)}>reload the case</button> to refresh the list.</p>}
    <header className="os-case-head">
      <div>
        <p className="os-kicker">{DIFFICULTY_LABEL[view.difficulty]} case · {view.title}</p>
        <h1>{view.caseTitle}</h1>
      </div>
      <p className="os-score-line"><strong>{view.pointsEarned}</strong><span className="os-total">/{view.maxPoints} pts</span></p>
    </header>
    {view.caseClosed && <p className="os-stamp os-closed" role="status">CASE CLOSED. The trail ends here.</p>}
    <Briefing key={view.id} view={view} email={user?.email} />
    <Desk view={view} canAnswer={user?.role !== 'admin'} onSolved={reload} />
  </section>;
}
