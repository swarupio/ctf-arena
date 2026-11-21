import { useMemo, useState } from 'react';
import { filterLines, highlightParts, makeLineMatcher } from '../../forensics/logFilter.js';
import { usePagedArtefact } from './hooks.js';
import VirtualList from './VirtualList.jsx';

const PAGE = 500;
const pick = (page, offset) => page.lines.map((text, i) => ({ n: offset + i + 1, text }));

// Log viewer: pages arrive from the server (500 lines at most each), search/filter/regex run in the browser.
export default function LogViewer({ track, artefact }) {
  const { items, total, loading, error } = usePagedArtefact({ track, artefact: artefact.id, pageSize: PAGE, pick });
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState('text');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [invert, setInvert] = useState(false);
  const options = { query, mode, caseSensitive, invert };
  const matcher = useMemo(() => makeLineMatcher(options), [query, mode, caseSensitive, invert]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = useMemo(() => (matcher.ok ? filterLines(items, matcher) : items), [items, matcher]);

  return <section className="fx-tool" aria-label="Log viewer">
    <form className="fx-controls" onSubmit={(event) => event.preventDefault()} role="search">
      <label className="fx-grow">Search the log
        <input
          type="search" value={query} onChange={(event) => setQuery(event.target.value)} maxLength={80} spellCheck="false" autoComplete="off"
          placeholder={mode === 'regex' ? 'regex, e.g. Failed password.*from 1\\.2' : 'words, all must appear'} aria-invalid={!matcher.ok} aria-describedby="fx-log-help"
        />
      </label>
      <fieldset className="fx-toggles">
        <legend className="fx-sr">Search options</legend>
        <label className="fx-check"><input type="checkbox" checked={mode === 'regex'} onChange={(e) => setMode(e.target.checked ? 'regex' : 'text')} /> regex</label>
        <label className="fx-check"><input type="checkbox" checked={caseSensitive} onChange={(e) => setCaseSensitive(e.target.checked)} /> match case</label>
        <label className="fx-check"><input type="checkbox" checked={invert} onChange={(e) => setInvert(e.target.checked)} /> invert</label>
      </fieldset>
    </form>
    <p id="fx-log-help" className="fx-status" role="status">
      {!matcher.ok ? <span className="fx-bad">{matcher.error}</span>
        : `${shown.length.toLocaleString()} of ${items.length.toLocaleString()} lines${loading ? ` (loading ${items.length}/${total || '?'})` : ''}`}
      {mode === 'regex' && ' · regex is length- and complexity-limited'}
    </p>
    {error && <p role="alert" className="error">{error}</p>}
    <VirtualList
      count={shown.length} rowHeight={22} label="Log lines" className="fx-log"
      renderRow={(i) => {
        const line = shown[i];
        return <><span className="fx-ln" aria-hidden="true">{line.n}</span><span className="fx-text">
          {highlightParts(line.text, options).map((part, k) => (part.hit ? <mark key={k}>{part.text}</mark> : part.text))}
        </span></>;
      }}
    />
  </section>;
}
