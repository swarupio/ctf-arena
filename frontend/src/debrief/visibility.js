// Who sees a debrief and what it is called. Pure, so tests cover every combination.
// Admins always see it (labelled preview, they never solve anything); players after capture; everyone once the event ended.

export const DEBRIEF_TITLE = 'Debrief: what you just learned';
export const WRITEUP_TITLE = 'Write-up';
export const PREVIEW_TITLE = 'Debrief: how this level works (preview, opens for players after they capture the flag)';

/** 'preview' | 'captured' | 'writeup' | null (hidden). */
export function debriefMode({ isAdmin = false, captured = false, eventEnded = false } = {}) {
  if (isAdmin) { return 'preview'; }
  if (captured) { return 'captured'; }
  if (eventEnded) { return 'writeup'; }
  return null;
}

export const modeTitle = (mode) => (mode === 'preview' ? PREVIEW_TITLE : mode === 'writeup' ? WRITEUP_TITLE : DEBRIEF_TITLE);

// Only a finished event is public knowledge: a failed or missing schedule must never unlock write-ups.
export const isEnded = (event) => event?.phase === 'ended';
