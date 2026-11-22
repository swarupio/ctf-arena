import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { nextStep } from './firstLevels.js';
import WhatIsFlag from './WhatIsFlag.jsx';
import './onboarding.css';

const LABEL = { captured: 'Captured', open: 'Open', unavailable: 'Not available yet', loading: 'Loading' };

function Step({ step, onRetry }) {
  const { status } = step;
  return <li className={`ob-step is-${status}`}>
    <div className="ob-step-main">
      <h3>{step.title}</h3>
      <p className="ob-objective">{step.objective}</p>
      <p className="ob-meta">
        <span>About {step.minutes} min</span>
        {status === 'open' && step.target && <span>Start: {step.target}</span>}
      </p>
    </div>
    <div className="ob-step-side">
      <span className="ob-status">{LABEL[status]}</span>
      {status === 'open' && <Link className="button" to={step.href}>Start<span className="ob-sr"> {step.title}</span></Link>}
      {status === 'captured' && <Link className="button secondary" to={step.href}>Revisit<span className="ob-sr"> {step.title}</span></Link>}
      {status === 'unavailable' && step.failed && <button type="button" className="secondary" onClick={() => onRetry(step.id)}>Retry<span className="ob-sr"> {step.title}</span></button>}
    </div>
  </li>;
}

/**
 * "Capture your first flag": six steps, one per category, with a meter whose label sits outside the bar.
 * `hint` is the last known state of this player ('open', 'cleared' or ''). While the overviews load the card never shows the
 * long list unless the player had it last time: it holds the one-line height (a skeleton), so a cleared player sees no
 * 1300 px collapse and the content below stays put.
 */
export default function FirstFlagChecklist({ steps, progress, onRetry, needsTeam = false, hint = '' }) {
  const percent = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  const cleared = progress.loaded && progress.done === progress.total;
  const next = nextStep(steps);
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const collapsed = cleared && !open;
  const heading = <h2 id="ob-checklist-heading">Capture your first flag</h2>;
  if (!progress.loaded && hint !== 'open') {
    return <section className="ob-checklist is-cleared is-loading" aria-labelledby="ob-checklist-heading" aria-busy="true">
      <div className="ob-done-row">
        {heading}
        <p className="ob-done-line" role="status">
          <span className="ob-sr">Checking your first flags</span>
          <span className="ob-skel-text" aria-hidden="true">{progress.total} of {progress.total} first flags captured. Range cleared. Try the Challenges board</span>
        </p>
        <span className="ob-skel-btn" aria-hidden="true" />
      </div>
    </section>;
  }
  return <section className={`ob-checklist${cleared ? ' is-cleared' : ''}`} aria-labelledby="ob-checklist-heading">
    {cleared
      ? <div className="ob-done-row">
        {heading}
        <p className="ob-done-line" role="status">{progress.done} of {progress.total} first flags captured. Range cleared. <Link to="/challenges">Try the Challenges board</Link></p>
        <button type="button" className="secondary small" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((value) => !value)}>{open ? 'Hide the steps' : 'Show the steps'}</button>
      </div>
      : heading}
    {!collapsed && <div id={bodyId} className="ob-body">
    <p className="ob-lead">One easy level in each category. Do them in any order; each takes a few minutes.</p>
    <div className="ob-meter">
      <p className="ob-meter-label">{progress.done} of {progress.total} first flags</p>
      <div className="ob-bar" role="progressbar" aria-label="First flags captured" aria-valuemin={0} aria-valuemax={progress.total}
        aria-valuenow={progress.done} aria-valuetext={progress.text}>
        <span style={{ width: `${percent}%` }} />
      </div>
    </div>
    {needsTeam && <p className="ob-note" role="note">You are not on a team yet. Flags you capture only score once you <Link to="/team">join or create a team</Link>.</p>}
    {!cleared && next && progress.done > 0 && <p className="ob-next">Next up: <Link to={next.href}>{next.title}</Link></p>}
    <ol className="ob-steps">
      {steps.map((step) => <Step key={step.id} step={step} onRetry={onRetry} />)}
    </ol>
    <WhatIsFlag />
    </div>}
  </section>;
}
