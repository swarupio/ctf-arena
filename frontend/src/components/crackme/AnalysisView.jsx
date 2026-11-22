import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Listing from './Listing.jsx';
import {
  addr3, analyzeProgram, codeStrings, current, describeSuccessors, emptyHistory, goBack, goForward, immediates, layoutGraph,
  memoryStrings, nextTabIndex, parseAddress, searchProgram, storedStrings, visit,
} from './analysis.js';
import { charComment, hex } from './helpers.js';
import { currentProgram } from './vm.js';
import { useMediaQuery } from '../../terminal/hooks.js';
import './analysis.css';

// One kit per debugger: the analysis of the program as the viewed machine holds it (so decrypted or patched code is read
// as it now stands) and the navigation history shared by the listing tools, the graph and the data panel.
export function useAnalysisKit(machine, resetKey) {
  const signature = JSON.stringify([machine.ops, machine.args]);
  const program = useMemo(() => {
    const [ops, args] = JSON.parse(signature);
    return currentProgram({ ops, args });
  }, [signature]);
  const analysis = useMemo(() => analyzeProgram(program), [program]);
  const [nav, setNav] = useState({ history: emptyHistory(), focus: null });
  const pcRef = useRef(machine.pc);
  pcRef.current = machine.pc;
  useEffect(() => { setNav({ history: emptyHistory(), focus: null }); }, [resetKey]);

  const move = useCallback((change) => setNav((previous) => {
    const history = change(previous.history);
    const at = current(history);
    return { history, focus: at === null ? previous.focus : { address: at, nonce: (previous.focus?.nonce ?? 0) + 1 } };
  }), []);
  const goto = useCallback((address) => move((history) => {
    // The first move remembers where you were, so Back has somewhere to return to.
    const seeded = history.stack.length === 0 && pcRef.current >= 0 ? visit(history, pcRef.current) : history;
    return visit(seeded, address);
  }), [move]);
  return {
    program,
    analysis,
    focus: nav.focus,
    goto,
    back: () => move(goBack),
    forward: () => move(goForward),
    canBack: nav.history.index > 0,
    canForward: nav.history.index < nav.history.stack.length - 1,
  };
}

function ListingTools({ kit, machine }) {
  const { analysis, program } = kit;
  const [addressText, setAddressText] = useState('');
  const [addressError, setAddressError] = useState('');
  const [query, setQuery] = useState('');
  const [position, setPosition] = useState(-1);
  const hits = useMemo(() => searchProgram(program, analysis, query), [program, analysis, query]);
  const pcInside = machine.pc >= 0 && machine.pc < analysis.count;

  const submitAddress = (event) => {
    event.preventDefault();
    const target = parseAddress(addressText, analysis);
    if (target === null) {
      setAddressError(`Enter an address from 0 to ${analysis.count - 1} (decimal or 0x hex), or a label such as ${analysis.blocks[1]?.label ?? 'entry'}.`);
      return;
    }
    setAddressError('');
    kit.goto(target);
  };
  const jumpToMatch = (next) => {
    if (hits.length === 0) { return; }
    const wrapped = ((next % hits.length) + hits.length) % hits.length;
    setPosition(wrapped);
    kit.goto(hits[wrapped]);
  };
  const onQuery = (event) => {
    const value = event.target.value;
    setQuery(value);
    const found = searchProgram(program, analysis, value);
    if (found.length) { setPosition(0); kit.goto(found[0]); } else { setPosition(-1); }
  };
  const status = !query.trim() ? '' : hits.length === 0 ? 'No matches' : `Match ${position >= 0 ? position + 1 : 0} of ${hits.length}`;

  return <div className="cm-an-tools">
    <div className="cm-an-row" role="group" aria-label="Move around the listing">
      <button type="button" className="secondary" onClick={kit.back} disabled={!kit.canBack} aria-label="Back to the previous place in the listing">Back</button>
      <button type="button" className="secondary" onClick={kit.forward} disabled={!kit.canForward} aria-label="Forward to the next place in the listing">Forward</button>
      <button type="button" className="secondary" onClick={() => kit.goto(machine.pc)} disabled={!pcInside}>Jump to current PC</button>
    </div>
    <form className="cm-an-row" onSubmit={submitAddress}>
      <label>
        Go to address
        <input
          value={addressText}
          onChange={(event) => setAddressText(event.target.value)}
          placeholder="35, 0x23 or a label"
          autoComplete="off"
          spellCheck="false"
          aria-invalid={addressError ? 'true' : undefined}
          aria-describedby={addressError ? 'cm-an-goto-error' : undefined}
        />
      </label>
      <button type="submit" className="secondary">Go</button>
    </form>
    {addressError && <p id="cm-an-goto-error" role="alert" className="error cm-an-error">{addressError}</p>}
    <div className="cm-an-row">
      <label>
        Find instruction
        <input
          type="search"
          value={query}
          onChange={onQuery}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); jumpToMatch(position + (event.shiftKey ? -1 : 1)); } }}
          placeholder="XOR, 65, 0x41, 'A' or loc_"
          autoComplete="off"
          spellCheck="false"
          aria-describedby="cm-an-find-help"
        />
      </label>
      <button type="button" className="secondary" onClick={() => jumpToMatch(position - 1)} disabled={hits.length === 0} aria-label="Prev: go to the previous match">Prev</button>
      <button type="button" className="secondary" onClick={() => jumpToMatch(position + 1)} disabled={hits.length === 0} aria-label="Next match">Next</button>
    </div>
    <p id="cm-an-find-help" className="cm-note" role="status">
      {status || 'Matches a mnemonic, an operand value (decimal, hex or a character) or a label. Enter goes to the next match.'}
    </p>
  </div>;
}

function xrefLine(kit, address) {
  const { analysis } = kit;
  const label = analysis.labelOf(address);
  if (!label) { return null; }
  const refs = analysis.xrefs.get(address) ?? [];
  return <div className="cm-xref">
    <span className="cm-xlabel">{label}:</span>
    {refs.length > 0 && <span className="cm-xrefs">
      <span className="cm-dim"> xrefs from</span>
      {refs.map((ref) => <button
        key={ref.from}
        type="button"
        className="cm-xlink"
        onClick={() => kit.goto(ref.from)}
        aria-label={`Go to address ${addr3(ref.from)}, a ${ref.op} that ${ref.op === 'JMP' ? 'jumps' : 'can branch'} here${ref.back ? ' (loops back)' : ''}`}
      >{addr3(ref.from)}{ref.back ? ' ↺' : ''}</button>)}
    </span>}
  </div>;
}

function targetLine(kit, row) {
  const { analysis, program } = kit;
  const [op, arg] = program[row.address];
  if (op !== 'JMP' && op !== 'JZ' && op !== 'JNZ') { return null; }
  if (!(Number.isInteger(arg) && arg >= 0 && arg < analysis.count)) {
    return <div className="cm-xtarget"><span className="cm-xnote">{'→'} {arg}: outside the listing (a bad jump faults; code may still be rewriting it)</span></div>;
  }
  return <div className="cm-xtarget">
    <button type="button" className="cm-xlink" onClick={() => kit.goto(arg)} aria-label={`Go to the target of this ${op}: address ${addr3(arg)}, ${analysis.labelOf(arg)}`}>
      {'→'} {analysis.labelOf(arg)} ({addr3(arg)})
    </button>
  </div>;
}

// The listing with its navigation tools. `listing` carries the usual Listing props.
export function KitListing({ kit, machine, listing }) {
  return <div className="cm-an-left">
    <ListingTools kit={kit} machine={machine} />
    <Listing
      {...listing}
      focus={kit.focus}
      before={(row) => xrefLine(kit, row.address)}
      after={(row) => targetLine(kit, row)}
    />
  </div>;
}

// ---- control-flow overview ---------------------------------------------------------------------------------------------
function FlowGraph({ kit, machine }) {
  const { analysis } = kit;
  const layout = useMemo(() => layoutGraph(analysis), [analysis]);
  const box = useRef(null);
  const here = machine.status === 'fault' && machine.reason === 'PC_RANGE' ? null : analysis.blockAt(machine.pc);
  const hereId = here ? here.id : -1;

  // Keep the executing block in view inside the graph box (never scrolls the page).
  useEffect(() => {
    const container = box.current;
    const node = layout.nodes[hereId];
    if (!container || !node) { return; }
    const { boxW, boxH } = layout;
    const fitsY = node.y >= container.scrollTop && node.y + boxH <= container.scrollTop + container.clientHeight;
    const fitsX = node.x >= container.scrollLeft && node.x + boxW <= container.scrollLeft + container.clientWidth;
    if (!fitsY) { container.scrollTop = Math.max(0, node.y - container.clientHeight / 2); }
    if (!fitsX) { container.scrollLeft = Math.max(0, node.x - container.clientWidth / 2); }
  }, [hereId, layout]);

  const onKey = (event, block) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); kit.goto(block.start); }
  };
  return <div className="cm-an-graph-wrap">
    <p className="cm-note" role="status">
      {here ? `Executing block: ${here.label} (${addr3(here.start)} to ${addr3(here.end)}).` : 'No block is executing (the machine stopped outside the listing).'}
    </p>
    <div className="cm-an-graph" ref={box} tabIndex={-1}>
      <svg
        width={layout.width}
        height={layout.height}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        role="group"
        aria-label="Control-flow graph. Each box is a run of instructions with no jump into its middle. Activate a box to show it in the listing. A text list of the same blocks follows."
      >
        <defs>
          <marker id="cm-an-head" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0,0 L8,4 L0,8 z" className="cm-an-headfill" />
          </marker>
        </defs>
        {layout.paths.map((path, index) => <path
          key={index}
          d={path.d}
          className={`cm-an-edge is-${path.kind}${path.from === hereId ? ' is-hot' : ''}`}
          markerEnd="url(#cm-an-head)"
          fill="none"
        />)}
        {analysis.blocks.map((block) => {
          const node = layout.nodes[block.id];
          const isHere = block.id === hereId;
          return <g
            key={block.id}
            transform={`translate(${node.x},${node.y})`}
            className={`cm-an-node${isHere ? ' is-current' : ''}${block.exit ? ' is-exit' : ''}${block.reachable ? '' : ' is-unreached'}`}
            role="button"
            tabIndex={0}
            aria-label={`${block.label}, addresses ${addr3(block.start)} to ${addr3(block.end)}. Next: ${describeSuccessors(analysis, block)}.${isHere ? ' Executing now.' : ''}`}
            onClick={() => kit.goto(block.start)}
            onKeyDown={(event) => onKey(event, block)}
          >
            <rect width={layout.boxW} height={layout.boxH} rx="3" />
            <text x="8" y="19" className="cm-an-name">{block.label.length > 15 ? `${block.label.slice(0, 14)}…` : block.label}</text>
            <text x="8" y="35" className="cm-an-range">{addr3(block.start)}{block.end > block.start ? `-${addr3(block.end)}` : ''}</text>
          </g>;
        })}
      </svg>
    </div>
    <p className="cm-note">
      Solid arrows fall through to the next block; dashed arrows are jumps and taken branches. Arrows along the right edge run to a
      block further away or back up (a loop). A dotted outline marks code that no jump in the listing reaches.
    </p>
    <details className="cm-an-outline">
      <summary>Blocks as a list ({analysis.blocks.length})</summary>
      <ul>
        {analysis.blocks.map((block) => <li key={block.id}>
          <button type="button" className="cm-xlink" onClick={() => kit.goto(block.start)}>{block.label}</button>
          <span> {addr3(block.start)} to {addr3(block.end)}{block.id === hereId ? ' (executing now)' : ''}. Next: {describeSuccessors(analysis, block)}.</span>
        </li>)}
      </ul>
    </details>
  </div>;
}

// ---- constants and strings ---------------------------------------------------------------------------------------------
const SHOWN_USES = 8;

function AddressButtons({ kit, addresses }) {
  return <span className="cm-an-uses">
    {addresses.slice(0, SHOWN_USES).map((at) => <button key={at} type="button" className="cm-xlink" onClick={() => kit.goto(at)} aria-label={`Go to address ${addr3(at)}`}>{addr3(at)}</button>)}
    {addresses.length > SHOWN_USES && <span className="cm-dim"> +{addresses.length - SHOWN_USES} more (use Find)</span>}
  </span>;
}

function DataPanel({ kit, machine }) {
  const { program } = kit;
  const constants = useMemo(() => immediates(program), [program]);
  const inCode = useMemo(() => codeStrings(program), [program]);
  const stored = useMemo(() => storedStrings(program), [program]);
  const live = memoryStrings(machine.mem);
  const none = <p className="cm-note">None found.</p>;
  return <div className="cm-an-data">
    <section aria-labelledby="cm-an-const">
      <h4 id="cm-an-const">Constants <span className="cm-dim">({constants.length})</span></h4>
      {constants.length === 0 ? none : <div className="cm-an-scroll" tabIndex={0} role="region" aria-label="Constants pushed by the program">
        <table className="cm-an-table">
          <thead><tr><th scope="col">Value</th><th scope="col">Hex</th><th scope="col">Char</th><th scope="col">Pushed at</th></tr></thead>
          <tbody>
            {constants.map((item) => <tr key={item.value}>
              <td>{item.value}</td>
              <td>0x{hex(item.value, 2)}</td>
              <td>{charComment(item.value) || '-'}</td>
              <td><AddressButtons kit={kit} addresses={item.addresses} /></td>
            </tr>)}
          </tbody>
        </table>
      </div>}
    </section>
    <section aria-labelledby="cm-an-strings">
      <h4 id="cm-an-strings">Strings <span className="cm-dim">(3 or more printable characters in a row)</span></h4>
      <ul className="cm-an-strings">
        {inCode.map((item) => <li key={`c${item.address}`}>
          <code>{item.text}</code>
          <span className="cm-dim"> pushed by {item.length} instructions from </span>
          <AddressButtons kit={kit} addresses={[item.address]} />
        </li>)}
        {stored.map((item) => <li key={`s${item.cell}`}>
          <code>{item.text}</code>
          <span className="cm-dim"> stored in cells {item.cell} to {item.cell + item.length - 1} by literal stores from </span>
          <AddressButtons kit={kit} addresses={[item.at]} />
        </li>)}
        {live.map((item) => <li key={`m${item.cell}`}>
          <code>{item.text}</code>
          <span className="cm-dim"> in memory cells {item.cell} to {item.cell + item.length - 1} at this step</span>
        </li>)}
      </ul>
      {inCode.length + stored.length + live.length === 0 && none}
      <p className="cm-note">
        Only text that sits in the listing or in memory is shown. Characters the program compares against one at a time are not
        joined up for you: read those from the listing.
      </p>
    </section>
  </div>;
}

// The graph and the data panel, side by side on wide screens and as two tabs under 900 px.
export function KitPanels({ kit, machine }) {
  const [tab, setTab] = useState('graph');
  // The tab bar only exists below 900 px (see analysis.css); wider, both panels are plain, always visible sections.
  const narrow = useMediaQuery('(max-width: 899px)');
  const tabs = [['graph', 'Flow graph'], ['data', 'Data']];
  const move = (event, index) => {
    const next = nextTabIndex(event.key, index, tabs.length);
    if (next === null) { return; }
    event.preventDefault();
    setTab(tabs[next][0]);
    document.getElementById(`cm-an-tab-${tabs[next][0]}`)?.focus();
  };
  const panelProps = (id) => (narrow ? { role: 'tabpanel', 'aria-labelledby': `cm-an-tab-${id}` } : {});
  return <section className="cm-an" aria-labelledby="cm-an-title">
    <h3 id="cm-an-title" className="cm-sr">Program analysis</h3>
    {narrow && <div className="cm-an-tabs" role="tablist" aria-label="Analysis views">
      {tabs.map(([id, text], index) => <button
        key={id}
        type="button"
        role="tab"
        id={`cm-an-tab-${id}`}
        aria-selected={tab === id}
        aria-controls={`cm-an-panel-${id}`}
        tabIndex={tab === id ? 0 : -1}
        className={tab === id ? 'is-active' : 'secondary'}
        onClick={() => setTab(id)}
        onKeyDown={(event) => move(event, index)}
      >{text}</button>)}
    </div>}
    <div className="cm-an-panels">
      <section className={`cm-panel cm-an-panel${tab === 'graph' ? ' is-active' : ''}`} id="cm-an-panel-graph" {...panelProps('graph')}>
        <h3>Flow graph</h3>
        <FlowGraph kit={kit} machine={machine} />
      </section>
      <section className={`cm-panel cm-an-panel${tab === 'data' ? ' is-active' : ''}`} id="cm-an-panel-data" {...panelProps('data')}>
        <h3>Data</h3>
        <DataPanel kit={kit} machine={machine} />
      </section>
    </div>
  </section>;
}
