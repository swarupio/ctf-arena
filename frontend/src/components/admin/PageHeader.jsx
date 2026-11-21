// Title row of an admin section: heading, optional intro text and action buttons.
export default function PageHeader({ title, intro, children }) {
  return <header className="adm-page-head">
    <div>
      <h1>{title}</h1>
      {intro && <p className="adm-muted adm-intro">{intro}</p>}
    </div>
    {children && <div className="adm-page-actions">{children}</div>}
  </header>;
}

export function Panel({ title, children, actions, id }) {
  return <section className="adm-panel" aria-labelledby={id}>
    <div className="adm-panel-head">
      <h2 id={id}>{title}</h2>
      {actions}
    </div>
    {children}
  </section>;
}

// Small coloured status word (text, never colour alone).
export function Badge({ tone = '', children }) {
  return <span className={`adm-badge${tone ? ` adm-badge-${tone}` : ''}`}>{children}</span>;
}
