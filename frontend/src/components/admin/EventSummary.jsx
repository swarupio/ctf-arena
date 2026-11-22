import { Link } from 'react-router-dom';
import { getSettings } from '../../api/admin.js';
import { PHASE_LABELS } from '../../admin/eventForm.js';
import { useAdminData } from '../../admin/hooks.js';
import { formatDate } from '../../admin/format.js';
import { Badge, Panel } from './PageHeader.jsx';

// Same box as the loaded panel while the settings load (one line of text), so the stat cards below do not jump down.
export function EventSummarySkeleton() {
  return <Panel title="Event" id="overview-event" actions={<Link to="/admin/settings">Schedule</Link>}>
    <p aria-hidden="true"><span className="adm-skel-text">Event disabled. No countdown or automatic freeze. Schedule one.</span></p>
  </Panel>;
}

// Small "Event" panel for the admin Overview. Silent on errors (the Overview has its own error handling).
export default function EventSummary() {
  const { data, error } = useAdminData((signal) => getSettings(signal), []);
  if (!data) return error ? null : <EventSummarySkeleton />;
  const event = data.event;
  return <Panel title="Event" id="overview-event" actions={<Link to="/admin/settings">Schedule</Link>}>
    {event
      ? <p>
        <strong>{event.name || 'Arena event'}</strong> <Badge tone={event.phase === 'live' || event.phase === 'frozen' ? 'ok' : ''}>{event.phase}</Badge>{' '}
        <span className="adm-muted">{PHASE_LABELS[event.phase]}. {formatDate(event.startsAt)} to {formatDate(event.endsAt)}{event.freezeAt ? `, freeze at ${formatDate(event.freezeAt)}` : ''}.</span>
      </p>
      : <p className="adm-muted">Event disabled. No countdown or automatic freeze. <Link to="/admin/settings">Schedule one</Link>.</p>}
  </Panel>;
}
