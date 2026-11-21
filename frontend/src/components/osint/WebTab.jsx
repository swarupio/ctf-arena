import { useState } from 'react';
import { LoadState, MoreButton, PinButton } from './Common.jsx';
import { usePaged } from './usePaged.js';
import { useDesk } from './DeskContext.jsx';

function Pages() {
  const { track } = useDesk();
  const paged = usePaged(track, 'pages', {}, 20);
  const [open, setOpen] = useState('');
  const page = paged.items.find((p) => p.id === open) ?? paged.items[0];
  return <div className="os-stack">
    <LoadState paged={paged} />
    {page && <>
      <div className="os-subtabs" role="group" aria-label="Archived pages">
        {paged.items.map((p) => <button key={p.id} type="button" className={p.id === page.id ? '' : 'secondary'} aria-pressed={p.id === page.id} onClick={() => setOpen(p.id)}>
          {p.snapshot === 'current' ? p.title : `${p.title} (${p.snapshot})`}
        </button>)}
      </div>
      <article className="os-paper">
        <p className="os-url">archive view of <code>{page.path}</code> {page.snapshot === 'current' ? '(latest copy)' : `(copy of ${page.snapshot})`}</p>
        <h3>{page.title}</h3>
        <p>{page.body}</p>
        {page.staff && <div className="os-table-wrap"><table className="os-table">
          <caption className="os-sr">Staff list of the {page.snapshot} copy</caption>
          <thead><tr><th scope="col">Name</th><th scope="col">Title</th><th scope="col">Department</th><th scope="col">E-mail</th><th scope="col">Social</th><th scope="col"><span className="os-sr">Pin</span></th></tr></thead>
          <tbody>{page.staff.map((s) => <tr key={s.name}>
            <th scope="row">{s.name}</th><td>{s.title}</td><td>{s.dept}</td><td>{s.email ?? '-'}</td><td>{s.social}</td>
            <td><PinButton source="pages" id={`${page.id}:${s.name}`} title={`Staff ${s.name}`} text={`${s.name}, ${s.title}, ${s.email ?? 'no e-mail shown'}, ${s.social} (${page.snapshot} copy)`} /></td>
          </tr>)}</tbody>
        </table></div>}
        {!page.staff && <PinButton source="pages" id={page.id} title={`Page ${page.title}`} text={`${page.title}: ${page.body}`} />}
      </article>
    </>}
  </div>;
}

function Docs() {
  const { track } = useDesk();
  const paged = usePaged(track, 'docs', {}, 15);
  return <div className="os-stack">
    <p className="os-muted">The leaked-docs archive. Author and last editor are user names; e-mail addresses are first.last at the company domain.</p>
    <LoadState paged={paged} />
    <ul className="os-plain os-stack">{paged.items.map((d) => <li key={d.id} className="os-paper">
      <h3>{d.title}</h3>
      <dl className="os-kv"><dt>Date</dt><dd>{d.date}</dd><dt>Created by</dt><dd>{d.author}</dd><dt>Last modified by</dt><dd>{d.lastModifiedBy}</dd></dl>
      <p>{d.body}</p>
      <PinButton source="docs" id={d.id} title={`Document ${d.title}`} text={`${d.title} (${d.date}) created by ${d.author}, last modified by ${d.lastModifiedBy}: ${d.body}`} />
    </li>)}</ul>
    <MoreButton paged={paged} />
  </div>;
}

function Pastes() {
  const { track, utc } = useDesk();
  const paged = usePaged(track, 'pastes', {}, 10);
  return <div className="os-stack">
    <p className="os-muted">Anonymous dumps from the paste site. Posting times carry their own UTC offset. Some lines are encoded: the Notes tab has a decoder.</p>
    <LoadState paged={paged} />
    <ul className="os-plain os-stack">{paged.items.map((p) => <li key={p.id} className="os-paper">
      <h3>{p.title}</h3>
      <p className="os-meta">by {p.author} · posted <time dateTime={p.posted}>{p.posted}</time>{utc ? ' (raw value shown)' : ''}</p>
      <pre className="os-pre">{p.body}</pre>
      <PinButton source="pastes" id={p.id} title={`Paste ${p.title}`} text={`${p.title} by ${p.author} at ${p.posted}: ${p.body.replace(/\n/g, ' / ')}`} />
    </li>)}</ul>
  </div>;
}

export default function WebTab() {
  const [view, setView] = useState('pages');
  const views = [['pages', 'Company site'], ['docs', 'Leaked docs'], ['pastes', 'Paste site']];
  return <div className="os-stack">
    <div className="os-subtabs" role="group" aria-label="Web archive sections">
      {views.map(([id, label]) => <button key={id} type="button" className={view === id ? '' : 'secondary'} aria-pressed={view === id} onClick={() => setView(id)}>{label}</button>)}
    </div>
    {view === 'pages' && <Pages />}
    {view === 'docs' && <Docs />}
    {view === 'pastes' && <Pastes />}
  </div>;
}
