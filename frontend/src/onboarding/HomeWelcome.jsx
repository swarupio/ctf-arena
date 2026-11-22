import { useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { dismissWelcome, isWelcomeDismissed, showChecklist, showWelcome, storageKey } from './storage.js';
import { recommendedStep } from './firstLevels.js';
import { useFirstRun } from './useFirstRun.js';
import WelcomeCard from './WelcomeCard.jsx';

// Fetches nothing for signed-out users, admins or players who already dismissed the card.
function Inner({ user }) {
  const [dismissed, setDismissed] = useState(() => isWelcomeDismissed(user.email));
  const { steps } = useFirstRun(!dismissed);
  if (!showWelcome({ user, steps, dismissed })) return null;
  const onDismiss = () => { dismissWelcome(user.email); setDismissed(true); };
  return <WelcomeCard step={recommendedStep(steps)} onDismiss={onDismiss} />;
}

/** Slot for the Home page: the "New here?" card for signed-in players with no captured flag. */
export default function HomeWelcome() {
  const { user, loading } = useAuth();
  if (loading || !showChecklist(user) || !storageKey(user.email)) return null;
  return <Inner key={user.email} user={user} />;
}
