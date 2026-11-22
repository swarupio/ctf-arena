import { Link } from 'react-router-dom';
import PreviewNote from '../components/PreviewNote.jsx';
import { EVENT_MESSAGES } from '../event/messages.js';

// Replacement panels for situations where Start instance / Submit could never work. Plain text and links, no dead
// controls; the status ones are role="status" because the state can change while the page is open (event clock, team).

// One card in place of both the instance and the submit panel.
export function GateCard({ gate, challenge }) {
  if (gate === 'admin-preview') {
    const docker = challenge.type === 'docker';
    return <section className="instance-panel preview-card" aria-labelledby="preview-title">
      <h2 id="preview-title">Preview</h2>
      <PreviewNote>Admins have no team, so they cannot start instances or submit flags. Read the description and files on this page the way a player sees them.</PreviewNote>
      <p><strong>{challenge.title}</strong>: {docker ? 'a Docker challenge, each team gets its own private container and flag.' : 'a static challenge, the flag is found in the description and files.'} {challenge.category}, {challenge.difficulty}, {challenge.points} pts.</p>
      <ul className="preview-links">
        <li><Link to={`/admin/challenges?challenge=${challenge.id}`}>Edit this challenge in Admin</Link></li>
        {docker && <li><Link to="/admin/instances">See running instances</Link></li>}
      </ul>
    </section>;
  }
  if (gate === 'no-team') {
    return <section className="instance-panel" aria-labelledby="gate-title" role="status">
      <h2 id="gate-title">{challenge.type === 'docker' ? 'Instance and flag' : 'Submit flag'}</h2>
      <p>Containers and flags belong to a team. You are not in one yet.</p>
      <p><Link to="/team">Join or create a team</Link></p>
    </section>;
  }
  return <section className="instance-panel" aria-labelledby="gate-title" role="status">
    <h2 id="gate-title">{challenge.type === 'docker' ? 'Instance and flag' : 'Submit flag'}</h2>
    <p>Your account or team has been banned, so it cannot start instances or submit flags.</p>
    <p>If you think this is a mistake, ask an organiser.</p>
  </section>;
}

// Docker challenge on a host that cannot run containers (Vercel, DOCKER_ENABLED=false). There is no way to play it
// there, and the flag only exists inside the container, so the Submit box is hidden too instead of left to fail.
export function NoDockerPanel() {
  return <section className="instance-panel" aria-labelledby="nodocker-title" role="status">
    <h2 id="nodocker-title">Instance</h2>
    <p>This challenge needs Docker, which runs only in the local full-stack setup.</p>
    <p>This hosted site cannot start containers and the flag lives inside one, so there is no way to play it here. To play it, run the arena on your own machine:</p>
    <p><code>docker compose up --build</code></p>
    <p>Static challenges and <Link to="/range">The Range</Link> work everywhere.</p>
  </section>;
}

// Submissions are closed because of the event clock: say so instead of showing a Submit button that would be refused.
export function EventClosedPanel({ phase }) {
  return <section className="instance-panel" aria-labelledby="closed-title" role="status">
    <h2 id="closed-title">Submit flag</h2>
    <p>{phase === 'ended' ? EVENT_MESSAGES.EVENT_ENDED : EVENT_MESSAGES.EVENT_NOT_STARTED}</p>
  </section>;
}
