import { useId, useRef, useState } from 'react';
import { CurlBox, Decoder, DiffView, HistoryList } from './InspectorTools.jsx';
import { METHODS, buildPayload, statusQuip } from './helpers.js';

const TABS = [
  { id: 'request', label: 'Request', feature: 'edit' },
  { id: 'response', label: 'Response', feature: 'edit' },
  { id: 'decode', label: 'Decoder', feature: 'decode' },
  { id: 'history', label: 'History', feature: 'history' },
  { id: 'diff', label: 'Diff', feature: 'diff' },
  { id: 'curl', label: 'curl', feature: 'curl' },
];

function ResponseTab({ response }) {
  if (!response) { return <p className="wl-muted">No response yet. Edit the request and press Send.</p>; }
  return <div className="wl-response">
    <p className={`wl-quip${response.exploited ? ' is-win' : ''}`} role="status">
      <strong>{response.status}</strong> {statusQuip(response.status, response.exploited)}
    </p>
    <dl className="wl-kv">
      <div><dt>Content-Type</dt><dd>{response.contentType}</dd></div>
      {response.setCookies.map((cookie) => <div key={cookie.name}><dt>Set-Cookie</dt><dd>{cookie.name}={cookie.value}</dd></div>)}
    </dl>
    <pre className="wl-code" tabIndex={0} aria-label="Response body">{response.body}</pre>
  </div>;
}

// The raw request editor plus the tools that unlock as the team clears labs (`features` comes from the API).
export default function RequestInspector({
  draft, onDraftChange, onSend, onReset, busy, error, response, previous, history, onReplay, features,
}) {
  const id = useId();
  const [tab, setTab] = useState('request');
  const tabs = useRef(new Map());
  const unlocked = new Set(features.filter((feature) => feature.unlocked).map((feature) => feature.id));
  const need = new Map(features.map((feature) => [feature.id, feature.at]));
  const built = buildPayload(draft);
  const set = (field) => (event) => onDraftChange({ ...draft, [field]: event.target.value });
  const send = () => { if (built.ok) { onSend(built.payload); setTab('response'); } };

  // Locked tabs stay focusable (aria-disabled, not disabled) so keyboard and screen reader users can reach their tooltip.
  const isOpen = (item) => unlocked.has(item.feature);
  const onTabKey = (event, index) => {
    const last = TABS.length - 1;
    const target = { ArrowRight: index === last ? 0 : index + 1, ArrowLeft: index === 0 ? last : index - 1, Home: 0, End: last }[event.key];
    if (target === undefined) { return; }
    event.preventDefault();
    tabs.current.get(TABS[target].id)?.focus();
    if (isOpen(TABS[target])) { setTab(TABS[target].id); }
  };

  return <section className="wl-inspector" aria-label="Request inspector">
    <div className="wl-tabs" role="tablist" aria-label="Inspector tools">
      {TABS.map((item, index) => {
        const open = isOpen(item);
        const unlockNote = `Unlocks after ${need.get(item.feature)} solved lab${need.get(item.feature) === 1 ? '' : 's'}`;
        return <button
          key={item.id}
          ref={(node) => { if (node) { tabs.current.set(item.id, node); } else { tabs.current.delete(item.id); } }}
          type="button"
          role="tab"
          id={`${id}-tab-${item.id}`}
          aria-selected={tab === item.id}
          aria-controls={`${id}-panel`}
          tabIndex={tab === item.id ? 0 : -1}
          aria-disabled={open ? undefined : true}
          title={open ? undefined : unlockNote}
          onKeyDown={(event) => onTabKey(event, index)}
          className={`secondary small${tab === item.id ? ' is-active' : ''}`}
          onClick={() => { if (open) { setTab(item.id); } }}
        >
          {item.label}{open ? '' : ' (locked)'}{!open && <span className="wl-sr">. {unlockNote}</span>}
          {item.id === 'response' && response?.exploited && <span className="wl-ping" aria-hidden="true" />}
        </button>;
      })}
    </div>
    {TABS.some((item) => !isOpen(item)) && <ul className="wl-locks" aria-hidden="true">
      {TABS.filter((item) => !isOpen(item)).map((item) => <li key={item.id}>{item.label} unlocks after {need.get(item.feature)} solved lab{need.get(item.feature) === 1 ? '' : 's'}.</li>)}
    </ul>}
    <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${tab}`} className="wl-panel">
      {tab === 'request' && <form className="wl-request" onSubmit={(event) => { event.preventDefault(); send(); }}>
        <div className="wl-row wl-row-method">
          <label htmlFor={`${id}-method`}>Method</label>
          <select id={`${id}-method`} value={draft.method} onChange={set('method')}>
            {METHODS.map((method) => <option key={method}>{method}</option>)}
          </select>
          <label htmlFor={`${id}-path`} className="wl-sr">Path and query</label>
          <input id={`${id}-path`} className="wl-grow" value={draft.path} maxLength={300} spellCheck="false" onChange={set('path')} />
        </div>
        <label htmlFor={`${id}-headers`}>Headers (one per line, Name: value)</label>
        <textarea id={`${id}-headers`} rows={3} value={draft.headers} maxLength={4000} spellCheck="false" onChange={set('headers')} />
        <label htmlFor={`${id}-cookies`}>Cookies (name=value, one per line)</label>
        <textarea id={`${id}-cookies`} rows={3} value={draft.cookies} maxLength={4000} spellCheck="false" onChange={set('cookies')} />
        <label htmlFor={`${id}-body`}>Body ({draft.body.length}/2000)</label>
        <textarea id={`${id}-body`} rows={4} value={draft.body} maxLength={2000} spellCheck="false" onChange={set('body')} />
        {!built.ok && <p className="wl-notice is-error" role="alert">{built.error}</p>}
        {error && <p className="wl-notice is-error" role="alert">{error}</p>}
        <div className="wl-row">
          <button type="submit" disabled={busy || !built.ok}>{busy ? 'Sending...' : 'Send request'}</button>
          <button type="button" className="secondary" onClick={onReset} disabled={busy}>Reset to start</button>
        </div>
      </form>}
      {tab === 'response' && <ResponseTab response={response} />}
      {tab === 'decode' && <Decoder />}
      {tab === 'history' && <HistoryList history={history} onReplay={(entry) => { onReplay(entry); setTab('request'); }} />}
      {tab === 'diff' && <DiffView previous={previous} current={response} />}
      {tab === 'curl' && <CurlBox payload={built.ok ? built.payload : null} />}
    </div>
  </section>;
}
