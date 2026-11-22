import { Amplify } from 'aws-amplify';
import { configurationError } from './config.js';

export { configurationError };

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
