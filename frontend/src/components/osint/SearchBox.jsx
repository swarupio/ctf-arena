import { useRef, useState } from 'react';
import { searchCase } from '../../api/osint.js';
import { PinButton } from './Common.jsx';
import { useDesk } from './DeskContext.jsx';
import { SOURCE_LABEL, SOURCE_TAB, describeOsintError, highlightParts } from '../../osint/helpers.js';

const PAGE = 10;

function Snippet({ text, query }) {
  return <>{highlightParts(text, query).map((part, i) => (part.hit ? <mark key={i}>{part.text}</mark> : <span key={i}>{part.text}</span>))}</>;
}

// Searches the whole case corpus on the server (bounded: at most 20 results a page, nothing stored).
export default function SearchBox() {
  const desk = useDesk();
  const [q, setQ] = useState('');
  const [state, setState] = useState({ results: [], query: '', hasMore: false, error: '', busy: false, done: false });
  const abort = useRef(null);

  async function run(query, offset) {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setState((s) => ({ ...s, busy: true, error: '' }));
    try {
      const page = await searchCase(desk.track, query, { offset, limit: PAGE }, { signal: controller.signal });
      setState((s) => ({ results: offset === 0 ? page.results : [...s.results, ...page.results], query, hasMore: page.hasMore, error: '', busy: false, done: true }));
    } catch (error) {
      if (error?.name !== 'AbortError') { setState((s) => ({ ...s, busy: false, error: describeOsintError(error) })); }
    }
  }
  function submit(event) {
    event.preventDefault();
    const query = q.trim();
    if (query.length >= 2) { void run(query, 0); }
  }

  return <section className="os-search" aria-label="Search the case corpus">
    <form onSubmit={submit} role="search" className="os-controls">
      <label className="os-grow">Search the case file
        <input type="search" value={q} onChange={(e) => setQ(e.target.value.slice(0, 64))} placeholder="a name, a handle, a street, a code..." autoComplete="off" />
      </label>
      <button type="submit" disabled={state.busy || q.trim().length < 2}>{state.busy ? 'Searching...' : 'Search'}</button>
      {state.done && <button type="button" className="secondary" onClick={() => setState({ results: [], query: '', hasMore: false, error: '', busy: false, done: false })}>Clear</button>}
    </form>
    <div aria-live="polite">
      {state.error && <p role="alert" className="error">{state.error}</p>}
      {state.done && !state.error && <p className="os-muted">{state.results.length === 0 ? 'No hits.' : `${state.results.length} hit${state.results.length === 1 ? '' : 's'}${state.hasMore ? ' so far' : ''}.`}</p>}
    </div>
    {state.results.length > 0 && <ul className="os-results os-plain">
      {state.results.map((r, i) => <li key={`${r.source}-${r.id}-${i}`} className="os-paper">
        <p className="os-meta">{SOURCE_LABEL[r.source] ?? r.source}: <strong>{r.title}</strong></p>
        <p><Snippet text={r.snippet} query={state.query} /></p>
        <div className="os-row-buttons">
          <button type="button" className="secondary small" onClick={() => desk.openTab(SOURCE_TAB[r.source] ?? 'feed')}>Open tab<span className="os-sr"> for {r.title}</span></button>
          <PinButton source={`search-${r.source}`} id={`${r.id}:${r.title}`} title={r.title} text={r.snippet} />
        </div>
      </li>)}
    </ul>}
    {state.hasMore && <button type="button" className="secondary" disabled={state.busy} onClick={() => run(state.query, state.results.length)}>More hits</button>}
  </section>;
}
