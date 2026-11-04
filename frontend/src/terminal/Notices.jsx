import { Link } from 'react-router-dom';

// Friendly panel for the states where the terminal cannot start: no team, banned team, or a failed load.
// `problem` comes from describeError() in adapters.js.
export default function ProblemPanel({ problem, onRetry }) {
  if (problem.kind === 'no-team') {
    return <section className="tm-empty" aria-labelledby="tm-empty-title">
      <h2 id="tm-empty-title">No team yet</h2>
      <p>Codes are scored per team, so you need a team before you can boot a terminal. Create one or join with an invite code, then come back.</p>
      <Link className="button" to="/team">Go to the Team page</Link>
    </section>;
  }
  if (problem.kind === 'banned') {
    return <section className="tm-empty" aria-labelledby="tm-empty-title">
      <h2 id="tm-empty-title">Team banned</h2>
      <p>{problem.message}</p>
      <Link className="button secondary" to="/team">Open the Team page</Link>
    </section>;
  }
  return <section className="tm-empty" aria-labelledby="tm-empty-title">
    <h2 id="tm-empty-title">Terminal offline</h2>
    <p role="alert" className="error">{problem.message}</p>
    {onRetry && <button type="button" onClick={onRetry}>Retry</button>}
  </section>;
}
