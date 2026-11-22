import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { configurationError } from './config.js';
import { mayHaveSession, loadAuth } from './session.js';
import { userFromSession } from './logic.js';
import { apiGet } from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  // Nothing stored means signed out: no wait, and the amplify chunk is not downloaded (see session.js).
  const [loading, setLoading] = useState(() => !configurationError && mayHaveSession());
  const [amplifyReady, setAmplifyReady] = useState(false);
  const [user, setUser] = useState(null);
  const [step, setStep] = useState(null);
  const [email, setEmail] = useState('');
  const [profile, setProfile] = useState(null);
  const [profileError, setProfileError] = useState('');
  const [profileAttempt, setProfileAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setProfile(null);
    setProfileError('');
    if (user) {
      apiGet('/me', { ttl: profileAttempt ? 0 : 5_000 }).then((data) => {
        if (active) setProfile(data);
      }).catch(() => {
        if (active) setProfileError('Unable to verify your account with the arena API. Check that the backend is running and accepts your ID token.');
      });
    }
    return () => { active = false; };
  }, [user, profileAttempt]);

  // Loads amplify on first use (shared download) and starts the auth-event listener below.
  const getAuth = useCallback(async () => {
    const auth = await loadAuth();
    setAmplifyReady(true);
    return auth;
  }, []);

  const restore = useCallback(async (isActive = () => true) => {
    try {
      const session = configurationError || !mayHaveSession() ? null : await (await getAuth()).fetchAuthSession();
      if (isActive()) setUser(userFromSession(session));
    } catch {
      if (isActive()) setUser(null);
    } finally {
      if (isActive()) setLoading(false);
    }
  }, [getAuth]);

  useEffect(() => {
    let active = true;
    void restore(() => active);
    return () => { active = false; };
  }, [restore]);

  useEffect(() => {
    if (!amplifyReady) return undefined;
    let unsubscribe = () => {};
    let stopped = false;
    void loadAuth().then(({ Hub }) => {
      if (stopped) return;
      unsubscribe = Hub.listen('auth', ({ payload }) => {
        if (payload.event === 'signedOut' || payload.event === 'tokenRefresh_failure') {
          setUser(null);
          setStep(null);
          setEmail('');
        } else if (payload.event === 'tokenRefresh') {
          void restore();
        }
      });
    });
    return () => { stopped = true; unsubscribe(); };
  }, [amplifyReady, restore]);

  const acceptSignIn = useCallback(async (result) => {
    if (result.isSignedIn) {
      const nextUser = userFromSession(await (await getAuth()).fetchAuthSession());
      if (!nextUser) throw new Error('Missing ID token');
      setUser(nextUser);
      setStep(null);
      setEmail('');
    } else {
      const next = result.nextStep;
      const supported = ['CONTINUE_SIGN_IN_WITH_TOTP_SETUP', 'CONFIRM_SIGN_IN_WITH_TOTP_CODE', 'CONFIRM_SIGN_UP'];
      setStep(supported.includes(next?.signInStep) ? next : null);
      if (!supported.includes(next?.signInStep)) {
        throw Object.assign(new Error(), { name: 'UnexpectedSignInStep' });
      }
    }
    return result;
  }, [getAuth]);

  const confirmTotp = useCallback(async (code) => {
    if (!/^\d{6}$/.test(code)) throw Object.assign(new Error(), { name: 'CodeMismatchException' });
    return acceptSignIn(await (await getAuth()).confirmSignIn({ challengeResponse: code }));
  }, [acceptSignIn, getAuth]);

  // Sign-in pages call this so the first submit does not wait for the amplify download.
  const preload = useCallback(() => { void loadAuth().catch(() => {}); }, []);

  const value = useMemo(() => ({
    loading, user, step, email, configurationError, profile, profileError,
    preload,
    retryProfile() { setProfileAttempt((attempt) => attempt + 1); },
    async signUp(email, password) {
      const username = email.trim();
      const result = await (await getAuth()).signUp({ username, password, options: { userAttributes: { email: username } } });
      setEmail(username);
      return result;
    },
    async confirmSignUp(email, code) {
      return (await getAuth()).confirmSignUp({ username: email.trim(), confirmationCode: code.trim() });
    },
    async resendCode(email) {
      return (await getAuth()).resendSignUpCode({ username: email.trim() });
    },
    async signIn(email, password) {
      const username = email.trim();
      setEmail(username);
      setStep(null);
      try {
        return await acceptSignIn(await (await getAuth()).signIn({ username, password, options: { authFlowType: 'USER_SRP_AUTH' } }));
      } catch (error) {
        if (error.name === 'UserNotConfirmedException') setStep({ signInStep: 'CONFIRM_SIGN_UP' });
        throw error;
      }
    },
    confirmTotpSetup: confirmTotp,
    confirmTotpCode: confirmTotp,
    async resetPassword(email) {
      return (await getAuth()).resetPassword({ username: email });
    },
    async confirmResetPassword(email, code, newPassword) {
      return (await getAuth()).confirmResetPassword({ username: email, confirmationCode: code, newPassword });
    },
    async signOut() {
      await (await getAuth()).signOut();
      setUser(null);
      setStep(null);
      setEmail('');
    },
  }), [loading, user, step, email, profile, profileError, acceptSignIn, confirmTotp, getAuth, preload]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
