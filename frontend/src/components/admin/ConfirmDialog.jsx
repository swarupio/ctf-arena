import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { typedMatches } from '../../admin/forms.js';
import { useModal } from './useModal.js';

// Confirmation modal. With `phrase` the admin must type it before the button enables (typed confirmation).
// Extra form fields (a reason, a checkbox) go in as children; use `canConfirm` to gate them.
// Focus starts on Cancel (or on the phrase box), Tab stays inside, ESC cancels, focus returns to the opener.
export default function ConfirmDialog({
  open, title, children, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false,
  phrase = '', pending = false, canConfirm = true, error = '', onConfirm, onCancel,
}) {
  const ref = useRef(null);
  const titleId = useId();
  const bodyId = useId();
  const inputId = useId();
  const [typed, setTyped] = useState('');
  useEffect(() => { if (!open) setTyped(''); }, [open]);
  const close = () => { if (!pending) { setTyped(''); onCancel(); } };
  useModal(ref, { open, onClose: close, initialFocus: phrase ? `#${CSS.escape(inputId)}` : '[data-autofocus]' });
  if (!open) return null;
  const ready = canConfirm && !pending && (!phrase || typedMatches(typed, phrase));

  function submit(event) {
    event.preventDefault();
    if (ready) onConfirm();
  }

  return createPortal(<div className="adm-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
    <div ref={ref} className={`adm-dialog${danger ? ' adm-dialog-danger' : ''}`} role="alertdialog" aria-modal="true"
      aria-labelledby={titleId} aria-describedby={bodyId} tabIndex={-1}>
      <form onSubmit={submit}>
        <h2 id={titleId}>{title}</h2>
        <div id={bodyId} className="adm-dialog-body">{children}</div>
        {phrase && <label className="adm-typed" htmlFor={inputId}>
          <span>Type <code>{phrase}</code> to confirm</span>
          <input id={inputId} value={typed} onChange={(event) => setTyped(event.target.value)} autoComplete="off" autoCapitalize="off" spellCheck={false} />
        </label>}
        {error && <p role="alert" className="error">{error}</p>}
        <div className="adm-dialog-actions">
          <button type="button" className="secondary" data-autofocus onClick={close} disabled={pending}>{cancelLabel}</button>
          <button type="submit" className={danger ? 'adm-danger' : ''} disabled={!ready}>{pending ? 'Working…' : confirmLabel}</button>
        </div>
      </form>
    </div>
  </div>, document.body);
}
