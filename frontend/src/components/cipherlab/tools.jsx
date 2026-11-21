import { useEffect, useMemo, useState } from 'react';
import {
  ALPHABET, ENGLISH_FREQ, PIPELINE_OPS, applySubstitution, atbash, base64ToText, caesarShift, factorSemiprime, hexToText,
  keyFromCrib, letterFrequency, mappingConflicts, modInverse, modPow, railDecode, reverseText, runPipeline, sha256Hex,
  shortestRepeat, vigenereDecode, xorHexDecode, xorKeyFromCrib,
} from './decoders.js';

// The decoder toolbox. Every tool is client-side only. They share one working text (`text`) so the output of one
// tool can be sent on to the next with "use as input".

function Result({ label = 'Result', value, onUse }) {
  return <div className="cl-result">
    <div className="cl-result-head">
      <span>{label}</span>
      {onUse && value && <button type="button" className="secondary small" onClick={() => onUse(value)}>Use as input</button>}
    </div>
    <output aria-live="polite" className="cl-output">{value ?? 'Cannot decode this input with this tool.'}</output>
  </div>;
}

export function ShiftTool({ text, setText }) {
  const [shift, setShift] = useState(3);
  const [mirror, setMirror] = useState(false);
  const out = useMemo(() => (mirror ? atbash(text) : caesarShift(text, -shift)), [text, shift, mirror]);
  return <div className="cl-tool">
    <label htmlFor="cl-shift">Shift back by <strong>{shift}</strong></label>
    <input id="cl-shift" type="range" min="0" max="25" value={shift} disabled={mirror} onChange={(event) => setShift(Number(event.target.value))} />
    <div className="cl-chips">
      <button type="button" className="secondary small" onClick={() => setShift(13)} disabled={mirror}>ROT13</button>
      <label className="cl-check"><input type="checkbox" checked={mirror} onChange={(event) => setMirror(event.target.checked)} /> Atbash mirror</label>
    </div>
    <Result value={out} onUse={setText} />
  </div>;
}

export function FrequencyTool({ text }) {
  const { percent, counts, total } = useMemo(() => letterFrequency(text), [text]);
  const top = counts.map((count, i) => [ALPHABET[i], count]).sort((a, b) => b[1] - a[1]).slice(0, 3).filter(([, c]) => c > 0);
  const max = Math.max(...percent, ...ENGLISH_FREQ);
  return <div className="cl-tool">
    <p className="cl-note">{total === 0 ? 'No letters in the working text.' : `${total} letters. Most common: ${top.map(([l, c]) => `${l} (${c})`).join(', ')}.`}</p>
    <div className="cl-freq" role="img" aria-label={`Letter frequency chart. ${top.map(([l, c]) => `${l} appears ${c} times`).join(', ')}.`}>
      {ALPHABET.split('').map((letter, i) => <div className="cl-freq-col" key={letter}>
        <div className="cl-freq-bars">
          <span className="cl-freq-bar" style={{ height: `${(percent[i] / max) * 100}%` }} />
          <span className="cl-freq-ref" style={{ bottom: `${(ENGLISH_FREQ[i] / max) * 100}%` }} />
        </div>
        <span className="cl-freq-letter">{letter}</span>
      </div>)}
    </div>
    <p className="cl-note"><span className="cl-key cl-key-bar" /> your text <span className="cl-key cl-key-ref" /> typical English (E, T, A lead)</p>
  </div>;
}

export function CodecTool({ text, setText }) {
  const [out, setOut] = useState({ label: 'Result', value: '' });
  const run = (label, fn) => setOut({ label, value: fn(text) });
  return <div className="cl-tool">
    <div className="cl-chips">
      <button type="button" className="secondary small" onClick={() => run('Base64 decoded', base64ToText)}>Base64 decode</button>
      <button type="button" className="secondary small" onClick={() => run('Hex decoded', hexToText)}>Hex decode</button>
      <button type="button" className="secondary small" onClick={() => run('Reversed', reverseText)}>Reverse</button>
    </div>
    {out.value !== '' && <Result label={out.label} value={out.value} onUse={setText} />}
  </div>;
}

export function VigenereTool({ text, setText, puzzle }) {
  const [key, setKey] = useState('');
  const [crib, setCrib] = useState(puzzle?.params?.crib ?? '');
  const limit = puzzle?.params?.keyLength;
  const found = useMemo(() => {
    const raw = keyFromCrib(text, crib);
    return limit && raw.length >= limit ? raw.slice(0, limit) : shortestRepeat(raw);
  }, [text, crib, limit]);
  return <div className="cl-tool">
    <label>Crib (a word you know the message starts with)<input value={crib} onChange={(event) => setCrib(event.target.value)} spellCheck="false" autoComplete="off" /></label>
    <p className="cl-note">Key from crib: <code>{found || '-'}</code> <button type="button" className="secondary small" onClick={() => setKey(found)} disabled={!found}>Try it</button></p>
    <label>Key<input value={key} onChange={(event) => setKey(event.target.value)} spellCheck="false" autoComplete="off" /></label>
    <Result value={key ? vigenereDecode(text, key) : null} onUse={setText} />
  </div>;
}

export function XorTool({ text, setText, puzzle }) {
  const [key, setKey] = useState('');
  const [crib, setCrib] = useState(puzzle?.params?.crib ?? '');
  const found = useMemo(() => xorKeyFromCrib(text, crib), [text, crib]);
  const limit = puzzle?.params?.keyLength;
  return <div className="cl-tool">
    <label>Crib (known start of the message, spaces count)<input value={crib} onChange={(event) => setCrib(event.target.value)} spellCheck="false" autoComplete="off" /></label>
    <p className="cl-note">Key bytes from crib: <code>{found || '-'}</code>{limit ? ` (the key is ${limit} long: use the first ${limit})` : ''}{' '}
      <button type="button" className="secondary small" onClick={() => setKey(limit ? found.slice(0, limit) : found)} disabled={!found}>Try it</button></p>
    <label>Key<input value={key} onChange={(event) => setKey(event.target.value)} spellCheck="false" autoComplete="off" /></label>
    <Result value={key ? xorHexDecode(text, key) : null} onUse={setText} />
  </div>;
}

export function RailTool({ text, setText, puzzle }) {
  const [rails, setRails] = useState(puzzle?.params?.rails ?? 3);
  return <div className="cl-tool">
    <label htmlFor="cl-rails">Rails <strong>{rails}</strong></label>
    <input id="cl-rails" type="range" min="2" max="8" value={rails} onChange={(event) => setRails(Number(event.target.value))} />
    <Result value={railDecode(text, rails)} onUse={setText} />
  </div>;
}

export function SubstitutionTool({ text }) {
  const [mapping, setMapping] = useState({});
  const present = useMemo(() => ALPHABET.split('').filter((letter) => text.toUpperCase().includes(letter)), [text]);
  const conflicts = mappingConflicts(mapping);
  const set = (letter, value) => setMapping((current) => ({ ...current, [letter]: value.replace(/[^a-zA-Z]/g, '').slice(-1) }));
  return <div className="cl-tool">
    <p className="cl-note">Type the plain letter you think each cipher letter stands for.</p>
    <div className="cl-map">
      {present.map((letter) => <label key={letter} className={conflicts.includes(letter) ? 'cl-map-bad' : undefined}>
        <span>{letter}</span>
        <input value={mapping[letter] ?? ''} maxLength={2} onChange={(event) => set(letter, event.target.value)} aria-label={`Cipher letter ${letter} stands for`} autoComplete="off" spellCheck="false" />
      </label>)}
    </div>
    {conflicts.length > 0 && <p role="alert" className="cl-warn">Two cipher letters map to the same plain letter: {conflicts.join(', ')}.</p>}
    <Result label="Decoded so far" value={applySubstitution(text, mapping)} />
  </div>;
}

export function RsaTool({ puzzle }) {
  const params = puzzle?.params ?? {};
  const [n, setN] = useState(String(params.n ?? ''));
  const [e, setE] = useState(String(params.e ?? ''));
  const [c, setC] = useState(String(puzzle?.ciphertext ?? ''));
  const factors = factorSemiprime(n);
  const phi = factors ? (factors[0] - 1) * (factors[1] - 1) : null;
  const d = phi ? modInverse(e, phi) : null;
  const m = d !== null && n && c ? modPow(c, d, n) : null;
  return <div className="cl-tool">
    <div className="cl-grid3">
      <label>n<input inputMode="numeric" value={n} onChange={(event) => setN(event.target.value.replace(/\D/g, ''))} /></label>
      <label>e<input inputMode="numeric" value={e} onChange={(event) => setE(event.target.value.replace(/\D/g, ''))} /></label>
      <label>c<input inputMode="numeric" value={c} onChange={(event) => setC(event.target.value.replace(/\D/g, ''))} /></label>
    </div>
    <dl className="cl-facts">
      <dt>p, q</dt><dd>{factors ? factors.join(' x ') : 'enter n'}</dd>
      <dt>phi</dt><dd>{phi ?? '-'}</dd>
      <dt>d</dt><dd>{d ?? '-'}</dd>
      <dt>m = c^d mod n</dt><dd>{m ?? '-'}</dd>
    </dl>
  </div>;
}

export function HashTool({ puzzle }) {
  const params = puzzle?.params ?? {};
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    const candidates = params.candidates ?? [];
    setRows(await Promise.all(candidates.map(async (word) => ({ word, hash: await sha256Hex(`${params.salt}${word}`) }))));
    setBusy(false);
  }
  useEffect(() => { setRows(null); }, [puzzle?.id]);
  const match = rows?.find((row) => row.hash === puzzle?.ciphertext);
  return <div className="cl-tool">
    <p className="cl-note">Salt <code>{params.salt ?? '-'}</code>, {params.candidates?.length ?? 0} candidates. Target <code className="cl-break">{puzzle?.ciphertext}</code></p>
    <button type="button" className="secondary small" onClick={run} disabled={busy || !params.candidates}>{busy ? 'Hashing…' : 'Hash all candidates'}</button>
    {rows && <p role="status" className={match ? 'cl-good' : 'cl-warn'}>{match ? `Match: ${match.word}` : 'No candidate matches.'}</p>}
    {rows && <ul className="cl-hashes">{rows.map((row) => <li key={row.word} className={row === match ? 'is-match' : undefined}><span>{row.word}</span><code>{row.hash.slice(0, 16)}…</code></li>)}</ul>}
  </div>;
}

export function PipelineTool({ text, setText }) {
  const [steps, setSteps] = useState([]);
  const trail = useMemo(() => runPipeline(text, steps), [text, steps]);
  const add = (id) => setSteps((current) => [...current, { op: id, arg: id === 'caesar' ? -3 : id === 'rail' ? 3 : '' }]);
  const update = (index, arg) => setSteps((current) => current.map((step, i) => (i === index ? { ...step, arg } : step)));
  return <div className="cl-tool">
    <div className="cl-chips">
      {PIPELINE_OPS.map((op) => <button key={op.id} type="button" className="secondary small" onClick={() => add(op.id)}>+ {op.label}</button>)}
    </div>
    <ol className="cl-steps">
      {steps.map((step, index) => {
        const def = PIPELINE_OPS.find((op) => op.id === step.op);
        return <li key={index}>
          <span>{def.label}</span>
          {def.arg && <input aria-label={`${def.label} value`} value={step.arg} inputMode={def.arg === 'number' ? 'numeric' : 'text'} onChange={(event) => update(index, event.target.value)} />}
          <button type="button" className="secondary small" onClick={() => setSteps((s) => s.filter((_, i) => i !== index))} aria-label={`Remove step ${index + 1}`}>x</button>
        </li>;
      })}
    </ol>
    <ol className="cl-trail" aria-label="Pipeline output after each step">
      {trail.map((item, index) => <li key={index}><span>{item.label}</span><code>{item.text ?? 'cannot decode'}</code></li>)}
    </ol>
    {steps.length > 0 && trail.at(-1).text && <button type="button" className="secondary small" onClick={() => setText(trail.at(-1).text)}>Use last output as input</button>}
  </div>;
}

export const TOOL_COMPONENTS = {
  shift: ShiftTool,
  frequency: FrequencyTool,
  codec: CodecTool,
  vigenere: VigenereTool,
  xor: XorTool,
  rail: RailTool,
  substitution: SubstitutionTool,
  rsa: RsaTool,
  hash: HashTool,
  pipeline: PipelineTool,
};
