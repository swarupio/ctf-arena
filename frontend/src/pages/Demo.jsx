import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { LIMITS, STEPS, TOTAL, stateAt } from '../demo/demoScript.js';
import ArchitectureDiagram from '../demo/ArchitectureDiagram.jsx';
import EventLog from '../demo/EventLog.jsx';
import InstancePanel from '../demo/InstancePanel.jsx';
import Scoreboard from '../demo/Scoreboard.jsx';
import ScreenMock from '../demo/ScreenMock.jsx';
import {
  SPEEDS, autoplayDelay, clampIndex, formatClock, isFinished, keyAction, nextIndex, phaseRanges,
  prevIndex, progressPercent, stepCounter,
} from './demoPlayer.js';
import './Demo.css';

const PHASES = phaseRanges(STEPS);

const WATCH_FOR = [
  ['The architecture diagram', 'lights up the path of each request. The "served by" replica changes from one request to the next because Nginx spreads traffic across stateless backend replicas.'],
  ['The browser window and the containers', 'show what a player sees and the private, locked-down instances that start and expire for each team.'],
  ['The scoreboard and the event log', 'the ranking changes only when the server accepts a flag, and every step is written down in plain text.'],
  ['The controls', 'use the buttons or the step ticks. Keyboard: Left and Right arrows step, Space plays or pauses, R restarts.'],
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
  const [index, setIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const playButton = useRef(null);
  const wasStarted = useRef(false);

  const state = useMemo(() => stateAt(index), [index]);
  const step = index >= 0 ? STEPS[index] ?? null : null;
  const started = index >= 0;
  const finished = isFinished(index, TOTAL);
  const running = playing && !finished;
  const winner = finished ? state.teams?.[0] : null;

  // "Play demo" and "Replay": from the top. Reduced motion users get step 1 paused and press Play themselves.
  const begin = useCallback(() => {
    setIndex(0);
    setPlaying(!prefersReducedMotion() && TOTAL > 1);
  }, []);
  const replay = useCallback(() => {
    begin();
    playButton.current?.focus({ preventScroll: true });
  }, [begin]);
  const restart = useCallback(() => {
    setIndex(0);
    setPlaying(false);
  }, []);
  const goTo = useCallback((target) => {
    setIndex(clampIndex(target, TOTAL));
    setPlaying(false);
  }, []);
  const stepForward = useCallback(() => {
    setIndex((current) => nextIndex(current, TOTAL));
    setPlaying(false);
  }, []);
  const stepBack = useCallback(() => {
    setIndex((current) => (current > 0 ? prevIndex(current) : current));
    setPlaying(false);
  }, []);
  const togglePlay = useCallback(() => {
    if (index < 0) begin();
    else if (finished) {
      setIndex(0);
      setPlaying(true);
    } else setPlaying((current) => !current);
  }, [index, finished, begin]);

  // Autoplay: one timer for the step on screen. Changing step, speed or pausing clears it, so none can leak.
  useEffect(() => {
    if (!playing || isFinished(index, TOTAL)) return undefined;
    const timer = setTimeout(() => {
      const next = nextIndex(index, TOTAL);
      setIndex(next);
      if (isFinished(next, TOTAL)) setPlaying(false);
    }, autoplayDelay(STEPS, index, speed));
    return () => clearTimeout(timer);
  }, [playing, index, speed]);

  useEffect(() => {
    const onKeyDown = (event) => {
      const action = keyAction(event);
      if (!action) return;
      if (action === 'restart') {
        if (index < 0) return;
        restart();
      } else if (action === 'next') stepForward();
      else if (action === 'prev') stepBack();
      else togglePlay();
      event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [index, restart, stepForward, stepBack, togglePlay]);

  // The "Play demo" button disappears when the control bar appears, so hand focus to Play/Pause.
  useEffect(() => {
    if (started && !wasStarted.current) playButton.current?.focus({ preventScroll: true });
    wasStarted.current = started;
  }, [started]);

  const percent = progressPercent(index, TOTAL);
  const minute = state.minute ?? step?.minute ?? 0;

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
          <button type="button" className="secondary small" onClick={stepBack} disabled={index <= 0}><span aria-hidden="true" className="demo-glyph">«</span>Back</button>
          <button type="button" ref={playButton} className="demo-play small" aria-pressed={running} onClick={togglePlay}>
            <span aria-hidden="true" className="demo-glyph">{running ? '❚❚' : '▶'}</span>{running ? 'Pause' : 'Play'}
          </button>
          <button type="button" className="secondary small" onClick={stepForward} disabled={finished}>Next<span aria-hidden="true" className="demo-glyph">»</span></button>
        </div>
        <div className="demo-speed" role="group" aria-label="Playback speed">
          {SPEEDS.map((value) => <button key={value} type="button" className="secondary small" aria-pressed={speed === value} aria-label={`Speed ${value}×`} onClick={() => setSpeed(value)}>{value}×</button>)}
        </div>
        <div className="demo-readout">
          <span className="demo-counter">{stepCounter(index, TOTAL)}</span>
          <span className="demo-clock"><span className="demo-sr">Game clock </span>{formatClock(minute)}</span>
        </div>
      </div>
      <div className="demo-progress">
        <div className="demo-meter" role="progressbar" aria-label="Demo progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)}>
          <span style={{ width: `${percent}%` }} />
        </div>
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
    </section>

    {finished && <section className="demo-proof" aria-labelledby="demo-proof-title">
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

    <div className="demo-grid">
      <div className="demo-col">
        <ScreenMock screen={step?.screen} actor={step?.actor} minute={minute} />
        <InstancePanel instances={state.instances} limits={LIMITS} />
      </div>
      <div className="demo-col">
        <ArchitectureDiagram activeEdges={state.activeEdges} servedBy={state.servedBy} running={running} />
        <Scoreboard teams={state.teams} />
      </div>
    </div>

    <div className="demo-log-wrap">
      <EventLog lines={state.lines} activeStep={index} />
    </div>
  </div>;
}
