import './onboarding.css';

/** Admins have no team and cannot capture flags, so they get a note instead of the checklist. */
export default function PreviewNote() {
  return <p className="ob-preview" role="note"><strong>Preview mode.</strong> Admin accounts have no team and cannot capture flags. Every level is open so you can look around.</p>;
}
