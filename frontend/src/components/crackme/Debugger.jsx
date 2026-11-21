import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Listing from './Listing.jsx';
import { MemoryPanel, Registers, StackPanel } from './Panels.jsx';
import { SPEEDS, rowsOfMachine, runBatch, runToStop } from './helpers.js';
import { createMachine, stepMachine } from './vm.js';

// Step-through debugger. It runs the SAME vm.js as the server, locally, so exploring costs no attempts. The machine is a
// mutable object kept in a ref; `tick` forces a re-render after every change.
export default function Debugger({ puzzle, input, onInput }) {
  const [hideDebugger, setHideDebugger] = useState(false);
  const [speed, setSpeed] = useState('fast');
  const [breakpoints, setBreakpoints] = useState(() => new Set());
  const [running, setRunning] = useState(false);
  const [, setTick] = useState(0);
  const machineRef = useRef(null);
  const bump = useCallback(() => setTick((value) => value + 1), []);

  // Opening a hint reloads the puzzle (a new object); the machine must only restart when the program really changes.
  const signature = useMemo(() => JSON.stringify(puzzle.program), [puzzle.program]);
  const maxSteps = puzzle.vm.maxSteps;
  const fresh = useCallback(
    () => createMachine(JSON.parse(signature), input, { debugger: !hideDebugger, maxSteps }),
    [signature, maxSteps, input, hideDebugger],
  );
  if (machineRef.current === null) { machineRef.current = fresh(); }

  // A new program, input or debugger setting always starts from a clean machine.
  useEffect(() => {
    machineRef.current = fresh();
    setRunning(false);
    bump();
  }, [fresh, bump]);

  // Breakpoints belong to one cabinet.
  useEffect(() => { setBreakpoints(new Set()); }, [puzzle.id]);

  useEffect(() => {
    if (!running) { return undefined; }
    const { interval, batch } = SPEEDS.find((item) => item.id === speed) ?? SPEEDS[0];
    const timer = setInterval(() => {
      const machine = machineRef.current;
      const { hit } = runBatch(machine, batch, breakpoints);
      bump();
      if (hit || machine.status !== 'running') { setRunning(false); }
    }, interval);
    return () => clearInterval(timer);
  }, [running, speed, breakpoints, bump]);

  const machine = machineRef.current;
  const stopped = machine.status !== 'running';
  const rows = rowsOfMachine(puzzle.program, machine);

  const toggle = (address) => setBreakpoints((current) => {
    const next = new Set(current);
    if (next.has(address)) { next.delete(address); } else { next.add(address); }
    return next;
  });
  const step = () => { setRunning(false); stepMachine(machine); bump(); };
  const play = () => {
    // Leave a breakpoint we are standing on, then let the timer carry on.
    if (!stopped) { stepMachine(machine); bump(); setRunning(true); }
  };
  const toEnd = () => { setRunning(false); runToStop(machine, breakpoints); bump(); };
  const reset = () => { setRunning(false); machineRef.current = fresh(); bump(); };

  return <section className="cm-debugger" aria-labelledby="cm-debug-title">
    <h2 id="cm-debug-title">Debugger</h2>
    <div className="cm-toolbar">
      <label className="cm-input">
        Input to test
        <input
          value={input}
          onChange={(event) => onInput(event.target.value)}
          maxLength={puzzle.inputMax}
          autoComplete="off"
          spellCheck="false"
          autoCapitalize="off"
          aria-describedby="cm-input-help"
        />
      </label>
      <div className="cm-buttons" role="group" aria-label="Debugger controls">
        <button type="button" className="secondary" onClick={step} disabled={stopped}>Step</button>
        {running
          ? <button type="button" onClick={() => setRunning(false)}>Pause</button>
          : <button type="button" onClick={play} disabled={stopped}>Run</button>}
        <button type="button" className="secondary" onClick={toEnd} disabled={stopped}>Run to end</button>
        <button type="button" className="secondary" onClick={reset}>Reset</button>
      </div>
      <label className="cm-speed">
        Speed
        <select value={speed} onChange={(event) => setSpeed(event.target.value)}>
          {SPEEDS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </label>
      <label className="cm-check">
        <input type="checkbox" checked={hideDebugger} onChange={(event) => setHideDebugger(event.target.checked)} />
        Hide debugger (DBG pushes 0)
      </label>
    </div>
    <p id="cm-input-help" className="cm-note">
      Click an instruction to set a breakpoint. Changing the input or the debugger setting resets the machine. The real
      cabinet runs with no debugger attached, and only the server's own run counts.
    </p>
    <div className="cm-grid">
      <Listing rows={rows} pc={machine.pc} stopped={stopped} breakpoints={breakpoints} onToggle={toggle} />
      <div className="cm-side">
        <Registers machine={machine} />
        <StackPanel machine={machine} />
        <MemoryPanel machine={machine} />
      </div>
    </div>
  </section>;
}
