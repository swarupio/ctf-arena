import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { useAuth } from '../auth/AuthContext.jsx';
import { authMessage, returnPath, signInPath } from '../auth/logic.js';

export default function AuthPage({ mode }) {
  const auth = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [email, setEmail] = useState(location.state?.email ?? auth.email);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState(location.state?.message ?? '');
  const from = location.state?.from;
  const mfa = mode === 'mfa' || mode === 'mfa-setup';
  const titles = { signup: 'Create your account', confirm: 'Confirm your email', login: 'Log in', 'mfa-setup': 'Set up authenticator', mfa: 'Authenticator code' };
  const descriptions = {
    signup: 'Join CTF Arena with your email and a password. An authenticator app is required to play.',
    confirm: 'Enter the verification code sent to your email.',
    login: 'Use your email and password, then verify with your authenticator app.',
    'mfa-setup': 'Scan this QR code with your authenticator app, then enter its first six-digit code.',
    mfa: 'Enter the latest six-digit code from your authenticator app.',
  };

  if (auth.loading) return <p role="status">Restoring your session…</p>;
  if (auth.user) return <Navigate to={returnPath(from)} replace />;
  if (mfa && signInPath(auth.step) !== `/${mode}`) {
    return <Navigate to={signInPath(auth.step)} replace state={{ from, message: 'Please log in to continue.' }} />;
  }
  const setup = mode === 'mfa-setup' ? auth.step?.totpSetupDetails : null;

  const moveAfterSignIn = (result) => {
    navigate(result.isSignedIn ? returnPath(from) : signInPath(result.nextStep), { replace: true, state: { from, email } });
  };

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (mode === 'signup') {
        const result = await auth.signUp(email, password);
        setPassword('');
        navigate(result.isSignUpComplete ? '/login' : '/confirm', { state: { from, email } });
      } else if (mode === 'confirm') {
        await auth.confirmSignUp(email, code);
        setCode('');
        navigate('/login', { replace: true, state: { from, email, message: 'Email confirmed. Log in to continue.' } });
      } else if (mode === 'login') {
        const result = await auth.signIn(email, password);
        setPassword('');
        moveAfterSignIn(result);
      } else {
        const result = await (mode === 'mfa-setup' ? auth.confirmTotpSetup(code) : auth.confirmTotpCode(code));
        setCode('');
        moveAfterSignIn(result);
      }
    } catch (error) {
      setError(authMessage(error));
      setCode('');
      if (error.name === 'UserNotConfirmedException') {
        setPassword('');
        navigate('/confirm', { state: { from, email, message: authMessage(error) } });
      }
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    if (!email.trim()) { setError('Enter your email before requesting a new code.'); return; }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await auth.resendCode(email);
      setMessage('A new confirmation code has been sent. Check your inbox and spam folder.');
    } catch (error) { setError(authMessage(error)); }
    finally { setBusy(false); }
  }

  return <section className="auth-panel">
    <h1>{titles[mode]}</h1>
    <p>{descriptions[mode]}</p>
    {error && <p role="alert" className="error">{error}</p>}
    {message && <p role="status" className="notice">{message}</p>}
    {setup && <div className="totp-setup">
      <QRCodeSVG value={setup.getSetupUri('CTF Arena', auth.email).toString()} size={208} marginSize={4} title="Scan to add CTF Arena to your authenticator" />
      <p>Can’t scan? Add a time-based account for {auth.email} with this setup key:</p>
      <p className="shared-secret">{setup.sharedSecret}</p>
    </div>}
    <form onSubmit={submit}>
      <fieldset disabled={busy || Boolean(auth.configurationError)}>
        {!mfa && <label>Email
          <input name="email" type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>}
        {(mode === 'signup' || mode === 'login') && <label>Password
          <input name="password" type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} required value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>}
        {(mode === 'confirm' || mfa) && <label>{mfa ? 'Six-digit authenticator code' : 'Email confirmation code'}
          <input name="code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern={mfa ? '[0-9]{6}' : '[0-9]+'} maxLength={mfa ? 6 : 12} required value={code} onChange={(event) => setCode(event.target.value)} />
        </label>}
        <button type="submit">{busy ? 'Please wait…' : ({ signup: 'Sign up', login: 'Log in', confirm: 'Confirm email', 'mfa-setup': 'Verify authenticator', mfa: 'Verify code' })[mode]}</button>
        {mode === 'confirm' && <button type="button" className="secondary" onClick={resend}>Resend email code</button>}
      </fieldset>
    </form>
    <div className="auth-links">
      {mode === 'login' && <><Link to="/signup" state={{ from }}>Create an account</Link><Link to="/confirm" state={{ from, email }}>Confirm your email</Link></>}
      {mode !== 'login' && <Link to="/login" state={{ from, email }}>Back to Login</Link>}
    </div>
  </section>;
}
