import { useMemo, useState } from 'react';
import { LoadState, PinButton } from './Common.jsx';
import { usePaged } from './usePaged.js';
import { useDesk } from './DeskContext.jsx';

// WHOIS-style records and a DNS viewer for the (fictional) registry. The whole registry is a dozen domains, so it is loaded
// once and filtered here; nothing is ever looked up on the real internet.
export default function RegistryTab() {
  const { track } = useDesk();
  const paged = usePaged(track, 'registry', {}, 20);
  const [selected, setSelected] = useState('');
  const [filter, setFilter] = useState('');
  const current = paged.items.find((d) => d.name === selected) ?? paged.items[0];
  const needle = filter.trim().toLowerCase();
  const matches = useMemo(() => (needle.length < 2 ? [] : paged.items.flatMap((d) => d.dns
    .filter((r) => `${r.host} ${r.type} ${r.value}`.toLowerCase().includes(needle)).map((r) => ({ ...r, zone: d.name })))), [paged.items, needle]);
  return <div className="os-stack">
    <LoadState paged={paged} />
    <label className="os-grow">DNS finder (host name, record type or value, for example an IP address)
      <input value={filter} onChange={(e) => setFilter(e.target.value.slice(0, 64))} placeholder="203.0.113.7 or CNAME" autoComplete="off" />
    </label>
    {needle.length >= 2 && <div className="os-paper">
      <h3>{matches.length} matching record{matches.length === 1 ? '' : 's'}</h3>
      {matches.length > 0 && <div className="os-table-wrap"><table className="os-table">
        <thead><tr><th scope="col">Host</th><th scope="col">Type</th><th scope="col">Value</th><th scope="col">TTL</th><th scope="col">Zone</th></tr></thead>
        <tbody>{matches.slice(0, 40).map((r, i) => <tr key={`${r.host}-${r.type}-${i}`}><td>{r.host}</td><td>{r.type}</td><td>{r.value}</td><td>{r.ttl}</td><td>{r.zone}</td></tr>)}</tbody>
      </table></div>}
    </div>}
    {current && <>
      <div className="os-subtabs" role="group" aria-label="Domains">
        {paged.items.map((d) => <button key={d.name} type="button" className={d.name === current.name ? '' : 'secondary'} aria-pressed={d.name === current.name} onClick={() => setSelected(d.name)}>{d.name}</button>)}
      </div>
      <article className="os-paper">
        <h3>WHOIS {current.name}</h3>
        <dl className="os-kv">
          <dt>Registrar</dt><dd>{current.whois.registrar}</dd>
          <dt>Created</dt><dd>{current.whois.created}</dd>
          <dt>Updated</dt><dd>{current.whois.updated}</dd>
          <dt>Expires</dt><dd>{current.whois.expires}</dd>
          <dt>Status</dt><dd>{current.whois.status.join(', ')}</dd>
          <dt>Registrant name</dt><dd>{current.whois.registrant.name}</dd>
          <dt>Registrant org</dt><dd>{current.whois.registrant.org ?? '-'}</dd>
          <dt>Registrant city</dt><dd>{current.whois.registrant.city}</dd>
          <dt>Contact</dt><dd>{current.whois.registrant.email}</dd>
          <dt>Name servers</dt><dd>{current.whois.nameservers.join(', ')}</dd>
        </dl>
        <h4>DNS records</h4>
        {current.dns.length === 0 ? <p className="os-muted">No records published in this zone view. Hosts of this provider appear in other zones' records.</p>
          : <div className="os-table-wrap"><table className="os-table">
            <thead><tr><th scope="col">Host</th><th scope="col">Type</th><th scope="col">Value</th><th scope="col">TTL</th></tr></thead>
            <tbody>{current.dns.map((r, i) => <tr key={`${r.host}-${r.type}-${i}`}><td>{r.host}</td><td>{r.type}</td><td>{r.value}</td><td>{r.ttl}</td></tr>)}</tbody>
          </table></div>}
        <PinButton source="registry" id={current.name} title={`WHOIS ${current.name}`} text={`${current.name}: registrant ${current.whois.registrant.name} (${current.whois.registrant.city}), created ${current.whois.created}, registrar ${current.whois.registrar}`} />
      </article>
    </>}
  </div>;
}
