import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import './onboarding.css';

/** Disclosure (not a modal): a button with aria-expanded controls the panel below it. */
export default function WhatIsFlag() {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return <section className="ob-explainer" aria-label="What is a flag?">
    <h3 className="ob-explainer-heading">
      <button type="button" className="ob-disclosure" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((value) => !value)}>
        <span>What is a flag?</span>
        <span aria-hidden="true" className="ob-chevron">{open ? '−' : '+'}</span>
      </button>
    </h3>
    <div id={panelId} className="ob-explainer-panel" hidden={!open}>
      <p>A flag is the secret string that proves you solved a level. Flags look like a short secret string and are specific to your team, so a copied one will not work for anyone else.</p>
      <ul>
        <li><strong>Hints</strong> nudge you towards the next step without giving the answer. Some levels have none. Where a hint costs points, the cost is shown before you open it.</li>
        <li><strong>Fair play</strong>: work out your own flags and do not share them. Read the short <Link to="/fair-play">fair-play rules</Link>.</li>
        <li><strong>Safe by design</strong>: every target here is simulated and authorised practice. Nothing on The Range touches a real system.</li>
      </ul>
    </div>
  </section>;
}
