import { useState } from 'react';
import { TOOL_COMPONENTS } from './tools.jsx';

// Tabs for the decoder toolbox. Tools the team has not unlocked yet stay visible (so the goal is clear) but disabled.
export default function Toolbox({ tools, puzzle }) {
  const firstOpen = tools.find((tool) => tool.unlocked)?.id ?? null;
  const [active, setActive] = useState(firstOpen);
  const [text, setText] = useState(puzzle?.ciphertext ?? '');
  const [seen, setSeen] = useState(puzzle?.id);
  if (seen !== puzzle?.id) { setSeen(puzzle?.id); setText(puzzle?.ciphertext ?? ''); }
  const Tool = active ? TOOL_COMPONENTS[active] : null;
  const move = (event, index) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!step) { return; }
    event.preventDefault();
    const open = tools.filter((tool) => tool.unlocked);
    const current = open.findIndex((tool) => tool.id === tools[index].id);
    const next = open[(current + step + open.length) % open.length];
    setActive(next.id);
    document.getElementById(`cl-tab-${next.id}`)?.focus();
  };
  return <section className="cl-box cl-toolbox" aria-labelledby="cl-toolbox-title">
    <h2 id="cl-toolbox-title">Decoder toolbox</h2>
    <div role="tablist" aria-label="Decoder tools" className="cl-tabs">
      {tools.map((tool, index) => <button
        key={tool.id}
        id={`cl-tab-${tool.id}`}
        type="button"
        role="tab"
        aria-selected={active === tool.id}
        aria-controls="cl-tool-panel"
        tabIndex={active === tool.id ? 0 : -1}
        className={`cl-tab${active === tool.id ? ' is-active' : ''}${tool.unlocked ? '' : ' is-locked'}`}
        disabled={!tool.unlocked}
        title={tool.unlocked ? tool.description : `Locked: clear level ${tool.unlockedBy.toUpperCase()} to unlock`}
        onClick={() => setActive(tool.id)}
        onKeyDown={(event) => move(event, index)}
      >{tool.unlocked ? tool.name : `Locked · ${tool.unlockedBy.toUpperCase()}`}</button>)}
    </div>
    <div id="cl-tool-panel" role="tabpanel" aria-labelledby={active ? `cl-tab-${active}` : undefined} className="cl-panel">
      <label>Working text
        <textarea value={text} onChange={(event) => setText(event.target.value)} rows={3} spellCheck="false" />
      </label>
      {Tool ? <Tool text={text} setText={setText} puzzle={puzzle} /> : <p className="cl-note">Clear levels to unlock decoder tools.</p>}
    </div>
  </section>;
}
