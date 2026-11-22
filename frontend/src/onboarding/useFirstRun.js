import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiGet } from '../api/client.js';
import { GAMES } from '../games/registry.js';
import { buildChecklist, checklistProgress } from './firstLevels.js';

/**
 * Loads the raw overview of every category (same GET and cache options as The Range hub, so the answers are shared)
 * and builds the checklist. Pass enabled=false to skip all requests (signed out, admin, already dismissed).
 */
export function useFirstRun(enabled) {
  const [inputs, setInputs] = useState({});

  const load = useCallback((game, isActive) => {
    const set = (value) => { if (isActive()) setInputs((current) => ({ ...current, [game.id]: value })); };
    apiGet(game.overview, { ttl: 10_000, swr: 60_000, onRevalidate: (raw) => set({ raw }) })
      .then((raw) => set({ raw }))
      .catch(() => set({ error: true }));
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    GAMES.forEach((game) => load(game, () => active));
    return () => { active = false; };
  }, [enabled, load]);

  const retry = useCallback((id) => {
    const game = GAMES.find((item) => item.id === id);
    if (!game) return;
    setInputs((current) => ({ ...current, [id]: undefined }));
    load(game, () => true);
  }, [load]);

  const steps = useMemo(() => buildChecklist(enabled ? inputs : {}, GAMES), [enabled, inputs]);
  return { steps, progress: checklistProgress(steps), retry };
}
