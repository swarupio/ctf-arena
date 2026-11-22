// The aws-amplify auth code (about 40 KB gzip) is loaded on demand. A visitor with no stored Cognito session is signed
// out by definition, so the first load skips it; it is fetched when a stored session has to be restored or when the
// person starts signing in. Amplify keeps its tokens in localStorage under `CognitoIdentityServiceProvider.<client id>.*`.
const PREFIX = 'CognitoIdentityServiceProvider.';

// Synchronous. Errs towards "yes": any Cognito key (even a leftover device key) loads amplify like before.
export function hasStoredSession() {
  try {
    for (let i = 0; i < window.localStorage.length; i += 1) {
      if (window.localStorage.key(i)?.startsWith(PREFIX)) return true;
    }
    return false;
  } catch {
    return true; // storage blocked: let amplify decide
  }
}

let pending = null;
// Resolves with the auth functions and Hub once amplify is configured. Memoised, so every caller shares one download.
export function loadAuth() {
  if (!pending) {
    pending = import('./amplifyAuth.js').catch((error) => { pending = null; throw error; });
  }
  return pending;
}
