import { useState } from 'react';
import { useDesk } from './DeskContext.jsx';
import { MAX_NOTES, MAX_NOTE_TEXT, SOURCE_LABEL } from '../../osint/helpers.js';
import { decodeBase64, decodeHexText, rot13 } from '../../forensics/hex.js';

const DECODERS = { base64: decodeBase64, hex: decodeHexText, rot13: (text) => ({ ok: true, text: rot13(text) }) };

function Decoder() {
  const [input, setInput] = useState('');
  const [kind, setKind] = useState('base64');
  const result = input.trim() === '' ? null : DECODERS[kind](input.slice(0, 2000));
  return <section className="os-paper os-stack" aria-label="Decoder">
    <h3>Decoder</h3>
    <label>Paste encoded text<textarea rows={3} value={input} onChange={(e) => setInput(e.target.value)} maxLength={2000} spellCheck="false" /></label>
    <label>Decode as<select value={kind} onChange={(e) => setKind(e.target.value)}><option value="base64">base64</option><option value="hex">hex</option><option value="rot13">ROT13</option></select></label>
    <output className="os-decoded" aria-live="polite">{result ? result.text : '(waiting for input)'}</output>
  </section>;
}

// The evidence notebook: pinned items and free notes, stored in this browser (localStorage) and nowhere else.
export default function NotesTab() {
  const desk = useDesk();
  const [text, setText] = useState('');
  function add(event) {
    event.preventDefault();
    desk.note(text);
    setText('');
  }
  return <div className="os-stack">
    <p className="os-muted">Your notebook lives in this browser only. Pin evidence from any tab, add your own notes, and use the board to connect the dots. {desk.notes.length}/{MAX_NOTES} used.</p>
    <form className="os-controls" onSubmit={add}>
      <label className="os-grow">New note<textarea rows={2} value={text} maxLength={MAX_NOTE_TEXT} onChange={(e) => setText(e.target.value)} placeholder="Handle X posts from the pier at 20:00 local..." /></label>
      <button type="submit" disabled={text.trim() === '' || desk.notes.length >= MAX_NOTES}>Add note</button>
    </form>
    {desk.notes.length === 0 ? <p className="os-muted">The board is empty. Use "Pin to board" next to any evidence.</p>
      : <ul className="os-board os-plain" aria-label="Evidence board">{desk.notes.map((n) => <li key={n.id} className={`os-card os-card-${n.kind}`}>
        <span className="os-tack" aria-hidden="true" />
        <p className="os-meta">{SOURCE_LABEL[n.source.replace(/^search-/, '')] ?? 'Note'}{n.kind === 'pin' ? `: ${n.title}` : ''}</p>
        <p>{n.text}</p>
        <button type="button" className="secondary small" onClick={() => desk.remove(n.id)}>Remove<span className="os-sr"> {n.title}</span></button>
      </li>)}</ul>}
    <Decoder />
  </div>;
}
