// Copy text to the clipboard. navigator.clipboard needs a secure context (https or localhost); the arena may also be
// served over plain http on a VM, so fall back to a hidden textarea and execCommand.
export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through to the textarea route */ }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.setAttribute('aria-hidden', 'true');
  area.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none';
  document.body.appendChild(area);
  const previous = document.activeElement;
  area.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  area.remove();
  if (previous && typeof previous.focus === 'function') previous.focus({ preventScroll: true });
  return ok;
}
