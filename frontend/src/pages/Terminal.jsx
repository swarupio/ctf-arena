import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listModes } from '../api/terminal.js';
import { describeError } from '../terminal/adapters.js';
import { difficultyLevel } from '../terminal/viewModel.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { useTeam } from '../layout/TeamContext.jsx';
import ProblemPanel from '../terminal/Notices.jsx';
import '../terminal/terminal.css';

// Teaser: the first two lore lines, as shell comments.
const teaser = (lore) => lore.map((line) => line.trim()).filter(Boolean).slice(0, 2);

function ModeCard({ item }) {
  const level = difficultyLevel(item.difficulty);
  const lines = teaser(item.lore);
  const done = item.codes > 0 && item.solved >= item.codes;
  return <article className={`tm-card${done ? ' is-done' : ''}`} aria-labelledby={`tm-card-${item.mode}`}>
    <div className="tm-card-bar">
      <span className="tm-dots" aria-hidden="true"><span /><span /><span /></span>
      <span className="tm-card-path">arena-terminal --mode {item.mode}</span>
      <span className="tm-pips" role="img" aria-label={`Difficulty ${item.difficulty}: ${level} of 3`}>
        {[1, 2, 3].map((pip) => <span key={pip} className={pip <= level ? 'is-on' : undefined} />)}
      </span>
    </div>
    <div className="tm-card-body">
      <p className="tm-card-kicker">{item.mode}{done ? ' · cleared' : ''}</p>
      <h2 id={`tm-card-${item.mode}`}>{item.title}</h2>
      {item.tagline && <p className="tm-card-tagline">{item.tagline}</p>}
      {lines.length > 0 && <div className="tm-card-lore" aria-hidden="true">
        {lines.map((line, index) => <div key={index}># {line}</div>)}
      </div>}
      <div className="tm-card-stats">
        <div>
          <span className="tm-stat-label">codes found</span>
          <strong>{item.solved}/{item.codes}</strong>
          <span className="tm-meter" role="img" aria-label={`${item.solved} of ${item.codes} codes found`}>
            {Array.from({ length: Math.min(item.codes, 12) }, (_, index) => <span key={index} className={index < item.solved ? 'is-on' : undefined} />)}
          </span>
        </div>
        <div>
          <span className="tm-stat-label">points</span>
          <strong>{item.pointsEarned}<span className="tm-stat-total">/{item.points}</span></strong>
        </div>
      </div>
      <Link className="button tm-boot" to={`/terminal/${item.mode}`}>
        {item.solved > 0 && !done ? 'resume' : 'boot'} <span aria-hidden="true">{'▸'}</span>
        <span className="tm-sr"> {item.title}</span>
      </Link>
    </div>
  </article>;
}

export default function Terminal() {
  const { user } = useAuth();
  const { team } = useTeam() ?? {};
  // The API lists the modes for a player without a team, but running anything needs a team: say so up front.
  const noTeam = user?.role !== 'admin' && team === null;
  const [state, setState] = useState({ modes: null, problem: null });

  const load = useCallback(async () => {
    setState({ modes: null, problem: null });
    try {
      setState({ modes: await listModes(), problem: null });
    } catch (error) {
      setState({ modes: null, problem: describeError(error) });
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const { modes, problem } = state;
  return <section className="tm-page">
    <h1>Arena Terminal</h1>
    <p className="tm-lead">
      A pretend Unix machine that lives in your browser tab. Type real commands, dig through its files and find the hidden
      codes. Every code you submit scores for your team on the leaderboard.
    </p>
    {user?.role === 'admin' && <p className="tm-note">Admin preview: you can open every mode and run commands, but only players can submit codes.</p>}

    {noTeam && !problem && <ProblemPanel problem={describeError({ code: 'NO_TEAM' })} />}
    {problem && <ProblemPanel problem={problem} onRetry={load} />}
    {!problem && !modes && <p role="status">Loading terminal modes…</p>}
    {modes && modes.length === 0 && <section className="tm-empty">
      <h2>No terminals online</h2>
      <p>The game has no modes yet. Ask an admin to run the terminal seed, then refresh this page.</p>
      <Link className="button secondary" to="/challenges">Back to challenges</Link>
    </section>}
    {modes && modes.length > 0 && <div className="tm-cards">
      {modes.map((item) => <ModeCard key={item.mode} item={item} />)}
    </div>}
  </section>;
}
