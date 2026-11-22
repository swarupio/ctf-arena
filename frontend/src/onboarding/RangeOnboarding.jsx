import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { useTeam } from '../layout/TeamContext.jsx';
import { showChecklist } from './storage.js';
import { readChecklistHint, writeChecklistHint } from './checklistHint.js';
import { useFirstRun } from './useFirstRun.js';
import FirstFlagChecklist from './FirstFlagChecklist.jsx';
import PreviewNote from './PreviewNote.jsx';

/** Slot for The Range hub: the checklist for players, a short preview note for admins. */
export default function RangeOnboarding() {
  const { user } = useAuth();
  const { profile } = useTeam();
  const player = showChecklist(user);
  const { steps, progress, retry } = useFirstRun(player);
  const email = player ? user.email : '';
  // Last known shape of the card, read once per player, so the card is drawn at its final height from the first paint.
  const [hint, setHint] = useState(() => readChecklistHint(email));
  useEffect(() => { setHint(readChecklistHint(email)); }, [email]);
  const settled = progress.loaded && progress.failed === 0;
  const state = settled ? (progress.done === progress.total ? 'cleared' : 'open') : '';
  useEffect(() => { if (state) writeChecklistHint(email, state); }, [email, state]);
  if (!user) return null;
  if (!player) return <PreviewNote />;
  return <FirstFlagChecklist steps={steps} progress={progress} onRetry={retry} hint={hint} needsTeam={Boolean(profile) && !profile.team} />;
}
