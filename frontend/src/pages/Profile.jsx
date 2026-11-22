import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getPlayerProfile } from '../api/social.js';
import { useTeam } from '../layout/TeamContext.jsx';
import {
  FIRST_BLOOD_NOTE, categoryTone, shareText, socialErrorMessage, sortBadges, streakLabel, timeAgo, unlockedBadges,
} from './socialHelpers.js';
import '../components/Social.css';
import './Profile.css';

function BadgeGrid({ badges }) {
  return <ul className="pf-badges" aria-label="Badges">
    {sortBadges(badges).map((badge) => <li key={badge.key} className={badge.unlocked ? 'pf-badge is-open' : 'pf-badge is-locked'}>
      <span className="pf-icon" aria-hidden="true">{badge.unlocked ? badge.icon : '\u{1F512}'}</span>
      <strong>{badge.name}</strong>
      <span className="pf-desc">{badge.description}</span>
      <span className="pf-state">{badge.unlocked ? `Unlocked ${timeAgo(badge.awardedAt)}` : 'Locked'}</span>
    </li>)}
  </ul>;
}

function ShareCard({ profile }) {
  const [note, setNote] = useState('');
  const text = shareText(profile);
  async function share() {
    try {
      if (navigator.share) { await navigator.share({ title: 'CTF Arena', text }); setNote('Shared.'); return; }
      await navigator.clipboard.writeText(text);
      setNote('Copied to the clipboard.');
    } catch { setNote('Could not share. Select the text above and copy it.'); }
  }
  const open = unlockedBadges(profile.badges);
  return <section className="pf-card pf-share" aria-labelledby="pf-share-title">
    <h2 id="pf-share-title">Share card</h2>
    <div className="pf-sharecard">
      <p className="pf-share-name">{profile.displayName}</p>
      <p>{profile.team ? `Team ${profile.team.name}` : 'No team yet'}</p>
      <p className="pf-share-stats">{profile.solves} {profile.solves === 1 ? 'flag' : 'flags'} | {open.length}/{profile.badges.length} badges | {profile.firstBloods} first {profile.firstBloods === 1 ? 'blood' : 'bloods'}</p>
      <p className="pf-share-icons" aria-hidden="true">{open.slice(0, 8).map((badge) => <span key={badge.key}>{badge.icon}</span>)}</p>
    </div>
    <button type="button" onClick={share}>{typeof navigator !== 'undefined' && navigator.share ? 'Share' : 'Copy summary'}</button>
    {note && <p role="status" className="fx-note">{note}</p>}
  </section>;
}

export default function Profile() {
  const params = useParams();
  const { profile: me } = useTeam() ?? {};
  const id = params.id ?? me?.id;
  const [state, setState] = useState({ profile: null, error: '', loading: true });

  useEffect(() => {
    if (!id) return undefined;
    let active = true;
    setState({ profile: null, error: '', loading: true });
    getPlayerProfile(id)
      .then((profile) => { if (active) setState({ profile, error: '', loading: false }); })
      .catch((error) => { if (active) setState({ profile: null, error: socialErrorMessage(error), loading: false }); });
    return () => { active = false; };
  }, [id]);

  if (!id) return <section className="pf-page"><h1>Profile</h1><p role="status">Loading your account…</p></section>;
  const { profile, error, loading } = state;
  if (loading) return <section className="pf-page"><h1>Profile</h1><p role="status">Loading the profile…</p></section>;
  if (error) return <section className="pf-page"><h1>Profile</h1><p role="alert" className="error">{error}</p><Link to="/">Back home</Link></section>;

  const open = unlockedBadges(profile.badges).length;
  return <section className="pf-page">
    <div className="pf-heading">
      <h1>{profile.displayName}</h1>
      <p className="pf-team">{profile.team ? `Team ${profile.team.name}` : 'No team yet'}</p>
    </div>

    <dl className="pf-stats">
      <div><dt>Flags</dt><dd>{profile.solves}</dd></div>
      <div><dt title={FIRST_BLOOD_NOTE}>First bloods</dt><dd>{profile.firstBloods}</dd></div>
      <div><dt>Badges</dt><dd>{open}/{profile.badges.length}</dd></div>
      <div><dt>Streak</dt><dd>{profile.streak.current}<span className="pf-unit"> days</span></dd></div>
    </dl>
    <p className={profile.streak.current > 0 ? 'pf-streak is-live' : 'pf-streak'}>{streakLabel(profile.streak)}</p>

    <section className="pf-card" aria-labelledby="pf-badges-title">
      <h2 id="pf-badges-title">Badges</h2>
      <BadgeGrid badges={profile.badges} />
    </section>

    <section className="pf-card" aria-labelledby="pf-recent-title">
      <h2 id="pf-recent-title">Recent flags</h2>
      {profile.recentSolves.length === 0
        ? <p className="fx-note">No flags captured yet.</p>
        : <ul className="pf-recent">
          {profile.recentSolves.map((solve, index) => <li key={`${solve.solvedAt}-${index}`}>
            <span className={`tag pf-cat-${categoryTone(solve.category)}`}>{solve.category}</span>
            {solve.difficulty && <span className={`tag tag-${solve.difficulty}`}>{solve.difficulty}</span>}
            {solve.firstBlood && <span className="tag tag-points" title={FIRST_BLOOD_NOTE}>first blood</span>}
            <time dateTime={solve.solvedAt}>{timeAgo(solve.solvedAt)}</time>
          </li>)}
        </ul>}
    </section>

    <ShareCard profile={profile} />
  </section>;
}
