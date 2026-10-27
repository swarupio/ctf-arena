let replica = null;
const listeners = new Set();

export function getServedBy() {
  return replica;
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setServedBy(value) {
  if (!value || value === replica) { return; }
  replica = value;
  for (const listener of listeners) { listener(); }
}
