import { useState } from 'react';
import { decodeBase64, decodeHexText, rot13 } from '../../forensics/hex.js';

const DECODERS = { base64: decodeBase64, hex: decodeHexText, rot13: (text) => ({ ok: true, text: rot13(text) }) };

// A pocket decoder: base64, hex and ROT13, all in the browser. Never sends anything anywhere.
export default function DecoderTool() {
  const [input, setInput] = useState('');
  const [kind, setKind] = useState('base64');
  const result = input.trim() === '' ? null : DECODERS[kind](input.slice(0, 2000));
  return <section className="fx-tool fx-decoder" aria-label="Decoder tool">
    <h3>Decoder</h3>
    <label>Paste encoded text<textarea rows={3} value={input} onChange={(e) => setInput(e.target.value)} maxLength={2000} spellCheck="false" /></label>
    <div className="fx-inline">
      <label>Decode as<select value={kind} onChange={(e) => setKind(e.target.value)}>
        <option value="base64">base64</option><option value="hex">hex</option><option value="rot13">ROT13</option></select></label>
    </div>
    <output className={`fx-decoded${result && !result.ok ? ' fx-bad' : ''}`} aria-live="polite">{result ? result.text : '(waiting for input)'}</output>
  </section>;
}
