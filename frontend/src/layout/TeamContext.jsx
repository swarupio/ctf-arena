import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { apiRequest } from '../api/client.js';
import { fetchTeamState } from '../api/teams.js';

const TeamContext = createContext(null);

export function TeamProvider({ children }) {
  const auth = useAuth();
  const authRef = useRef(auth);
  authRef.current = auth;
  const generation = useRef(0);
  const [state, setState] = useState({ team: undefined, profile: null, loading: true, error: null });

  const refresh = useCallback(async ({ refreshProfile = false } = {}) => {
    const requestId = ++generation.current;
    setState((state) => ({ ...state, loading: true, error: null }));
    try {
      const snapshot = await fetchTeamState(apiRequest);
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
    if (auth.user) void refresh().catch(() => {});
    else setState({ team: undefined, profile: null, loading: false, error: null });
    return () => { generation.current += 1; };
  }, [auth.user?.email, refresh]);

  return <TeamContext.Provider value={{ ...state, profile: state.profile ?? auth.profile, refresh }}>
    {children}
  </TeamContext.Provider>;
}

export function useTeam() {
  return useContext(TeamContext);
}
