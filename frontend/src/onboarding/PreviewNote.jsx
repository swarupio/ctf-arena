import SharedPreviewNote from '../components/PreviewNote.jsx';

/** Admins have no team and cannot capture flags, so they get a note instead of the checklist. */
export default function PreviewNote() {
  return <SharedPreviewNote>Admin accounts have no team and cannot capture flags. Every level is open so you can look around.</SharedPreviewNote>;
}
