import { useId, useState } from 'react';
import {
  base64Decode, base64Encode, diffLines, formatRawRequest, toCurl, urlDecode, urlEncode,
} from './helpers.js';

// Unlocked after the first solve: Base64 / URL encode and decode. Pure browser helpers, nothing is sent anywhere.
export function Decoder() {
  const id = useId();
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const apply = (label, fn) => {
    const result = fn(text);
    if (result && result.ok === false) { setNote(`${label}: that is not valid input for this decoder.`); return; }
    setText(typeof result === 'string' ? result : result.value);
    setNote(`${label} done.`);
  };
  return <div className="wl-tool">
    <label htmlFor={id}>Decoder workbench</label>
    <textarea id={id} rows={4} value={text} maxLength={2000} spellCheck="false" onChange={(event) => setText(event.target.value)} />
    <div className="wl-row">
      <button type="button" className="secondary small" onClick={() => apply('Base64 encode', (v) => base64Encode(v))}>Base64 encode</button>
      <button type="button" className="secondary small" onClick={() => apply('Base64 decode', base64Decode)}>Base64 decode</button>
      <button type="button" className="secondary small" onClick={() => apply('Base64url encode', (v) => base64Encode(v, { url: true }))}>Base64url encode</button>
      <button type="button" className="secondary small" onClick={() => apply('URL encode', urlEncode)}>URL encode</button>
      <button type="button" className="secondary small" onClick={() => apply('URL decode', urlDecode)}>URL decode</button>
    </div>
    <p className="wl-muted" role="status">{note || 'Paste a cookie, token part or parameter, then transform it. Copy the result back into the request.'}</p>
  </div>;
}

export function HistoryList({ history, onReplay }) {
  if (history.length === 0) { return <p className="wl-muted">Requests you send will be listed here.</p>; }
  return <ol className="wl-history">
    {history.map((entry, index) => <li key={entry.id}>
      <button type="button" className="secondary small" onClick={() => onReplay(entry)}>
        <span className="wl-method">{entry.payload.method}</span>
        <span className="wl-history-path">{entry.payload.path}</span>
        <span className="wl-history-status">{entry.status}</span>
        <span className="wl-sr"> (request {history.length - index}, load into editor)</span>
      </button>
    </li>)}
  </ol>;
}

export function DiffView({ previous, current }) {
  if (!previous || !current) { return <p className="wl-muted">Send at least two requests to compare their responses.</p>; }
  const lines = diffLines(previous.body, current.body);
  const changed = lines.filter((line) => line.type !== 'same').length;
  return <div>
    <p className="wl-muted" role="status">{changed === 0 ? 'The last two responses have the same body.' : `${changed} changed line${changed === 1 ? '' : 's'}.`}</p>
    <pre className="wl-code wl-diff" tabIndex={0}>
      {lines.map((line, index) => <span key={index} className={`is-${line.type}`}>
        <span aria-hidden="true">{line.type === 'add' ? '+ ' : line.type === 'del' ? '- ' : '  '}</span>
        <span className="wl-sr">{line.type === 'add' ? 'added: ' : line.type === 'del' ? 'removed: ' : ''}</span>
        {line.text}{'\n'}
      </span>)}
    </pre>
  </div>;
}

export function CurlBox({ payload }) {
  const [copied, setCopied] = useState('');
  if (!payload) { return <p className="wl-muted">Fix the request errors first.</p>; }
  const command = toCurl(payload);
  const raw = formatRawRequest(payload);
  const copy = async () => {
    try { await navigator.clipboard.writeText(command); setCopied('Copied.'); } catch { setCopied('Copy failed: select the text and copy it by hand.'); }
  };
  return <div className="wl-tool">
    <pre className="wl-code" tabIndex={0}>{command}</pre>
    <div className="wl-row"><button type="button" className="secondary small" onClick={copy}>Copy as curl</button><span role="status" className="wl-muted">{copied}</span></div>
    <details><summary>Raw HTTP</summary><pre className="wl-code" tabIndex={0}>{raw}</pre></details>
    <p className="wl-muted">The target is simulated: this command is only a copy helper and will not reach anything real.</p>
  </div>;
}
