import './PreviewNote.css';

// The one admin-preview note, used wherever an admin sees a level or challenge they cannot play (no team, no flags).
// Same words, same style on every page. Plain text, so it needs no disabled control next to it.
export default function PreviewNote({ children }) {
  return <p className="preview-note" role="note"><strong>Preview mode.</strong> {children ?? 'Admin accounts have no team and cannot capture flags.'}</p>;
}
