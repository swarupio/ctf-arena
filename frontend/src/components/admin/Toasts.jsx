import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { dropToast, pushToast, toastDuration } from '../../admin/toast.js';

const ToastContext = createContext(null);

// Both live regions stay mounted so screen readers pick up new messages: polite for success and info,
// assertive (role alert) for errors.
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(1);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setToasts((list) => dropToast(list, id));
  }, []);

  const push = useCallback((kind, message) => {
    if (!message) return;
    const id = nextId.current++;
    setToasts((list) => pushToast(list, { id, kind, message }));
    timers.current.set(id, setTimeout(() => dismiss(id), toastDuration(kind)));
  }, [dismiss]);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((timer) => clearTimeout(timer));
  }, []);

  const api = useMemo(() => ({
    success: (message) => push('success', message),
    info: (message) => push('info', message),
    error: (message) => push('error', message),
  }), [push]);

  const render = (list) => list.map((toast) => <div key={toast.id} className={`adm-toast adm-toast-${toast.kind}`}>
    <p>{toast.message}{toast.count > 1 ? <span className="adm-toast-count"> (x{toast.count})</span> : null}</p>
    <button type="button" className="adm-toast-close secondary small" aria-label="Dismiss message" onClick={() => dismiss(toast.id)}>&times;</button>
  </div>);

  return <ToastContext.Provider value={api}>
    {children}
    <div className="adm-toasts">
      <div role="status" aria-live="polite" aria-atomic="false">{render(toasts.filter((toast) => toast.kind !== 'error'))}</div>
      <div role="alert" aria-live="assertive" aria-atomic="false">{render(toasts.filter((toast) => toast.kind === 'error'))}</div>
    </div>
  </ToastContext.Provider>;
}

export function useToasts() {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToasts needs a ToastProvider.');
  return api;
}
