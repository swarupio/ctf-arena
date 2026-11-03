import { fetchAuthSession } from 'aws-amplify/auth';
import { configurationError } from './amplify.js';

export async function getToken() {
  if (configurationError) throw new Error(configurationError);
  const { tokens } = await fetchAuthSession();
  return tokens?.idToken?.toString() ?? null;
}
