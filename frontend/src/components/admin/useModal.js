import { useEffect, useRef } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Next index when Tab is pressed inside a trap of `count` focusable elements (pure, so it can be tested).
export function trapIndex(current, count, shift) {
  if (count <= 0) return -1;
  if (current === -1) return shift ? count - 1 : 0;
  if (shift) return current === 0 ? count - 1 : current - 1;
  return current === count - 1 ? 0 : current + 1;
}

// Open modals, newest last: a confirmation opened from a drawer handles ESC and Tab, the drawer waits.
const stack = [];

// Modal behaviour for dialogs and drawers: ESC closes, Tab stays inside, focus moves in on open and goes back to the
// element that opened it, and the page behind does not scroll. `initialFocus` is a selector inside the container.
export function useModal(ref, { open, onClose, initialFocus }) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const token = {};
    stack.push(token);
    const opener = document.activeElement;
    const container = ref.current;
    const items = () => [...(container?.querySelectorAll(FOCUSABLE) ?? [])];
    (container?.querySelector(initialFocus ?? '[data-autofocus]') || items()[0] || container)?.focus();

    function onKeyDown(event) {
      if (stack[stack.length - 1] !== token) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current?.();
        return;
      }
      if (event.key !== 'Tab' || !container) return;
      const nodes = items();
      if (nodes.length === 0) { event.preventDefault(); container.focus(); return; }
      const index = nodes.indexOf(document.activeElement);
      const atEdge = index === -1 || (event.shiftKey ? index === 0 : index === nodes.length - 1);
      if (atEdge) {
        event.preventDefault();
        nodes[trapIndex(index, nodes.length, event.shiftKey)].focus();
      }
    }
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      stack.splice(stack.indexOf(token), 1);
      if (stack.length === 0) document.body.style.overflow = overflow;
      if (opener && typeof opener.focus === 'function' && document.contains(opener)) opener.focus();
    };
  }, [open, ref, initialFocus]);
}
