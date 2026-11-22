import { useEffect, useId, useState, useSyncExternalStore } from 'react';
import { DARK_THEME_ENABLED } from './config.js';
import { THEME_OPTIONS, getThemeController, nextTheme, themeHint } from './theme.js';
import './theme.css';

// One SVG set: 24x24 box, 2px round strokes, currentColor. Only sun and moon are used by the header switch.
const ICONS = {
  light: <><circle cx="12" cy="12" r="4" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" /></>,
  dark: <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z" />,
};

function useTheme() {
  const controller = getThemeController();
  // Both values come from the same store that sets the <html> attribute, so the icon never lags behind the page.
  const preference = useSyncExternalStore(controller.subscribe, controller.getPreference, controller.getPreference);
  const effective = useSyncExternalStore(controller.subscribe, controller.getEffective, controller.getEffective);
  useEffect(() => (DARK_THEME_ENABLED ? controller.start() : undefined), [controller]);
  return { controller, preference, effective };
}

// Two-state switch for the header and the mobile menu. Convention: the icon shows the theme a click switches TO
// (moon while the page is light, sun while it is dark) and the accessible name states that action. One click always changes the page.
export default function ThemeToggle() {
  const { controller, preference, effective } = useTheme();
  const [announcement, setAnnouncement] = useState('');
  if (!DARK_THEME_ENABLED) return null;

  const target = nextTheme(preference, effective === 'dark');
  const action = `Switch to ${target} theme`;
  function press() {
    controller.setPreference(target);
    setAnnouncement(`Theme set to ${target}`);
  }

  return <div className="theme-toggle">
    <button type="button" className="secondary theme-btn" onClick={press} aria-label={action} title={action}>
      <svg className="theme-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{ICONS[target]}</svg>
      <span className="theme-btn-text" aria-hidden="true">{action}</span>
    </button>
    <span className="theme-status" role="status">{announcement}</span>
  </div>;
}

// Three-option selector (System / Light / Dark) for the footer and the mobile menu. System lives here, not in the header button.
export function ThemeSelect({ className = '' }) {
  const { controller, preference, effective } = useTheme();
  const name = useId();
  const [announcement, setAnnouncement] = useState('');
  if (!DARK_THEME_ENABLED) return null;

  function choose(value) {
    controller.setPreference(value);
    setAnnouncement(`Theme set to ${value === 'system' ? `system, showing ${controller.getEffective()}` : value}`);
  }

  return <fieldset className={`theme-select ${className}`.trim()}>
    <legend>Theme</legend>
    <div className="theme-select-options">
      {THEME_OPTIONS.map((option) => <label key={option.value} className="theme-option">
        <input type="radio" name={name} value={option.value} checked={preference === option.value} onChange={() => choose(option.value)} />
        <span>{option.label}</span>
      </label>)}
    </div>
    <p className="theme-hint">{themeHint(preference, effective)}<span className="theme-status"> System is Auto (follows your device).</span></p>
    <span className="theme-status" role="status">{announcement}</span>
  </fieldset>;
}
