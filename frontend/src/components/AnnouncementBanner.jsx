import { useEffect, useState } from 'react';
import { getAnnouncement } from '../api/announcement.js';
import { startPolling } from '../pages/poller.js';
import {
  ANNOUNCEMENT_POLL_MS, bannerLevel, bannerRole, dismiss, isDismissed, visibleAnnouncement,
} from './announcement.js';
import './AnnouncementBanner.css';

// Presentation only (also used for the live preview in admin Settings). The text is rendered as plain text.
export function BannerView({ text, level, onDismiss }) {
  const kind = bannerLevel(level);
  return <div className={`announcement announcement-${kind}`} role={bannerRole(kind)}>
    <p><strong className="announcement-label">{kind === 'info' ? 'Notice' : kind === 'warning' ? 'Warning' : 'Important'}:</strong> {text}</p>
    {onDismiss && <button type="button" className="secondary small" onClick={onDismiss} aria-label="Dismiss announcement">Dismiss</button>}
  </div>;
}

// Site-wide banner from the public GET /api/announcement. Polled every 60 s (paused while the tab is hidden),
// failures are silent, and a dismissal lasts for the browser session until the message changes.
export default function AnnouncementBanner() {
  const [announcement, setAnnouncement] = useState(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const poller = startPolling(async () => {
      try {
        const next = visibleAnnouncement(await getAnnouncement());
        setAnnouncement(next);
        setHidden(next ? isDismissed(next) : false);
        return true;
      } catch { return false; }
    }, { intervalMs: ANNOUNCEMENT_POLL_MS });
    return () => poller.stop();
  }, []);

  if (!announcement || hidden) return null;
  return <BannerView {...announcement} onDismiss={() => { dismiss(announcement); setHidden(true); }} />;
}
