import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { getDebrief, levelTitle, skillsOfLevel } from './entries.js';
import useEventEnded from './useEventEnded.js';
import { debriefMode, modeTitle } from './visibility.js';
import './debrief.css';

const SECTIONS = [
  ['what', 'What'],
  ['how', 'How it works'],
  ['defend', 'How defenders stop it'],
];

// The post-capture debrief of one level: collapsed until opened, plain text only.
// Shown to a team that captured the level, to everyone once the event has ended (as a write-up), and to admins as a preview.
// `eventEnded` is optional: when omitted the shared event read decides. Renders nothing without an entry.
export default function Debrief({ levelKey, captured = false, eventEnded, hintsUsed = null }) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const entry = getDebrief(levelKey);
  const needsEvent = eventEnded === undefined && Boolean(entry) && !captured && !isAdmin;
  const fetched = useEventEnded({ enabled: needsEvent });
  const [open, setOpen] = useState({ key: null, value: false });
  const id = useId();

  const mode = entry ? debriefMode({ isAdmin, captured, eventEnded: eventEnded ?? fetched }) : null;
  if (!entry || !mode) { return null; }

  const expanded = open.key === levelKey && open.value;
  const skills = skillsOfLevel(levelKey);
  const title = levelTitle(levelKey);
  const used = Number.isInteger(hintsUsed) && hintsUsed >= 0 ? hintsUsed : null;
  return <section className="dbf" data-mode={mode} aria-label={`${modeTitle(mode)}${title ? `: ${title}` : ''}`}>
    <h2 className="dbf-head">
      <button
        type="button" className="dbf-toggle" aria-expanded={expanded} aria-controls={`${id}-body`}
        onClick={() => setOpen({ key: levelKey, value: !expanded })}
      >
        <span className="dbf-label"><span className="dbf-title">{modeTitle(mode)}</span>{title && <span className="dbf-sub">{title}</span>}</span>
        <span className="dbf-chevron" aria-hidden="true">{expanded ? '−' : '+'}</span>
      </button>
    </h2>
    <div className="dbf-body" id={`${id}-body`} hidden={!expanded}>
      {SECTIONS.map(([field, label]) => <div className="dbf-block" key={field}>
        <h3>{label}</h3>
        <p>{entry[field]}</p>
      </div>)}
      {entry.tools.length > 0 && <div className="dbf-block">
        <h3>Tools</h3>
        <ul className="dbf-tools">{entry.tools.map((tool) => <li key={tool}>{tool}</li>)}</ul>
      </div>}
      {entry.next && <div className="dbf-block">
        <h3>Practise next</h3>
        <p>{entry.next}</p>
      </div>}
      {skills.length > 0 && <div className="dbf-block">
        <h3>Skills</h3>
        <ul className="dbf-skills">{skills.map((skill) => <li key={skill.id}>
          <Link className="dbf-chip" to="/skills" title="Open the Skills map">{skill.label}</Link>
        </li>)}</ul>
      </div>}
      {used !== null && mode === 'captured' && <p className="dbf-used">Hints used: {used}</p>}
    </div>
  </section>;
}
