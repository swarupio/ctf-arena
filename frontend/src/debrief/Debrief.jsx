import { Suspense, lazy } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import useEventEnded from './useEventEnded.js';
import { debriefMode } from './visibility.js';

// The view (and with it the ~90 KB of debrief text) is its own chunk, fetched only once a debrief can actually show:
// after a capture, for admins, or when the event has ended. Until then this component renders nothing, as before.
const DebriefView = lazy(() => import('./DebriefView.jsx'));

// Same props as the view: <Debrief levelKey captured eventEnded hintsUsed />. See DebriefView.jsx for the behaviour.
export default function Debrief({ levelKey, captured = false, eventEnded, ...rest }) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const needsEvent = eventEnded === undefined && Boolean(levelKey) && !captured && !isAdmin;
  const fetched = useEventEnded({ enabled: needsEvent });
  const mode = levelKey ? debriefMode({ isAdmin, captured, eventEnded: eventEnded ?? fetched }) : null;
  if (!mode) { return null; }
  return <Suspense fallback={null}><DebriefView levelKey={levelKey} captured={captured} eventEnded={eventEnded} {...rest} /></Suspense>;
}
