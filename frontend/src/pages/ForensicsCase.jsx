import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getTrack } from '../api/forensics.js';
import { createLatest } from '../api/latest.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { START_HERE, useBriefingOpen } from './caseBriefing.js';
import { DIFFICULTY_LABEL, afterCaseLoadFailure, describeForensicsError, nextOpenStage, progressPercent } from '../forensics/caseHelpers.js';
import { EvidenceBoard, SuspectBoard } from '../components/forensics/Board.jsx';
import CaseTimer from '../components/forensics/CaseTimer.jsx';
import DecoderTool from '../components/forensics/DecoderTool.jsx';
import DiskViewer from '../components/forensics/DiskViewer.jsx';
import HexEditor from '../components/forensics/HexEditor.jsx';
import LogViewer from '../components/forensics/LogViewer.jsx';
import MetadataTable from '../components/forensics/MetadataTable.jsx';
import PacketTable from '../components/forensics/PacketTable.jsx';
import PixelGrid from '../components/forensics/PixelGrid.jsx';
import Interviews from '../components/forensics/Interviews.jsx';
import StagePanel from '../components/forensics/StagePanel.jsx';
import TimelineBoard from '../components/forensics/TimelineBoard.jsx';
import { useTimeline } from '../components/forensics/useTimeline.js';
import '../components/forensics/forensics.css';

const VIEWERS = { log: LogViewer, packets: PacketTable, hex: HexEditor, exif: MetadataTable, stego: PixelGrid, disk: DiskViewer };

function Briefing({ view, email }) {
  const open = useBriefingOpen(email, 'forensics', view.solved);
  return <>
    <p className="case-start" role="note">{START_HERE.forensics}</p>
    <details className="fx-briefing" open={open}>
      <summary>Case file cover page</summary>
      {view.briefing.map((line, index) => <p key={index} className={index === 0 ? 'fx-classified' : undefined}>{line}</p>)}
      <p className="fx-muted">Points are fixed per question and the whole case is worth {view.maxPoints}. There is no first-blood bonus and no time pressure.</p>
    </details>
  </>;
}

export default function ForensicsCase() {
  const { track } = useParams();
  const { user } = useAuth();
  const [state, setState] = useState({ view: null, error: '' });
  const [tool, setTool] = useState(null);
  const [accused, setAccused] = useState(null);
  const timeline = useTimeline(user?.email, track);
  const latest = useRef(null);
  latest.current ??= createLatest();
  // `keep` is for the reload after a correct answer: if it fails, the case on screen stays and a notice is shown.
  const load = useCallback(async (keep = false) => {
    const current = latest.current.begin(); // an answer for a case the player already left is dropped
    try {
      const view = await getTrack(track);
      if (current()) { setState({ view, error: '' }); }
    } catch (error) {
      if (current()) { setState((now) => afterCaseLoadFailure(now, describeForensicsError(error), keep)); }
    }
  }, [track]);
  const reload = useCallback(() => load(true), [load]);
  useEffect(() => {
    setState({ view: null, error: '' });
    setTool(null);
    void load();
    const guard = latest.current;
    return () => guard.cancel();
  }, [load]);

  const { view, error } = state;
  const evidenceValues = useMemo(() => new Map((view?.evidence ?? []).map((item) => [item.n, item.value])), [view]);
  if (error && !view) {
    return <section className="fx-page"><Link className="back-link" to="/forensics">Back to the desk</Link><p role="alert" className="error">{error}</p></section>;
  }
  if (!view) { return <section className="fx-page"><p role="status">Pulling the case file...</p></section>; }

  const active = view.artefacts.find((a) => a.id === tool) ?? view.artefacts[0];
  const Viewer = VIEWERS[active.kind];
  const percent = progressPercent(view.solved, view.total);
  const next = nextOpenStage(view.stages);
  const canAnswer = user?.role !== 'admin';

  return <section className={`fx-page fx-level-${view.difficulty}`}>
    <Link className="back-link" to="/forensics">Back to the desk</Link>
    {error && <p role="alert" className="error">Answer saved. Reloading the case failed: {error} <button type="button" className="secondary small" onClick={reload}>Retry</button></p>}
    <header className="fx-case-head">
      <div>
        <p className="fx-kicker">{DIFFICULTY_LABEL[view.difficulty]} case · {view.title}</p>
        <h1>{view.caseTitle}</h1>
      </div>
      <div className="fx-case-side">
        <p className="fx-score-line"><strong>{view.pointsEarned}</strong><span className="fx-total">/{view.maxPoints} pts</span></p>
        <CaseTimer trackId={view.id} closed={view.caseClosed} email={user?.email} />
      </div>
    </header>
    <div className="fx-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label="Case progress"><span style={{ width: `${percent}%` }} /></div>
    {view.caseClosed && <p className="fx-stamp fx-closed" role="status">CASE CLOSED. The culprit is behind bars.</p>}

    <Briefing key={view.id} view={view} email={user?.email} />

    <div className="fx-layout">
      <div className="fx-tools" role="region" aria-label="Evidence tools">
        <h2>Evidence</h2>
        {view.artefacts.length > 1 && <div className="fx-tabs" role="group" aria-label="Choose an artefact">
          {view.artefacts.map((a) => <button key={a.id} type="button" className={a.id === active.id ? '' : 'secondary'} aria-pressed={a.id === active.id} onClick={() => setTool(a.id)}>{a.title}</button>)}
        </div>}
        <Viewer key={active.id} track={view.id} artefact={active} timeline={timeline} />
        {view.artefacts.some((a) => a.kind === 'hex' || a.kind === 'exif' || a.kind === 'packets') && <DecoderTool />}
      </div>
      <div className="fx-questions" role="region" aria-label="Questions">
        <h2>Questions</h2>
        {next && <p className="fx-muted">Next open question: {next}.</p>}
        {view.stages.map((stage) => (
          <StagePanel key={`${view.id}-${stage.n}`} trackId={view.id} stage={stage} canAnswer={canAnswer} prefill={stage.whodunit ? accused : null} onSolved={reload} />
        ))}
      </div>
    </div>

    <TimelineBoard timeline={timeline} />
    <EvidenceBoard evidence={view.evidence} stages={view.stages} />
    <Interviews trackId={view.id} solved={view.solved} />
    <SuspectBoard
      suspects={view.suspects} evidenceValues={evidenceValues}
      canAccuse={canAnswer && !view.stages.find((s) => s.whodunit)?.solved && !view.stages.find((s) => s.whodunit)?.locked}
      onAccuse={(name) => setAccused({ name, at: Date.now() })}
    />
  </section>;
}
