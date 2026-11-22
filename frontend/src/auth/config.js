import { missingAuthVariables } from './logic.js';

// Pure configuration check (no aws-amplify import), so signed-out pages never pay for the amplify chunk.
const missing = missingAuthVariables(import.meta.env);
const missingError = missing.length
  ? `Authentication is not configured. Set ${missing.join(', ')} in the repo-root .env and restart Vite.`
  : null;
const regionMismatch = !missingError && !import.meta.env.VITE_COGNITO_USER_POOL_ID.startsWith(`${import.meta.env.VITE_COGNITO_REGION}_`);
export const configurationError = missingError || (regionMismatch
  ? 'Authentication configuration is invalid: VITE_COGNITO_REGION must match the region in VITE_COGNITO_USER_POOL_ID. Update the repo-root .env and restart Vite.' : null);
