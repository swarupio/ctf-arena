import Debrief from './Debrief.jsx';
import { hasLevel } from './levels.js';

// Terminal: one mode holds several codes, so list a debrief per captured code (every code once the event ended or for admins).
// `progress` is the normalised terminal progress ({ solved: [{ n }], total }).
export default function TerminalDebriefs({ mode, progress }) {
  const total = Number.isInteger(progress?.total) ? progress.total : 0;
  const solved = new Set((progress?.solved ?? []).map((item) => item.n));
  const codes = Array.from({ length: total }, (_, index) => index + 1).filter((n) => hasLevel(`terminal:${mode}:${n}`));
  if (codes.length === 0) { return null; }
  return <div className="dbf-list">
    {codes.map((n) => <Debrief key={n} levelKey={`terminal:${mode}:${n}`} captured={solved.has(n)} />)}
  </div>;
}
