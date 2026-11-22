import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ANALYSIS_TOOLS, MAX_CHAIN_STEPS, MAX_INPUT_CHARS, availableOps, defaultParams, describeIC, indexOfCoincidence, magic, opById, runChain,
} from '../../cipherlab/ops.js';
import { ENGLISH_FREQ, letterFrequency } from './decoders.js';
import { useDebouncedValue } from '../../a11y/timed.js';
import './bench.css';

// The Recipe workbench: an ordered chain of operations with live output after each step. Client-side only. The input
// is the shared "Working text" box above the tools. Which operations are offered depends on the toolbox tools unlocked.

const SHOW_CHARS = 2000; // output previews are cut here; copy and "use as input" always take the full text
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function ParamField({ stepId, param, value, onChange }) {
  const id = `wb-${stepId}-${param.key}`;
  if (param.type === 'select') {
    return <label htmlFor={id}>{param.label}
      <select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
        {param.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>;
  }
  return <label htmlFor={id}>{param.label}
    <input
      id={id}
      type={param.type === 'number' ? 'number' : 'text'}
      inputMode={param.type === 'number' ? 'numeric' : undefined}
      min={param.min}
      max={param.max}
      value={value}
      spellCheck="false"
      autoComplete="off"
      onChange={(event) => onChange(event.target.value)}
    />
  </label>;
}

function Analysis({ unlocked, stages, onAdd }) {
  const [stage, setStage] = useState('last');
  const [hints, setHints] = useState(null);
  const chosen = stage === 'last' || !stages[stage] ? stages.at(-1) : stages[stage];
  const analysed = chosen?.text ?? '';
  const freqOpen = unlocked.includes(ANALYSIS_TOOLS.frequency);
  const { percent, counts, total } = useMemo(() => letterFrequency(analysed), [analysed]);
  const ic = useMemo(() => indexOfCoincidence(analysed), [analysed]);
  const top = counts.map((count, i) => [ALPHABET[i], count]).sort((a, b) => b[1] - a[1]).slice(0, 3).filter(([, c]) => c > 0);
  const max = Math.max(...percent, ...ENGLISH_FREQ);
  const run = () => {
    const all = magic(analysed);
    const usable = all.filter((item) => item.op === null || availableOps(unlocked).some((op) => op.id === item.op));
    setHints({ list: usable, hidden: all.length - usable.length });
  };
  useEffect(() => { setHints(null); }, [analysed]);
  return <section className="wb-analysis" aria-labelledby="wb-analysis-title">
    <h3 id="wb-analysis-title">Analyse</h3>
    <label htmlFor="wb-stage">Look at
      <select id="wb-stage" value={stage} onChange={(event) => setStage(event.target.value)}>
        <option value="last">Latest text ({chosen?.label ?? 'input'})</option>
        {stages.map((item, index) => <option key={index} value={index}>{item.label}</option>)}
      </select>
    </label>
    <div className="wb-magic">
      <button type="button" className="secondary small" onClick={run} disabled={analysed.length === 0}>Magic: suggest next steps</button>
      <p className="cl-note">Heuristic hints about what the text looks like. It never decodes for you or looks for a flag.</p>
      {hints && <div role="status">
        {hints.list.length === 0 && <p className="cl-note">No suggestions for this text.</p>}
        <ul className="wb-hints">
          {hints.list.map((item, index) => <li key={`${item.op}-${index}`}>
            <span>{item.op ? <strong>{opById(item.op).label}.</strong> : null} {item.reason}</span>
            {item.op && <button type="button" className="secondary small" onClick={() => onAdd(item.op, item.params)}>Add step</button>}
          </li>)}
        </ul>
        {hints.hidden > 0 && <p className="cl-note">{hints.hidden} more suggestion{hints.hidden === 1 ? '' : 's'} need a toolbox tool you have not unlocked yet.</p>}
      </div>}
    </div>
    {freqOpen
      ? <div className="wb-freq">
        <p className="cl-note">
          {total === 0 ? 'No letters in this text.' : `${total} letters. Most common: ${top.map(([l, c]) => `${l} (${c})`).join(', ')}.`}{' '}
          Index of coincidence: <strong>{ic === null ? 'n/a' : ic.toFixed(3)}</strong> (English about 0.066, random about 0.038). {describeIC(ic)}
        </p>
        <div className="cl-freq" role="img" aria-label={`Letter frequency chart. ${top.map(([l, c]) => `${l} appears ${c} times`).join(', ') || 'No letters'}.`}>
          {ALPHABET.split('').map((letter, i) => <div className="cl-freq-col" key={letter}>
            <div className="cl-freq-bars">
              <span className="cl-freq-bar" style={{ height: `${(percent[i] / max) * 100}%` }} />
              <span className="cl-freq-ref" style={{ bottom: `${(ENGLISH_FREQ[i] / max) * 100}%` }} />
            </div>
            <span className="cl-freq-letter">{letter}</span>
          </div>)}
        </div>
        <p className="cl-note"><span className="cl-key cl-key-bar" /> your text <span className="cl-key cl-key-ref" /> typical English</p>
      </div>
      : <p className="cl-note">Letter frequency and index of coincidence unlock together with the Frequency chart tool.</p>}
  </section>;
}

export default function Workbench({ text, setText, unlocked = [] }) {
  const [steps, setSteps] = useState([]);
  const [pick, setPick] = useState('');
  const [message, setMessage] = useState('');
  const nextId = useRef(1);
  const pendingFocus = useRef(null);
  const unlockKey = unlocked.join(',');
  const ops = useMemo(() => availableOps(unlocked), [unlockKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const groups = useMemo(() => [...new Set(ops.map((op) => op.group))], [ops]);
  const run = useMemo(() => runChain(text, steps, { unlockedTools: unlocked }), [text, steps, unlockKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const atCap = steps.length >= MAX_CHAIN_STEPS;
  const selected = ops.some((op) => op.id === pick) ? pick : (ops[0]?.id ?? '');

  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) { return; }
    pendingFocus.current = null;
    const el = document.getElementById(target.primary);
    (el && !el.disabled ? el : document.getElementById(target.fallback))?.focus();
  }, [steps]);

  const addStep = (opId, params = {}) => {
    const op = opById(opId);
    if (!op || atCap) { return; }
    setSteps((current) => (current.length >= MAX_CHAIN_STEPS ? current : [...current, { id: nextId.current++, op: opId, params: { ...defaultParams(op), ...params } }]));
    setMessage(`Added ${op.label}. The chain has ${Math.min(steps.length + 1, MAX_CHAIN_STEPS)} steps.`);
  };
  const setParam = (id, key, value) => setSteps((current) => current.map((step) => (step.id === id ? { ...step, params: { ...step.params, [key]: value } } : step)));
  const remove = (index) => {
    setSteps((current) => current.filter((_, i) => i !== index));
    setMessage(`Removed step ${index + 1}.`);
  };
  const move = (index, delta) => {
    const target = index + delta;
    if (target < 0 || target >= steps.length) { return; }
    const id = steps[index].id;
    pendingFocus.current = { primary: `wb-${delta < 0 ? 'up' : 'down'}-${id}`, fallback: `wb-${delta < 0 ? 'down' : 'up'}-${id}` };
    setSteps((current) => {
      const copy = [...current];
      [copy[index], copy[target]] = [copy[target], copy[index]];
      return copy;
    });
    setMessage(`Moved ${opById(steps[index].op).label} to position ${target + 1} of ${steps.length}.`);
  };
  const clear = () => { setSteps([]); setMessage('Chain cleared.'); };
  async function copy(value) {
    try { await navigator.clipboard.writeText(value); setMessage('Output copied.'); } catch { setMessage('Copy was blocked by the browser. Select the output and copy it by hand.'); }
  }
  // Feeding step N back as the input removes steps 1..N, so running the chain again does not decode twice.
  const feedBack = (index) => {
    setText(run.results[index].text);
    setSteps((current) => current.slice(index + 1));
    setMessage(`Step ${index + 1} output is now the working text.`);
  };

  const stages = [{ label: 'input', text }, ...run.results.filter((r) => r.ok).map((r, i) => ({ label: `step ${i + 1}: ${opById(r.op).label}`, text: r.text }))];
  const last = run.results.at(-1);
  const failedAt = run.results.findIndex((r) => !r.ok && !r.skipped);
  const summary = run.inputError
    || (failedAt >= 0 ? `Step ${failedAt + 1} failed: ${run.results[failedAt].error}` : last?.ok ? `Recipe ran: ${steps.length} step${steps.length === 1 ? '' : 's'}, output ${last.text.length} characters` : '');
  // The only live region of the workbench: one short line, announced after typing has paused (never the 2000-character output).
  const status = useDebouncedValue(`${message} ${summary}`.trim(), 600);

  return <div className="cl-tool wb">
    <p className="cl-note">The input is the Working text above ({text.length} of {MAX_INPUT_CHARS} characters). Build a chain of up to {MAX_CHAIN_STEPS} steps; each step feeds the next.</p>
    {run.inputError && <p className="wb-error" role="alert">{run.inputError}</p>}

    <div className="wb-add">
      <label htmlFor="wb-op">Operation
        <select id="wb-op" value={selected} onChange={(event) => setPick(event.target.value)} disabled={ops.length === 0}>
          {groups.map((group) => <optgroup key={group} label={group}>
            {ops.filter((op) => op.group === group).map((op) => <option key={op.id} value={op.id}>{op.label}</option>)}
          </optgroup>)}
        </select>
      </label>
      <button type="button" onClick={() => addStep(selected)} disabled={!selected || atCap}>Add step</button>
      <button type="button" className="secondary" onClick={clear} disabled={steps.length === 0}>Clear chain</button>
    </div>
    {atCap && <p className="cl-note">The chain is full ({MAX_CHAIN_STEPS} steps). Remove a step, or use a step&apos;s output as the new input.</p>}

    {steps.length === 0 && <p className="cl-note">No steps yet. Pick an operation and add it, or ask Magic below what the text looks like.</p>}
    <ol className="wb-steps" aria-label="Recipe steps">
      {steps.map((step, index) => {
        const def = opById(step.op);
        const result = run.results[index];
        return <li key={step.id} className={`wb-step${result && !result.ok && !result.skipped ? ' is-error' : ''}${result?.skipped ? ' is-skipped' : ''}`}>
          <div className="wb-step-head">
            <span className="wb-num" aria-hidden="true">{index + 1}</span>
            <strong className="wb-name">{def.label}</strong>
            <div className="wb-actions">
              <button type="button" id={`wb-up-${step.id}`} className="secondary" onClick={() => move(index, -1)} disabled={index === 0} aria-label={`Move step ${index + 1}, ${def.label}, up`}>&uarr;</button>
              <button type="button" id={`wb-down-${step.id}`} className="secondary" onClick={() => move(index, 1)} disabled={index === steps.length - 1} aria-label={`Move step ${index + 1}, ${def.label}, down`}>&darr;</button>
              <button type="button" className="secondary" onClick={() => remove(index)} aria-label={`Remove step ${index + 1}, ${def.label}`}>&times;</button>
            </div>
          </div>
          {def.params.length > 0 && <div className="wb-params">
            {def.params.map((param) => <ParamField key={param.key} stepId={step.id} param={param} value={step.params[param.key] ?? ''} onChange={(value) => setParam(step.id, param.key, value)} />)}
          </div>}
          {result && !result.ok && <p className={result.skipped ? 'cl-note' : 'wb-error'}>{result.error}</p>}
          {result?.ok && <details className="wb-out" open>
            <summary>Output after step {index + 1} ({result.text.length} characters)</summary>
            {result.note && <p className="cl-note">{result.note}</p>}
            {result.candidates && <ol className="wb-cands" aria-label="Single-byte XOR candidates, best first">
              {result.candidates.map((cand) => <li key={cand.rank} className={Number(step.params.pick) === cand.rank ? 'is-picked' : undefined}>
                <span>#{cand.rank} key <code>0x{cand.keyHex}</code> score {cand.score}</span>
                <code className="wb-prev">{cand.preview}</code>
                <button type="button" className="secondary" onClick={() => setParam(step.id, 'pick', cand.rank)} aria-pressed={Number(step.params.pick) === cand.rank}>Use #{cand.rank}</button>
              </li>)}
            </ol>}
            <pre className="wb-pre" tabIndex={0} aria-label={`Output of step ${index + 1}`}>{result.text.slice(0, SHOW_CHARS)}{result.text.length > SHOW_CHARS ? `\n… (${result.text.length - SHOW_CHARS} more characters; copy to get all)` : ''}</pre>
            <div className="wb-actions">
              <button type="button" className="secondary" onClick={() => copy(result.text)}>Copy output</button>
              <button type="button" className="secondary" onClick={() => feedBack(index)} disabled={result.text.length === 0 || result.text.length > MAX_INPUT_CHARS}>Use as input</button>
            </div>
          </details>}
        </li>;
      })}
    </ol>
    {run.truncated > 0 && <p className="wb-error">{run.truncated} step{run.truncated === 1 ? ' is' : 's are'} past the {MAX_CHAIN_STEPS}-step limit and were not run.</p>}

    {steps.length > 0 && <section className="wb-final" aria-labelledby="wb-final-title">
      <h3 id="wb-final-title">Final output</h3>
      <output className="cl-output wb-final-out" aria-live="off">{last?.ok ? last.text.slice(0, SHOW_CHARS) : 'No output: fix the failing step above.'}</output>
      {last?.ok && <div className="wb-actions">
        <button type="button" className="secondary" onClick={() => copy(last.text)}>Copy output</button>
        <button type="button" className="secondary" onClick={() => feedBack(run.results.length - 1)} disabled={last.text.length === 0 || last.text.length > MAX_INPUT_CHARS}>Use as input</button>
      </div>}
    </section>}

    <Analysis unlocked={unlocked} stages={stages} onAdd={addStep} />
    <p className="wb-sr" role="status" aria-live="polite">{status}</p>
  </div>;
}
