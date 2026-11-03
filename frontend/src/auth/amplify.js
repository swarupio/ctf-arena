import { Amplify } from 'aws-amplify';
import { missingAuthVariables } from './logic.js';

const missing = missingAuthVariables(import.meta.env);
const missingError = missing.length
  ? `Authentication is not configured. Set ${missing.join(', ')} in the repo-root .env and restart Vite.`
  : null;
const regionMismatch = !missingError && !import.meta.env.VITE_COGNITO_USER_POOL_ID.startsWith(`${import.meta.env.VITE_COGNITO_REGION}_`);
export const configurationError = missingError || (regionMismatch
  ? 'Authentication configuration is invalid: VITE_COGNITO_REGION must match the region in VITE_COGNITO_USER_POOL_ID. Update the repo-root .env and restart Vite.' : null);

if (!configurationError) {
  // Amplify v6 derives the Cognito region from the user-pool ID.
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID,
        userPoolClientId: import.meta.env.VITE_COGNITO_CLIENT_ID,
        loginWith: { email: true },
        mfa: { status: 'required', totpEnabled: true, smsEnabled: false },
      },
    },
  });
}
