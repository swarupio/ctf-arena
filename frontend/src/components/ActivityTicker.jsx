import { useEffect, useState } from 'react';
import { getFeed } from '../api/social.js';
import { startPolling } from '../pages/poller.js';
import { describeEvent, eventKey, eventTag, timeAgo, visibleEvents } from '../pages/socialHelpers.js';
import './Social.css';

// Live-ish public activity list. Polls with the shared poller (paused while the tab is hidden) and keeps the last
// good data when a refresh fails, so a hiccup never blanks the ticker.
export default function ActivityTicker({ limit = 8, title = 'Live activity' }) {
  const [events, setEvents] = useState(null);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let active = true;
    const poller = startPolling(async () => {
      try {
        const feed = await getFeed(limit);
        if (active) { setEvents(visibleEvents(feed, limit)); setFailed(false); setNow(Date.now()); }
      } catch {
        if (active) setFailed(true);
      }
    });
    return () => { active = false; poller.stop(); };
  }, [limit]);

  return <section className="fx-ticker" aria-labelledby="fx-ticker-title">
    <h2 id="fx-ticker-title"><span className="fx-live" aria-hidden="true" />{title}</h2>
    {events === null
      ? <p role="status" className="fx-note">{failed ? 'Activity is unavailable right now.' : 'Loading activity…'}</p>
      : events.length === 0
        ? <p className="fx-note">Nothing yet. Be the first to capture a flag.</p>
        : <ul className="fx-feed">
          {events.map((event, index) => <li key={eventKey(event, index)} className={`fx-event fx-${event.type}`}>
            <span className="fx-tag">{eventTag(event)}</span>
            <span className="fx-text">{describeEvent(event)}</span>
            <time className="fx-time" dateTime={event.at}>{timeAgo(event.at, now)}</time>
          </li>)}
        </ul>}
    {failed && events !== null && <p className="fx-note">Showing the last activity. Refresh failed.</p>}
  </section>;
}
