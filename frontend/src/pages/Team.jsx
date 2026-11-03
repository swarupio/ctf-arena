import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../api/client.js';
import { useTeam } from '../layout/TeamContext.jsx';
import { normalizeInviteCode, validInviteCode, validTeamName, teamErrorMessage } from './teamHelpers.js';
import './Team.css';

export default function Team() {
  const { team, loading, error: loadError, refresh } = useTeam();
  const [name, setName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [copied, setCopied] = useState(false);
  const requestLock = useRef(false);
  const disabled = pending || loading;
  // Scores change when teammates solve challenges, so re-read the team when the page opens.
  // Only needed for members; skipping it for team-less users keeps the create/join forms usable at once.
  useEffect(() => { if (team) void refresh().catch(() => {}); }, []);

  async function reload() {
    setError('');
    setNotice('');
    setCopied(false);
    try { await refresh({ refreshProfile: true }); }
    catch { /* The context exposes the load error and retry control. */ }
  }

  async function changeTeam(action, event) {
    event?.preventDefault();
    if (requestLock.current || loading) return;
    if (action === 'create' && !validTeamName(name)) {
      setError('Enter a team name with 3–24 characters after trimming spaces.');
      return;
    }
    if (action === 'join' && !validInviteCode(inviteCode)) {
      setError('Enter a six-character invite code. Codes use letters and digits, excluding I, O, 0 and 1.');
      return;
    }
    requestLock.current = true;
    setPending(true);
    setError('');
    setNotice('');
    setCopied(false);
    const paths = { create: '/teams', join: '/teams/join', leave: '/teams/me/leave' };
    try {
      await apiRequest(paths[action], {
        method: 'POST',
        ...(action === 'leave' ? {} : {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(action === 'create' ? { name: name.trim() } : { inviteCode: normalizeInviteCode(inviteCode) }),
        }),
      });
      setConfirmLeave(false);
      setName('');
      setInviteCode('');
      setNotice({ create: 'Your team was created.', join: 'You joined the team.', leave: 'You left the team.' }[action]);
      try { await refresh({ refreshProfile: true }); }
      catch { setNotice('Your change was saved, but the team details could not be refreshed. Refresh your team before making another change.'); }
    } catch (error) {
      setError(teamErrorMessage(error, action));
      if (error.code === 'CONFLICT' || error.code === 'NO_TEAM') {
        try { await refresh({ refreshProfile: true }); }
        catch { /* Keep the action error as well as the context refresh error. */ }
      }
    } finally {
      requestLock.current = false;
      setPending(false);
    }
  }

  async function copyInvite() {
    if (requestLock.current || disabled) return;
    requestLock.current = true;
    setPending(true);
    setError('');
    setCopied(false);
    try {
      await navigator.clipboard.writeText(team.inviteCode);
      setCopied(true);
    } catch { setError('Unable to copy automatically. Select the invite code and copy it manually.'); }
    finally { requestLock.current = false; setPending(false); }
  }

  return <section className="team-page" aria-busy={disabled}>
    <div className="team-heading"><h1>Team</h1><button type="button" className="secondary" disabled={disabled} onClick={reload}>Refresh team</button></div>
    {loading && <p role="status">Loading your team…</p>}
    {notice && <p role="status" className="notice">{notice}</p>}
    {error && <p role="alert" className="error">{error}</p>}
    {loadError && <p role="alert" className="error">Could not refresh your team. {teamErrorMessage(loadError)}</p>}
    {team === undefined ? !loading && <p>Use Refresh team to try again.</p> : team === null ? <>
      <p>Create a team or join friends with their invite code. Teams can have up to 3 members.</p>
      <div className="team-forms">
        <form className="team-panel" onSubmit={(event) => changeTeam('create', event)}>
          <h2>Create a team</h2>
          <fieldset disabled={disabled || Boolean(loadError)}>
            <label htmlFor="team-name">Team name</label>
            <input id="team-name" value={name} onChange={(event) => setName(event.target.value)} required aria-describedby="team-name-hint" />
            <p id="team-name-hint">3–24 characters, excluding spaces at the start and end.</p>
            <button type="submit">{pending ? 'Please wait…' : 'Create team'}</button>
          </fieldset>
        </form>
        <form className="team-panel" onSubmit={(event) => changeTeam('join', event)}>
          <h2>Join a team</h2>
          <fieldset disabled={disabled || Boolean(loadError)}>
            <label htmlFor="team-invite">Invite code</label>
            <input id="team-invite" value={inviteCode} onChange={(event) => setInviteCode(normalizeInviteCode(event.target.value))} maxLength={6} minLength={6} required autoCapitalize="characters" autoComplete="off" spellCheck={false} aria-describedby="team-invite-hint" />
            <p id="team-invite-hint">6 letters or digits. No I, O, 0 or 1.</p>
            <button type="submit">{pending ? 'Please wait…' : 'Join team'}</button>
          </fieldset>
        </form>
      </div>
    </> : <>
      <div className="team-identity"><h2>{team.name}</h2>{team.banned === true && <span className="team-banned">Banned</span>}</div>
      <div className="team-details">
        <section className="team-panel">
          <h2>Members</h2>
          <p>{team.members.length} of 3 members</p>
          <ul className="team-members">{team.members.map((member) => <li key={member.id}>{member.displayName}</li>)}</ul>
        </section>
        <section className="team-panel">
          <h2>Invite teammates</h2>
          <p>Share this code with the people you want on your team.</p>
          <div className="team-code"><span aria-label="Team invite code">{team.inviteCode}</span><button type="button" disabled={disabled} onClick={copyInvite}>Copy</button></div>
          {copied && <p role="status">Copied to clipboard.</p>}
          <p className="team-score">Score <strong>{team.score}</strong></p>
        </section>
      </div>
      <section className="team-leave">
        <h2>Leave this team</h2>
        {confirmLeave ? <div role="group" aria-label="Confirm leaving team">
          <p>Leave {team.name}? You will need an invite code to rejoin. If you are the last member, the team will be deleted.</p>
          <div className="team-actions"><button type="button" disabled={disabled || Boolean(loadError)} onClick={() => changeTeam('leave')}>Confirm leave</button><button type="button" className="secondary" disabled={disabled} onClick={() => setConfirmLeave(false)}>Cancel</button></div>
        </div> : <button type="button" className="secondary" disabled={disabled || Boolean(loadError)} onClick={() => setConfirmLeave(true)}>Leave team</button>}
      </section>
    </>}
  </section>;
}
