import { useEffect, useState, useSyncExternalStore } from 'react';
import { DARK_THEME_ENABLED } from './config.js';
import { getThemeController, nextPreference, themeLabel } from './theme.js';
import './theme.css';

const ICONS = {
  // Sun, moon and monitor drawn with currentColor strokes so they follow the theme.
  light: <><circle cx="12" cy="12" r="4" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" /></>,
  dark: <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z" />,
  system: <><rect x="3" y="4" width="18" height="12" rx="1" /><path d="M8 20h8M12 16v4" /></>,
};

// One button that cycles System -> Light -> Dark. Icon only on a wide header, icon and text in the mobile menu panel.
// The accessible name states the current choice and what a press does; a visually hidden status announces the change.
export default function ThemeToggle() {
  const controller = getThemeController();
  const preference = useSyncExternalStore(controller.subscribe, controller.getPreference, controller.getPreference);
  const [announcement, setAnnouncement] = useState('');
  useEffect(() => (DARK_THEME_ENABLED ? controller.start() : undefined), [controller]);
  if (!DARK_THEME_ENABLED) return null;

  const next = nextPreference(preference);
  function press() {
    controller.setPreference(next);
    setAnnouncement(`Theme set to ${themeLabel(next).toLowerCase()}`);
  }

  return <div className="theme-toggle">
    <button type="button" className="secondary theme-btn" onClick={press} aria-label={`Theme: ${themeLabel(preference).toLowerCase()}. Switch to ${themeLabel(next).toLowerCase()}`} title={`Theme: ${themeLabel(preference)}`}>
      <svg className="theme-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{ICONS[preference]}</svg>
      <span className="theme-btn-text" aria-hidden="true">Theme: {themeLabel(preference)}</span>
    </button>
    <span className="theme-status" role="status">{announcement}</span>
  </div>;
}
