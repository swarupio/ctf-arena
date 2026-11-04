import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { LIMITS, STEPS, TOTAL, stateAt } from '../demo/demoScript.js';
import ArchitectureDiagram from '../demo/ArchitectureDiagram.jsx';
import EventLog from '../demo/EventLog.jsx';
import HopTrail from '../demo/HopTrail.jsx';
import InstancePanel from '../demo/InstancePanel.jsx';
import Scoreboard from '../demo/Scoreboard.jsx';
import ScreenMock from '../demo/ScreenMock.jsx';
import StepTerminal from '../demo/StepTerminal.jsx';
import {
  SPEEDS, advance, clampHop, clampIndex, formatClock, hasHops, hopCounter, hopsOf, isAtEnd, isFinished,
  keyAction, nextIndex, phaseRanges, playbackDelay, prevIndex, progressPercent, retreat, servedByAt,
  stepCounter,
} from './demoPlayer.js';
import './Demo.css';

const PHASES = phaseRanges(STEPS);
const START = Object.freeze({ index: -1, hop: 0 });
// False for an empty script: there is nothing to play, so "Play demo" must not start the autoplay timer.
const CAN_PLAY = advance({ index: 0, hop: 0 }, STEPS) !== null;
const NO_EDGES = Object.freeze([]);

const WATCH_FOR = [
  ['The architecture diagram', 'shows one request hop at a time. Each hop lights one link, says what is sent and which replica answers; the "served by" replica changes from one request to the next because Nginx spreads traffic across stateless backend replicas.'],
  ['The numbered hops and the terminal', 'every step is a short chain of hops (1, 2, 3 ...). The strip under the headline tracks the hop being played, and the terminal shows the command that sparks the step and what the servers print for it.'],
  ['The browser window, the containers and the scoreboard', 'show what a player sees and the private, locked-down instances that start and expire for each team. The ranking changes only when the server accepts a flag.'],
  ['The controls', 'use the buttons or the step ticks. Keyboard: Left and Right arrows move by step, comma and full stop move by hop, Space plays or pauses, R restarts.'],
];

const PROVED = [
  ['Stateless replicas behind Nginx.', 'backend2 crashed mid-game and play carried on, because every decision comes from MongoDB, not from replica memory.'],
  ['Per-team dynamic flags.', 'Alpha and Beta got different flags for the same challenge, so the flag Beta copied from Alpha was rejected.'],
  ['Isolated, hardened containers.', 'The containers of each team were capped on memory, CPU and processes, ran without capabilities and were always cleaned up.'],
  ['Rate limiting shared through MongoDB.', 'Guesses are limited to 5 per minute per challenge across all replicas, so brute-forcing is blocked.'],
  ['MFA login.', 'Every sign-in needed a password plus a one-time code from an authenticator app.'],
];

function prefersReducedMotion() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export default function Demo() {
  // One state object for the position, so a step and its hop always change together.
  const [pos, setPos] = useState(START);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [logOpen, setLogOpen] = useState(false);
  const playButton = useRef(null);
  const wasStarted = useRef(false);
  const { index, hop } = pos;

  const state = useMemo(() => stateAt(index), [index]);
  const step = index >= 0 ? STEPS[index] ?? null : null;
  const hops = useMemo(() => (step ? hopsOf(step) : []), [step]);
  const hopIndex = clampHop(hop, hops.length);
  const currentHop = hops[hopIndex] ?? null;
  const started = index >= 0;
  const onLastStep = isFinished(index, TOTAL);
  const canHopBack = retreat(pos, STEPS) !== null;
  const canHopForward = started && advance(pos, STEPS) !== null;
  // Autoplay stays "running" through the last hop (it animates and gets its dwell); the timer then stops it.
  const running = playing;
  const showProof = onLastStep && !running;
  const winner = showProof ? state.teams?.[0] : null;

  // "Play demo" and "Replay": from the top. Reduced motion users get step 1 paused and press Play themselves.
  const begin = useCallback(() => {
    setPos({ index: 0, hop: 0 });
    setPlaying(!prefersReducedMotion() && CAN_PLAY);
  }, []);
  const replay = useCallback(() => {
    begin();
    playButton.current?.focus({ preventScroll: true });
  }, [begin]);
  const restart = useCallback(() => {
    setPos({ index: 0, hop: 0 });
    setPlaying(false);
  }, []);
  // Step controls (Back, Next, ticks, arrow keys): always land on hop 1 of the step, and pause.
  const goTo = useCallback((target) => {
    setPos({ index: clampIndex(target, TOTAL), hop: 0 });
    setPlaying(false);
  }, []);
  const stepForward = useCallback(() => {
    setPos((current) => (current.index >= TOTAL - 1 ? current : { index: nextIndex(current.index, TOTAL), hop: 0 }));
    setPlaying(false);
  }, []);
  const stepBack = useCallback(() => {
    setPos((current) => (current.index > 0 ? { index: prevIndex(current.index), hop: 0 } : current));
    setPlaying(false);
  }, []);
  // Hop controls: cross step boundaries, and pause.
  const hopForward = useCallback(() => {
    setPos((current) => advance(current, STEPS) ?? current);
    setPlaying(false);
  }, []);
  const hopBack = useCallback(() => {
    setPos((current) => retreat(current, STEPS) ?? current);
    setPlaying(false);
  }, []);
  const selectHop = useCallback((target) => {
    setPos((current) => {
      if (current.index < 0) return current;
      const next = clampHop(target, hopsOf(STEPS[current.index]).length);
      return next === current.hop ? current : { index: current.index, hop: next };
    });
    setPlaying(false);
  }, []);
  const togglePlay = useCallback(() => {
    if (index < 0) begin();
    else if (isAtEnd({ index, hop }, STEPS)) {
      setPos({ index: 0, hop: 0 });
      setPlaying(true);
    } else setPlaying((current) => !current);
  }, [index, hop, begin]);

  // Autoplay: one timer for the hop on screen. Changing hop, step, speed or pausing clears it, so none can leak.
  // After the last hop of a step it moves on to hop 1 of the next step; after the very last hop it stops.
  useEffect(() => {
    if (!playing) return undefined;
    const timer = setTimeout(() => {
      const next = advance({ index, hop }, STEPS);
      if (next) setPos(next);
      else setPlaying(false);
    }, playbackDelay(STEPS, { index, hop }, speed));
    return () => clearTimeout(timer);
  }, [playing, index, hop, speed]);

  useEffect(() => {
    const onKeyDown = (event) => {
      const action = keyAction(event);
      if (!action) return;
      if (action === 'restart') {
        if (index < 0) return;
        restart();
      } else if (action === 'next') stepForward();
      else if (action === 'prev') stepBack();
      else if (action === 'nextHop') hopForward();
      else if (action === 'prevHop') hopBack();
      else togglePlay();
      event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [index, restart, stepForward, stepBack, hopForward, hopBack, togglePlay]);

  // The "Play demo" button disappears when the control bar appears, so hand focus to Play/Pause.
  useEffect(() => {
    if (started && !wasStarted.current) playButton.current?.focus({ preventScroll: true });
    wasStarted.current = started;
  }, [started]);

  const percent = progressPercent(index, TOTAL);
  const minute = state.minute ?? step?.minute ?? 0;

  // One hop on the diagram at a time. A step without hop data (only the synthesized hop) keeps the old
  // behaviour: no hop prop and the whole flow of the step lit at once.
  const hasOwnHops = hasHops(step);
  const diagramHop = hasOwnHops && currentHop
    ? { n: hopIndex + 1, total: hops.length, edge: currentHop.edge, title: currentHop.title, text: currentHop.text }
    : undefined;
  const activeEdges = hasOwnHops ? (currentHop?.edge ? [currentHop.edge] : NO_EDGES) : state.activeEdges;

  return <div className="demo-page">
    <section className={`demo-hero${started ? ' is-compact' : ''}`} aria-labelledby="demo-title">
      <h1 id="demo-title">Demo playoff</h1>
      <p className="demo-lead">A scripted match between two teams, Demo Alpha and Demo Beta. Nothing here talks to the server: it replays exactly what the real platform does during one game.</p>
      {!started && <button type="button" className="demo-start" onClick={begin}>
        <span aria-hidden="true" className="demo-glyph">▶</span>Play demo
      </button>}
    </section>

    {started && <section className="demo-controls" aria-label="Demo controls">
      <div className="demo-bar">
        <div className="demo-transport">
          <button type="button" className="secondary small" onClick={restart}><span aria-hidden="true" className="demo-glyph">↺</span>Restart</button>
          <button type="button" className="secondary small" onClick={stepBack} disabled={index <= 0} title="Previous step (Left arrow)"><span aria-hidden="true" className="demo-glyph">«</span>Back</button>
          <button type="button" ref={playButton} className="demo-play small" aria-pressed={running} onClick={togglePlay}>
            <span aria-hidden="true" className="demo-glyph">{running ? '❚❚' : '▶'}</span>{running ? 'Pause' : 'Play'}
          </button>
          <button type="button" className="secondary small" onClick={stepForward} disabled={onLastStep} title="Next step (Right arrow)">Next<span aria-hidden="true" className="demo-glyph">»</span></button>
        </div>
        <div className="demo-hopnav" role="group" aria-label="Move by hop">
          <button type="button" className="secondary small" onClick={hopBack} disabled={!canHopBack} aria-label="Previous hop" title="Previous hop (comma)">‹ hop</button>
          <button type="button" className="secondary small" onClick={hopForward} disabled={!canHopForward} aria-label="Next hop" title="Next hop (full stop)">hop ›</button>
        </div>
        <div className="demo-speed" role="group" aria-label="Playback speed">
          {SPEEDS.map((value) => <button key={value} type="button" className="secondary small" aria-pressed={speed === value} aria-label={`Speed ${value}×`} onClick={() => setSpeed(value)}>{value}×</button>)}
        </div>
        <div className="demo-readout">
          <span className="demo-counter">{stepCounter(index, TOTAL)}</span>
          <span className="demo-counter demo-hopcount">{hopCounter(hopIndex, hops.length)}</span>
          <span className="demo-clock"><span className="demo-sr">Game clock </span>{formatClock(minute)}</span>
        </div>
      </div>
      <div className="demo-progress">
        <div className="demo-meter" role="progressbar" aria-label="Demo progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)}>
          <span style={{ width: `${percent}%` }} />
        </div>
      </div>
    </section>}

    <section className="demo-narration" aria-labelledby="demo-step-title">
      <div className="demo-chips">
        <span className="demo-chip demo-chip-phase">{step ? step.phase : 'Intro'}</span>
        {step && <span className="demo-chip demo-chip-actor">{step.actor}</span>}
      </div>
      <h2 id="demo-step-title">{step ? step.title : 'Before you press play'}</h2>
      <p className="demo-text" aria-live="polite">{step ? step.narration : 'This is a replay of one complete game between two teams. Every click, request and score is scripted, so it plays out the same way each time and needs no server.'}</p>
      {!step && <ul className="demo-watch" aria-label="What to watch for">
        {WATCH_FOR.map(([name, text]) => <li key={name}><span><strong>{name}</strong> {text}</span></li>)}
      </ul>}
      {step && <HopTrail hops={hops} current={hopIndex} onSelect={selectHop} />}
    </section>

    <div className="demo-stage">
      <div className="demo-col">
        <ArchitectureDiagram hop={diagramHop} activeEdges={activeEdges} servedBy={servedByAt(step, hops, hopIndex)} running={running} />
      </div>
      <div className="demo-col">
        <StepTerminal step={step} hop={hopIndex} running={running} />
      </div>
    </div>

    {started && <section className="demo-jump" aria-label="Step navigator">
      <ol className="demo-phases" aria-label="Jump to a step">
          {PHASES.map((range) => <li key={range.start} className={`demo-phase${index >= range.start && index <= range.end ? ' is-current' : ''}`} style={{ flex: `${range.end - range.start + 1} 1 auto` }}>
            <span className="demo-phase-label" title={range.phase}>{range.phase}</span>
            <div className="demo-ticks">
              {STEPS.slice(range.start, range.end + 1).map((item, offset) => {
                const at = range.start + offset;
                return <button key={item.id ?? at} type="button"
                  className={`demo-tick${at < index ? ' is-done' : ''}${at === index ? ' is-current' : ''}`}
                  aria-label={`Go to step ${at + 1}: ${item.title}`} aria-current={at === index ? 'step' : undefined}
                  title={`${at + 1}. ${item.title}`} onClick={() => goTo(at)}>
                  <span aria-hidden="true" className="demo-tick-n">{at + 1}</span>
                </button>;
              })}
            </div>
          </li>)}
      </ol>
    </section>}

    <div className="demo-grid">
      <div className="demo-col">
        <ScreenMock screen={step?.screen} actor={step?.actor} minute={minute} />
        <InstancePanel instances={state.instances} limits={LIMITS} />
      </div>
      <div className="demo-col">
        <Scoreboard teams={state.teams} />
      </div>
    </div>

    {showProof && <section className="demo-proof" aria-labelledby="demo-proof-title">
      <h2 id="demo-proof-title">Proof checklist</h2>
      {winner && <p className="demo-final">Final result: {winner.name} finished first with {winner.score} points.</p>}
      <ul>
        {PROVED.map(([name, text]) => <li key={name}><span><strong>{name}</strong> {text}</span></li>)}
      </ul>
      <div className="demo-actions">
        <button type="button" className="secondary" onClick={replay}>Replay</button>
        <Link className="button" to="/login">Try it for real</Link>
      </div>
    </section>}

    <details className="demo-fulllog" onToggle={(event) => setLogOpen(event.currentTarget.open)}>
      <summary>Full server log (all steps so far)</summary>
      {logOpen && <EventLog lines={state.lines} activeStep={index} />}
    </details>
  </div>;
}
