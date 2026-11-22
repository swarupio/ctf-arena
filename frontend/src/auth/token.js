import { configurationError } from './config.js';
import { hasStoredSession, loadAuth } from './session.js';

export async function getToken() {
  if (configurationError) throw new Error(configurationError);
  if (!hasStoredSession()) return null; // signed out: nothing to send, and amplify stays unloaded
  const { fetchAuthSession } = await loadAuth();
  const { tokens } = await fetchAuthSession();
  return tokens?.idToken?.toString() ?? null;
}
