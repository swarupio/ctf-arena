import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getLab, sendLabRequest, submitLabFlag } from '../api/weblab.js';
import { useAuth } from '../auth/AuthContext.jsx';
import RequestInspector from '../components/weblab/RequestInspector.jsx';
import TargetFrame from '../components/weblab/TargetFrame.jsx';
import { BountyBadge, FlagBox } from '../components/weblab/Widgets.jsx';
import WebLabHints from '../components/weblab/WebLabHints.jsx';
import { HintsUsed } from '../hints/HintLadder.jsx';
import Debrief from '../debrief/Debrief.jsx';
import { keyById } from '../debrief/levels.js';
import {
  applyForm, applySetCookies, buildPayload, describeError, draftFromRequest, formDefaults, pushHistory,
} from '../components/weblab/helpers.js';
import '../components/weblab/weblab.css';

function Play({ slug }) {
  const { user, signOut } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [lab, setLab] = useState(null);
  const [problem, setProblem] = useState(null);
  const [draft, setDraft] = useState(null);
  const [values, setValues] = useState({});
  const [response, setResponse] = useState(null);
  const [previous, setPrevious] = useState(null);
  const [history, setHistory] = useState([]);
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState('');
  const [won, setWon] = useState(null);
  const [hintsUsed, setHintsUsed] = useState(0);
  const alive = useRef(true);
  const counter = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const load = useCallback(async ({ keepDraft = false } = {}) => {
    setProblem(null);
    try {
      const next = await getLab(slug);
      if (!alive.current) { return; }
      setLab(next);
      if (!keepDraft) {
        if (next.request) { setDraft(draftFromRequest(next.request)); }
        setValues(formDefaults(next.form));
      }
    } catch (error) {
      if (!alive.current) { return; }
      const described = describeError(error);
      setProblem(described);
      if (described.kind === 'auth') { void Promise.resolve(signOut()).catch(() => {}); }
    }
  }, [slug, signOut]);
  useEffect(() => { void load(); }, [load]);

  const send = useCallback(async (payload) => {
    setBusy(true);
    setSendError('');
    try {
      const answer = await sendLabRequest(slug, payload);
      if (!alive.current) { return; }
      counter.current += 1;
      setPrevious(response);
      setResponse(answer);
      setHistory((items) => pushHistory(items, { id: counter.current, payload, status: answer.status }));
      // The simulated browser keeps cookies the site sets.
      setDraft((current) => (current ? { ...current, cookies: applySetCookies(current.cookies, answer.setCookies) } : current));
    } catch (error) {
      if (alive.current) { setSendError(describeError(error).message); }
    } finally {
      if (alive.current) { setBusy(false); }
    }
  }, [slug, response]);

  const submitForm = () => {
    const next = applyForm(lab.form, values, draft);
    setDraft(next);
    const built = buildPayload(next);
    if (built.ok) { void send(built.payload); } else { setSendError(built.error); }
  };

  const submit = async (flag) => {
    const result = await submitLabFlag(slug, flag);
    if (result.correct && alive.current) {
      setWon(result);
      void load({ keepDraft: true });
    }
    return result;
  };

  if (problem) {
    return <section className="wl-page-root">
      <h1>Web Exploit Lab</h1>
      <div className="wl-notice is-error" role="alert"><p>{problem.message}</p></div>
      <p><Link to="/weblab">Back to the target list</Link>{problem.kind === 'network' && <> or <button type="button" className="secondary small" onClick={() => load()}>retry</button></>}</p>
    </section>;
  }
  if (!lab) { return <section className="wl-page-root"><h1>Web Exploit Lab</h1><p role="status" className="wl-muted">Connecting to the target...</p></section>; }
  if (lab.locked) {
    return <section className="wl-page-root">
      <h1>{lab.title}</h1>
      <p className="wl-notice is-info" role="status">Locked. {lab.lockedReason}.</p>
      <p><Link to="/weblab">Back to the target list</Link></p>
    </section>;
  }

  return <section className="wl-page-root wl-play" data-theme={lab.theme}>
    <p className="wl-crumbs"><Link to="/weblab">Web Exploit Lab</Link> / {lab.company.name}</p>
    <h1>{lab.boss ? 'BOSS: ' : ''}{lab.title}</h1>
    <div className="wl-brief">
      <p className="wl-story">{lab.story}</p>
      <p><strong>Objective.</strong> {lab.objective}</p>
      <p className="wl-meta">
        <span>{lab.points} points</span>
        <span>{lab.track} track</span>
        {lab.solved && <BountyBadge severity={lab.severity} bountyUsd={lab.bountyUsd} fresh={Boolean(won)} />}
      </p>
      {isAdmin && <p className="wl-notice is-info">Admin preview: the flag you find is a preview flag and cannot be submitted.</p>}
      {won && <div className="wl-win" role="status">
        <strong>{won.alreadySolved ? 'Already cashed' : 'BOUNTY PAID'}</strong>
        <span>{won.message}</span>
        {lab.hintCount > 0 && <HintsUsed count={hintsUsed} />}
        <BountyBadge severity={won.severity} bountyUsd={won.bountyUsd} fresh />
        <Link className="button small" to="/weblab">Pick the next target</Link>
      </div>}
    </div>
    <div className="wl-grid">
      <TargetFrame
        site={lab.site} company={lab.company} theme={lab.theme} request={draft} response={response} loading={busy}
        form={lab.form} values={values} onValuesChange={setValues} onSubmitForm={submitForm}
      />
      {draft && <RequestInspector
        draft={draft} onDraftChange={setDraft} onSend={send} busy={busy} error={sendError}
        onReset={() => { setDraft(draftFromRequest(lab.request)); setSendError(''); }}
        response={response} previous={previous} history={history}
        onReplay={(entry) => setDraft(draftFromRequest(entry.payload))}
        features={lab.inspector.features}
      />}
    </div>
    <div className="wl-lower">
      <section aria-labelledby="wl-hints-title">
        <h2 id="wl-hints-title">Hints</h2>
        <WebLabHints key={slug} slug={slug} user={user} count={lab.hintCount} onCount={setHintsUsed} />
      </section>
      <section aria-labelledby="wl-flag-title">
        <h2 id="wl-flag-title">Submit the flag</h2>
        {isAdmin
          ? <p className="wl-muted">Only players can submit flags.</p>
          : <FlagBox onSubmit={submit} solved={lab.solved} response={response} />}
      </section>
    </div>
    <Debrief levelKey={keyById('weblab', slug.replace(/^weblab-/, ''))} captured={Boolean(lab.solved || won)} hintsUsed={isAdmin || lab.hintCount === 0 ? null : hintsUsed} />
  </section>;
}

export default function WebLabPlay() {
  const { slug } = useParams();
  return <Play key={slug} slug={slug} />;
}
