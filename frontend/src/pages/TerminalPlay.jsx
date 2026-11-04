import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getProgress, listModes } from '../api/terminal.js';
import { describeError } from '../terminal/adapters.js';
import { isMode } from '../terminal/data.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { useTeam } from '../layout/TeamContext.jsx';
import ProblemPanel from '../terminal/Notices.jsx';
import TerminalHud from '../terminal/TerminalHud.jsx';
import TerminalWindow from '../terminal/TerminalWindow.jsx';
import '../terminal/terminal.css';

function PlaySession({ mode }) {
  const { user, signOut } = useAuth();
  const { team, profile } = useTeam() ?? {};
  const isAdmin = user?.role === 'admin';
  const teamName = profile?.team?.name ?? team?.name ?? '';
  const statusLabel = isAdmin ? 'ADMIN (preview)' : teamName ? teamName.toUpperCase() : 'GUEST';

  const [modes, setModes] = useState(null);
  const [problem, setProblem] = useState(null);
  const [progress, setProgress] = useState(null);
  const [progressFailed, setProgressFailed] = useState(false);
  const [startedAt, setStartedAt] = useState(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  // A 401 means the session is gone: sign out through the normal auth flow, which sends the user to the login page.
  // Read through a ref so this callback (and everything that loads data) keeps one identity across renders.
  const signOutRef = useRef(signOut);
  signOutRef.current = signOut;
  const unauthorized = useCallback(() => { void Promise.resolve(signOutRef.current()).catch(() => {}); }, []);

  const loadProgress = useCallback(async () => {
    try {
      const next = await getProgress(mode);
      if (alive.current) { setProgress(next); setProgressFailed(false); }
    } catch (error) {
      if (!alive.current) return;
      setProgressFailed(true);
      if (error?.status === 401) unauthorized();
    }
  }, [mode, unauthorized]);

  const load = useCallback(async () => {
    setProblem(null);
    try {
      const [list] = await Promise.all([listModes(), loadProgress()]);
      if (alive.current) setModes(list);
    } catch (error) {
      if (!alive.current) return;
      const next = describeError(error);
      setProblem(next);
      if (next.kind === 'auth') unauthorized();
    }
  }, [loadProgress, unauthorized]);
  useEffect(() => { void load(); }, [load]);

  const markStarted = useCallback(() => setStartedAt((value) => value ?? Date.now()), []);

  // Players need a team to run anything (flags are per team). The API answers NO_TEAM too, but say it before booting.
  if (!isAdmin && team === null) {
    return <section className="tm-page"><Link className="tm-back" to="/terminal">← All modes</Link><ProblemPanel problem={describeError({ code: 'NO_TEAM' })} /></section>;
  }
  if (problem) return <section className="tm-page"><Link className="tm-back" to="/terminal">← All modes</Link><ProblemPanel problem={problem} onRetry={load} /></section>;
  if (!modes) return <p role="status">Booting terminal…</p>;
  const info = modes.find((item) => item.mode === mode);
  if (!info) {
    return <section className="tm-page">
      <Link className="tm-back" to="/terminal">← All modes</Link>
      <section className="tm-empty"><h2>Mode not available</h2><p>The {mode} terminal is not online right now.</p><Link className="button secondary" to="/terminal">Pick another mode</Link></section>
    </section>;
  }

  return <section className="tm-page tm-page--play">
    <Link className="tm-back" to="/terminal">← All modes</Link>
    <h1>Arena Terminal</h1>
    <div className="tm-play">
      <TerminalWindow
        mode={mode}
        info={info}
        statusLabel={statusLabel}
        isAdmin={isAdmin}
        onFirstCommand={markStarted}
        onSolved={loadProgress}
        onUnauthorized={unauthorized}
      />
      <TerminalHud
        mode={mode}
        info={info}
        modes={modes}
        progress={progress}
        progressFailed={progressFailed}
        onRetry={loadProgress}
        startedAt={startedAt}
        isAdmin={isAdmin}
      />
    </div>
  </section>;
}

export default function TerminalPlay() {
  const { mode } = useParams();
  if (!isMode(mode)) {
    return <section className="tm-page">
      <Link className="tm-back" to="/terminal">← All modes</Link>
      <section className="tm-empty"><h2>Unknown terminal</h2><p>There is no “{mode}” terminal. Pick easy, medium or hard.</p><Link className="button" to="/terminal">Show the modes</Link></section>
    </section>;
  }
  // key: switching mode starts a brand new session (scrollback, cwd, timer)
  return <PlaySession key={mode} mode={mode} />;
}
