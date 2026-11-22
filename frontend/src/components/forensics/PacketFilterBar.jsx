import { useEffect, useId, useState } from 'react';

const EXAMPLES = [
  'dns',
  'http && frame contains "beacon"',
  'ip.addr == 10.0.1.21',
  'tcp.port == 9001',
  '!(dns || tls) && udp',
  'frame contains "x-task"',
];

// Display filter box with a result count and a short syntax help. `parsed` comes from parseFilter().
export default function PacketFilterBar({ value, onChange, parsed, shown, loaded, total, loading }) {
  const helpId = useId();
  const summary = !parsed.ok ? `Filter error: ${parsed.error}`
    : `${shown.toLocaleString()} of ${loaded.toLocaleString()} packets shown${loading ? ` (loading ${loaded}/${total || '?'})` : ''}`;
  // Screen readers get one short message after typing pauses (about 600 ms), not one per keystroke or loaded page.
  const [announced, setAnnounced] = useState(summary);
  useEffect(() => {
    const timer = setTimeout(() => setAnnounced(summary), 600);
    return () => clearTimeout(timer);
  }, [summary]);
  return <div className="fxp-filter">
    <form className="fx-controls" onSubmit={(event) => event.preventDefault()} role="search">
      <label className="fx-grow">Display filter
        <input
          value={value} onChange={(event) => onChange(event.target.value)} maxLength={200} spellCheck="false" autoComplete="off"
          placeholder='e.g. dns && ip.src == 10.0.1.21' aria-invalid={!parsed.ok} aria-describedby={helpId}
        />
      </label>
      <button type="button" className="secondary" onClick={() => onChange('')} disabled={value === ''}>Clear</button>
    </form>
    <p id={helpId} className="fx-status">
      {!parsed.ok ? <span className="fx-bad">{summary}</span> : summary}
    </p>
    <p className="fx-sr" role="status" aria-atomic="true">{announced}</p>
    <details className="fxp-help">
      <summary>Filter syntax</summary>
      <ul>
        <li><code>ip.addr == x</code>, <code>ip.src == x</code>, <code>ip.dst == x</code>, <code>tcp.port == n</code>, <code>udp.port == n</code>, <code>port == n</code>, <code>frame.len &gt; n</code></li>
        <li><code>eth.addr == 02:aa:bb:cc:dd:ee</code>, <code>eth.src == x</code>, <code>eth.dst == x</code> match the (simulated) hardware addresses shown in the Ethernet layer</li>
        <li><code>dns</code> <code>http</code> <code>tls</code> <code>tcp</code> <code>udp</code> <code>icmp</code> <code>ntp</code> match one protocol</li>
        <li><code>frame contains "text"</code> searches the summary and the payload. <code>info contains</code> and <code>payload contains</code> narrow it.</li>
        <li>Combine with <code>&amp;&amp;</code> (and), <code>||</code> (or), <code>!</code> (not) and parentheses. A word on its own searches every column.</li>
      </ul>
      <div className="fxp-chips" role="group" aria-label="Example filters">
        {EXAMPLES.map((example) => <button key={example} type="button" className="secondary small" onClick={() => onChange(example)}>{example}</button>)}
      </div>
    </details>
  </div>;
}
