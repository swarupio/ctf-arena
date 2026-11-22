// The aws-amplify auth code (about 40 KB gzip) is loaded on demand. A visitor with no stored Cognito session is signed
// out by definition, so the first load skips it; it is fetched when a stored session has to be restored or when the
// person starts signing in. Amplify keeps its tokens in localStorage under `CognitoIdentityServiceProvider.<client id>.*`.
const PREFIX = 'CognitoIdentityServiceProvider.';

// Synchronous. Errs towards "yes": any Cognito key (even a leftover device key) loads amplify like before.
// `getStorage` is injectable for tests; the default reads window.localStorage.
export function hasStoredSession(getStorage = () => window.localStorage) {
  try {
    const storage = getStorage();
    for (let i = 0; i < storage.length; i += 1) {
      if (storage.key(i)?.startsWith(PREFIX)) return true;
    }
    return false;
  } catch {
    return true; // storage blocked: let amplify decide
  }
}

// A failed download (offline, or a chunk removed by a newer deploy) surfaces as a NetworkError, which the sign-in pages
// already show as "Unable to connect. Check your connection and try again." Nothing is cached, so the next call retries.
export function createAuthLoader(importer) {
  let pending = null;
  let loaded = false;
  return {
    load() {
      if (!pending) {
        const attempt = Promise.resolve().then(importer).then(
          (auth) => { loaded = true; return auth; },
          (cause) => {
            if (pending === attempt) pending = null;
            throw Object.assign(new Error('The sign-in library could not be loaded.', { cause }), { name: 'NetworkError' });
          },
        );
        pending = attempt;
      }
      return pending;
    },
    isLoaded: () => loaded,
  };
}

const loader = createAuthLoader(() => import('./amplifyAuth.js'));

// Resolves with the auth functions and Hub once amplify is configured. Memoised, so every caller shares one download.
export const loadAuth = loader.load;

// Once amplify is loaded in this page it owns the session (its storage may be in-memory when localStorage is unusable),
// so only a page that has not loaded it yet relies on the stored-key check.
export function mayHaveSession() {
  return loader.isLoaded() || hasStoredSession();
}
