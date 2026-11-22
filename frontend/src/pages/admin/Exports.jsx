import { useState } from 'react';
import { downloadCsv } from '../../api/admin.js';
import { useAct } from '../../admin/hooks.js';
import { CSV_EXPORTS, CSV_MAX_ROWS } from '../../admin/download.js';
import PageHeader, { Panel } from '../../components/admin/PageHeader.jsx';

const FILTERED = {
  users: [{ name: 'q', label: 'Search name or email' }, { name: 'banned', label: 'Banned', options: ['', 'true', 'false'] }],
  teams: [{ name: 'q', label: 'Search team name' }, { name: 'banned', label: 'Banned', options: ['', 'true', 'false'] }],
  submissions: [{ name: 'result', label: 'Result', options: ['', 'correct', 'wrong'] }],
  leaderboard: [],
};

export default function Exports() {
  const act = useAct();
  const [filters, setFilters] = useState({});
  const set = (exportName, field, value) => setFilters({ ...filters, [exportName]: { ...filters[exportName], [field]: value } });

  return <>
    <PageHeader title="Exports" intro={`CSV downloads, at most ${CSV_MAX_ROWS.toLocaleString('en-US')} rows each. Every export is recorded in the audit log.`} />
    <p className="notice adm-notice-warn" role="note">Users and submissions exports contain personal data (email addresses). Store and share them with care. The file is fetched with your sign-in token and saved by the browser; the token is never part of a link.</p>
    <div className="adm-grid-2">
      {CSV_EXPORTS.map((item) => {
        const values = filters[item.name] ?? {};
        const fields = FILTERED[item.name];
        const state = { q: values.q ?? '', sort: '', filters: Object.fromEntries(Object.entries(values).filter(([field]) => field !== 'q')) };
        return <Panel key={item.name} title={item.title} id={`export-${item.name}`}>
          <p className="adm-muted">{item.description}</p>
          {fields.length > 0 && <div className="adm-form">
            {fields.map((field) => <label key={field.name}>{field.label}
              {field.options
                ? <select value={values[field.name] ?? ''} onChange={(event) => set(item.name, field.name, event.target.value)}>{field.options.map((option) => <option key={option} value={option}>{option || 'Any'}</option>)}</select>
                : <input value={values[field.name] ?? ''} maxLength={100} onChange={(event) => set(item.name, field.name, event.target.value)} />}
            </label>)}
          </div>}
          <button type="button" disabled={act.busy} onClick={() => act.run(item.name, () => downloadCsv(item.name, fields.length ? state : undefined), { success: (name) => `Saved ${name}.` })}>
            {act.isPending(item.name) ? 'Preparing…' : `Download ${item.name}.csv`}
          </button>
        </Panel>;
      })}
    </div>
  </>;
}
