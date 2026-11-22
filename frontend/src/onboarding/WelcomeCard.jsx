import { Link } from 'react-router-dom';
import HowItWorks from './HowItWorks.jsx';
import './onboarding.css';

/** First-visit card. The parent decides whether to render it (see showWelcome in storage.js). */
export default function WelcomeCard({ step, onDismiss }) {
  return <section className="ob-welcome" aria-labelledby="ob-welcome-heading">
    <div className="ob-welcome-head">
      <h2 id="ob-welcome-heading">New here? Capture your first flag in under 5 minutes</h2>
      <p className="ob-lead">A flag is a secret string that proves you solved a level. Start with a guest shell: look around, find one, submit it.</p>
    </div>
    <HowItWorks />
    <div className="ob-welcome-actions">
      {step
        ? <Link className="button" to={step.href}>Start with {step.title}</Link>
        : <Link className="button" to="/range">Open The Range</Link>}
      <Link className="button secondary" to="/range">See all six categories</Link>
      <button type="button" className="secondary" onClick={onDismiss}>Dismiss</button>
    </div>
  </section>;
}
