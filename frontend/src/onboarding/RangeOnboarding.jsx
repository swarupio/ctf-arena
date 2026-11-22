import { useAuth } from '../auth/AuthContext.jsx';
import { useTeam } from '../layout/TeamContext.jsx';
import { showChecklist } from './storage.js';
import { useFirstRun } from './useFirstRun.js';
import FirstFlagChecklist from './FirstFlagChecklist.jsx';
import PreviewNote from './PreviewNote.jsx';

/** Slot for The Range hub: the checklist for players, a short preview note for admins. */
export default function RangeOnboarding() {
  const { user } = useAuth();
  const { profile } = useTeam();
  const player = showChecklist(user);
  const { steps, progress, retry } = useFirstRun(player);
  if (!user) return null;
  if (!player) return <PreviewNote />;
  return <FirstFlagChecklist steps={steps} progress={progress} onRetry={retry} needsTeam={Boolean(profile) && !profile.team} />;
}
