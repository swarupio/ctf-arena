import { useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useModal } from './useModal.js';

// Right-hand detail panel (full width on phones). A dialog: ESC and the close button dismiss it, Tab stays inside.
export default function Drawer({ open, title, subtitle, onClose, children, wide = false }) {
  const ref = useRef(null);
  const titleId = useId();
  useModal(ref, { open, onClose, initialFocus: '[data-autofocus]' });
  if (!open) return null;
  return createPortal(<div className="adm-overlay adm-overlay-drawer" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={ref} className={`adm-drawer${wide ? ' adm-drawer-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
      <div className="adm-drawer-head">
        <div>
          <h2 id={titleId}>{title}</h2>
          {subtitle && <p className="adm-muted">{subtitle}</p>}
        </div>
        <button type="button" className="secondary small" data-autofocus onClick={onClose} aria-label="Close details">Close</button>
      </div>
      <div className="adm-drawer-body">{children}</div>
    </div>
  </div>, document.body);
}
