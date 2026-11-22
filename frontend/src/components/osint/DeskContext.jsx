import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../auth/AuthContext.jsx';
import { addFreeNote, isPinned, loadNotes, notesScope, pinItem, removeNote, saveNotes } from '../../osint/helpers.js';

const DeskContext = createContext(null);
export const useDesk = () => useContext(DeskContext);

const storage = () => { try { return window.localStorage; } catch { return null; } };

// Shared state of one investigation desk: the evidence notebook (kept in this browser only, per account and case), the
// time display mode and the last point picked on the map. Nothing here is sent to the server.
export function DeskProvider({ track, children, onOpenTab, onRefresh }) {
  const { user } = useAuth();
  const scope = notesScope(user?.email, track);
  const [notes, setNotes] = useState(() => loadNotes(storage(), scope));
  const [utc, setUtc] = useState(false);
  const [pick, setPick] = useState(null);
  useEffect(() => { setNotes(loadNotes(storage(), scope)); setPick(null); }, [scope]);
  const commit = useCallback((next) => { setNotes(next); saveNotes(storage(), scope, next); }, [scope]);
  const value = useMemo(() => ({
    track, notes, utc, setUtc, pick, setPick, openTab: onOpenTab, refresh: onRefresh,
    pin: (item) => commit(pinItem(notes, item)),
    note: (text) => commit(addFreeNote(notes, text)),
    remove: (id) => commit(removeNote(notes, id)),
    pinned: (source, id) => isPinned(notes, source, id),
  }), [track, notes, utc, pick, commit, onOpenTab, onRefresh]);
  return <DeskContext.Provider value={value}>{children}</DeskContext.Provider>;
}
