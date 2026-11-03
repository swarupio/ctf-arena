import { createContext, useContext, useEffect, useState } from 'react';
import * as auth from 'aws-amplify/auth';
import { Hub } from 'aws-amplify/utils';
import { configurationError } from './amplify.js';
import { userFromSession } from './logic.js';
import { apiRequest } from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [loading, setLoading] = useState(true);
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
      apiRequest('/me').then((data) => {
        if (active) setProfile(data);
      }).catch(() => {
        if (active) setProfileError('Unable to verify your account with the arena API. Check that the backend is running and accepts your ID token.');
      });
    }
    return () => { active = false; };
  }, [user, profileAttempt]);

  useEffect(() => {
    let active = true;
    const restore = async () => {
      try {
        const session = configurationError ? null : await auth.fetchAuthSession();
        if (active) setUser(userFromSession(session));
      } catch {
        if (active) setUser(null);
      } finally {
        if (active) setLoading(false);
      }
    };
    void restore();
    const unsubscribe = Hub.listen('auth', ({ payload }) => {
      if (payload.event === 'signedOut' || payload.event === 'tokenRefresh_failure') {
        setUser(null);
        setStep(null);
        setEmail('');
      } else if (payload.event === 'tokenRefresh') {
        void restore();
      }
    });
    return () => { active = false; unsubscribe(); };
  }, []);

  const acceptSignIn = async (result) => {
    if (result.isSignedIn) {
      const nextUser = userFromSession(await auth.fetchAuthSession());
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
  };

  const confirmTotp = async (code) => {
    if (!/^\d{6}$/.test(code)) throw Object.assign(new Error(), { name: 'CodeMismatchException' });
    return acceptSignIn(await auth.confirmSignIn({ challengeResponse: code }));
  };

  const value = {
    loading, user, step, email, configurationError, profile, profileError,
    retryProfile() { setProfileAttempt((attempt) => attempt + 1); },
    async signUp(email, password) {
      const username = email.trim();
      const result = await auth.signUp({ username, password, options: { userAttributes: { email: username } } });
      setEmail(username);
      return result;
    },
    async confirmSignUp(email, code) {
      return auth.confirmSignUp({ username: email.trim(), confirmationCode: code.trim() });
    },
    async resendCode(email) {
      return auth.resendSignUpCode({ username: email.trim() });
    },
    async signIn(email, password) {
      const username = email.trim();
      setEmail(username);
      setStep(null);
      try {
        return await acceptSignIn(await auth.signIn({ username, password, options: { authFlowType: 'USER_SRP_AUTH' } }));
      } catch (error) {
        if (error.name === 'UserNotConfirmedException') setStep({ signInStep: 'CONFIRM_SIGN_UP' });
        throw error;
      }
    },
    confirmTotpSetup: confirmTotp,
    confirmTotpCode: confirmTotp,
    async signOut() {
      await auth.signOut();
      setUser(null);
      setStep(null);
      setEmail('');
    },
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
