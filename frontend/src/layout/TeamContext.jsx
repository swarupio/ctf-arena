import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { apiGet, clearApiCache } from '../api/client.js';
import { fetchTeamState } from '../api/teams.js';

const TeamContext = createContext(null);

export function TeamProvider({ children }) {
  const auth = useAuth();
  const authRef = useRef(auth);
  authRef.current = auth;
  const generation = useRef(0);
  const [state, setState] = useState({ team: undefined, profile: null, loading: true, error: null });

  const refresh = useCallback(async ({ refreshProfile = false, fresh = true } = {}) => {
    const requestId = ++generation.current;
    setState((state) => ({ ...state, loading: true, error: null }));
    try {
      const snapshot = await fetchTeamState((path) => apiGet(path, { ttl: fresh ? 0 : 5_000 }));
      if (generation.current === requestId) {
        setState({ ...snapshot, loading: false, error: null });
        if (refreshProfile) authRef.current.retryProfile();
      }
      return snapshot;
    } catch (error) {
      if (generation.current === requestId) setState((state) => ({ ...state, loading: false, error }));
      throw error;
    }
  }, []);

  useEffect(() => {
    if (auth.user) void refresh({ fresh: false }).catch(() => {});
    else { clearApiCache(); setState({ team: undefined, profile: null, loading: false, error: null }); }
    return () => { generation.current += 1; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the user email on purpose; the user object changes identity on token refresh
  }, [auth.user?.email, refresh]);

  const profile = state.profile ?? auth.profile;
  const value = useMemo(() => ({ ...state, profile, refresh }), [state, profile, refresh]);
  return <TeamContext.Provider value={value}>{children}</TeamContext.Provider>;
}

export function useTeam() {
  return useContext(TeamContext);
}
