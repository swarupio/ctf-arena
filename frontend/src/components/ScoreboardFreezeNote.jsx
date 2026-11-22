import { useEffect, useState } from 'react';
import { getMyScore } from '../api/event.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { clockText, phaseAt } from '../event/logic.js';
import { useEventClock } from '../event/useEventClock.js';
import { startPolling } from '../pages/poller.js';
import './ScoreboardFreezeNote.css';

// Shown on the Leaderboard page while an event's scoreboard is frozen: what players see (standings as of the freeze),
// the team's own live totals (never other teams' live data), and for admins a reminder that they see live standings.
export default function ScoreboardFreezeNote() {
  const { user } = useAuth();
  const { event, nowMs } = useEventClock({ tickMs: 10_000 });
  const frozen = Boolean(event) && phaseAt(event, nowMs) === 'frozen';
  const admin = user?.role === 'admin';
  const [mine, setMine] = useState(null);

  useEffect(() => {
    if (!frozen || admin) { setMine(null); return undefined; }
    const poller = startPolling(async () => {
      try { setMine((await getMyScore())?.team ?? null); return true; } catch { return false; }
    }, { intervalMs: 15_000 });
    return () => poller.stop();
  }, [frozen, admin]);

  if (!event) return null;
  const at = clockText(event.freezeAt);
  if (frozen) {
    return <div className="lb-frozen" role="status">
      <p><strong>Scoreboard frozen at {at}.</strong> {admin
        ? 'Players see the standings as of then; you are looking at live standings.'
        : 'Solves after that time stay hidden until the event ends. Flags are still accepted.'}</p>
      {mine && <p>Your team&apos;s live score (only your team sees this): <strong>{mine.points}</strong> {mine.points === 1 ? 'point' : 'points'}, {mine.solves} {mine.solves === 1 ? 'solve' : 'solves'}.</p>}
    </div>;
  }
  if (phaseAt(event, nowMs) === 'ended') {
    return <div className="lb-frozen" role="status"><p><strong>The event has ended.</strong> These are the final standings.</p></div>;
  }
  return null;
}
