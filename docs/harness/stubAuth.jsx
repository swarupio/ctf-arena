const q = new URLSearchParams(location.search).get('as');
if (q) sessionStorage.setItem('as', q);
const as = sessionStorage.getItem('as') || 'player';
const users = {
  player: { email: 'player.with.a.rather.long.email.address@example-university.edu', role: 'player' },
  admin: { email: 'admin@arena.test', role: 'admin' },
  owner: { email: 'patilswarup110@gmail.com', role: 'admin' }, // a realistic 24 character address for header width checks
};
const step = as === 'mfa-setup' ? { signInStep: 'CONTINUE_SIGN_IN_WITH_TOTP_SETUP', totpSetupDetails: { sharedSecret: 'JBSWY3DPEHPK3PXP', getSetupUri: () => new URL('otpauth://totp/CTF%20Arena:me?secret=JBSWY3DPEHPK3PXP') } }
  : as === 'mfa' ? { signInStep: 'CONFIRM_SIGN_IN_WITH_TOTP_CODE' } : null;
const value = { loading: false, user: users[as] ?? null, step, email: 'me@example.com', configurationError: '', profile: null, profileError: '', retryProfile() {},
  signUp: async () => ({}), confirmSignUp: async () => ({}), resendCode: async () => ({}), signIn: async () => ({}), confirmTotpSetup: async () => ({}), confirmTotpCode: async () => ({}), signOut: async () => {} };
export const useAuth = () => value;
export const AuthProvider = ({ children }) => children;
