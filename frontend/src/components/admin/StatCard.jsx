import { Link } from 'react-router-dom';

// One number with a label. `tone` marks values that need attention; `to` makes the whole card a link.
export default function StatCard({ label, value, hint, tone = '', to }) {
  const body = <>
    <span className="adm-stat-value">{value}</span>
    <span className="adm-stat-label">{label}</span>
    {hint && <span className="adm-stat-hint">{hint}</span>}
  </>;
  const className = `adm-stat${tone ? ` adm-stat-${tone}` : ''}`;
  return <li className={className}>{to ? <Link to={to} className="adm-stat-link">{body}</Link> : body}</li>;
}

export function StatGrid({ label, children }) {
  return <ul className="adm-stats" aria-label={label}>{children}</ul>;
}
