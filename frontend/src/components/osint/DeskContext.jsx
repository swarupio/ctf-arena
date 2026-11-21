import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { addFreeNote, isPinned, loadNotes, pinItem, removeNote, saveNotes } from '../../osint/helpers.js';

const DeskContext = createContext(null);
export const useDesk = () => useContext(DeskContext);

const storage = () => { try { return window.localStorage; } catch { return null; } };

// Shared state of one investigation desk: the evidence notebook (kept in this browser only), the time display mode and
// the last point picked on the map. Nothing here is sent to the server.
export function DeskProvider({ track, children, onOpenTab }) {
  const [notes, setNotes] = useState(() => loadNotes(storage(), track));
  const [utc, setUtc] = useState(false);
  const [pick, setPick] = useState(null);
  useEffect(() => { setNotes(loadNotes(storage(), track)); setPick(null); }, [track]);
  const commit = useCallback((next) => { setNotes(next); saveNotes(storage(), track, next); }, [track]);
  const value = useMemo(() => ({
    track, notes, utc, setUtc, pick, setPick, openTab: onOpenTab,
    pin: (item) => commit(pinItem(notes, item)),
    note: (text) => commit(addFreeNote(notes, text)),
    remove: (id) => commit(removeNote(notes, id)),
    pinned: (source, id) => isPinned(notes, source, id),
  }), [track, notes, utc, pick, commit, onOpenTab]);
  return <DeskContext.Provider value={value}>{children}</DeskContext.Provider>;
}
