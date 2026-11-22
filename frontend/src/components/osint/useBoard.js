import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { checkBoard, getBoard, saveBoard } from '../../api/osint.js';
import { applyOps, describeBoardError } from '../../osint/board.js';
import { SAVE_DELAY_MS, leavingPayload, runFlush } from '../../osint/flush.js';

const POLL_MS = 20_000;

// The shared board of one case. `server` is the last board the API confirmed; `ops` are the edits made since. The shown
// board is server + ops, saves are debounced, and a 409 (a teammate saved first) reloads the board and replays the edits.
export function useBoard(track, { onUnlocked } = {}) {
  const [server, setServer] = useState(null);
  const [ops, setOps] = useState([]);
  const [status, setStatus] = useState({ kind: 'loading', message: '' });
  const [checked, setChecked] = useState(null);
  const [checkError, setCheckError] = useState('');
  const serverRef = useRef(null);
  const opsRef = useRef([]);
  const busy = useRef(false);
  const timer = useRef(null);
  const alive = useRef(true);
  const unlockedCallback = useRef(onUnlocked);
  unlockedCallback.current = onUnlocked;

  const commit = useCallback((nextServer, nextOps) => {
    serverRef.current = nextServer;
    opsRef.current = nextOps;
    setServer(nextServer);
    setOps(nextOps);
  }, []);

  const load = useCallback(async () => {
    try {
      const fresh = await getBoard(track);
      if (!alive.current || busy.current) { return; }
      commit(fresh, opsRef.current);
      setStatus((s) => (s.kind === 'loading' ? { kind: 'idle', message: '' } : s));
    } catch (error) {
      if (alive.current) { setStatus({ kind: 'error', message: describeBoardError(error) }); }
    }
  }, [track, commit]);

  const flush = useCallback(async () => {
    if (busy.current || opsRef.current.length === 0 || !serverRef.current || serverRef.current.readOnly) { return; }
    busy.current = true;
    try {
      await runFlush({
        getOps: () => opsRef.current,
        getServer: () => serverRef.current,
        save: (payload) => saveBoard(track, payload),
        fetchBoard: () => getBoard(track),
        commit,
        setStatus,
        isAlive: () => alive.current,
        onUnlocked: () => unlockedCallback.current?.(),
        schedule: (delay) => { clearTimeout(timer.current); timer.current = setTimeout(() => { void flush(); }, delay); },
        describe: describeBoardError,
      });
    } finally { busy.current = false; }
  }, [track, commit]);

  // The exact count of the SAVED board, only on request (the server budgets it: 3 a minute, 10 an hour).
  const check = useCallback(async () => {
    try {
      const result = await checkBoard(track);
      if (alive.current) { setChecked({ ...result, version: serverRef.current?.version ?? 0 }); setCheckError(''); }
    } catch (error) {
      if (alive.current) { setCheckError(describeBoardError(error)); }
    }
  }, [track]);

  const dispatch = useCallback((op) => {
    const next = [...opsRef.current, op];
    opsRef.current = next;
    setOps(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flush(); }, SAVE_DELAY_MS);
  }, [flush]);

  useEffect(() => {
    alive.current = true;
    commit(null, []);
    setChecked(null);
    setCheckError('');
    setStatus({ kind: 'loading', message: '' });
    void load();
    const poll = setInterval(() => {
      if (document.visibilityState === 'visible' && opsRef.current.length === 0 && !busy.current && serverRef.current && !serverRef.current.readOnly) { void load(); }
    }, POLL_MS);
    // Edits made less than a debounce before leaving would be lost: send them now (keepalive lets the request outlive the
    // page), and ask the browser to confirm while some are still pending.
    const sendPending = () => {
      const payload = busy.current ? null : leavingPayload(serverRef.current, opsRef.current);
      if (payload) { saveBoard(track, payload, { keepalive: true }).catch(() => {}); }
    };
    const warn = (event) => { if (opsRef.current.length > 0) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('pagehide', sendPending);
    window.addEventListener('beforeunload', warn);
    return () => {
      sendPending();
      alive.current = false;
      clearTimeout(timer.current);
      clearInterval(poll);
      window.removeEventListener('pagehide', sendPending);
      window.removeEventListener('beforeunload', warn);
    };
  }, [track, load, commit]);

  const board = useMemo(() => (server ? applyOps(server, ops) : null), [server, ops]);
  return { board, status, dispatch, reload: load, pending: ops.length, check, checked, checkError };
}
