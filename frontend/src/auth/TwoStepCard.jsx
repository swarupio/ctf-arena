import { useCallback, useEffect, useState } from 'react';
import ConfirmDialog from '../components/admin/ConfirmDialog.jsx';
import '../components/admin/admin.css';
import { useAuth } from './AuthContext.jsx';
import TotpSetupPanel from './TotpSetupPanel.jsx';
import { authMessage, totpEnabled } from './logic.js';
import './TwoStepCard.css';

// Opt-in "Two-step sign-in" (authenticator app / TOTP) for the signed-in user. Players may turn it off again; admins may not.
// `onStatus(enabled)` reports the current preference to a parent (the admin gate).
export default function TwoStepCard({ onStatus }) {
  const auth = useAuth();
  const admin = auth.user?.role === 'admin';
  const [status, setStatus] = useState('loading'); // loading | on | off | error
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [confirmOff, setConfirmOff] = useState(false);

  const load = useCallback(async () => {
    setStatus('loading');
    setError('');
    try {
      const enabled = totpEnabled(await auth.fetchMfaPreference());
      setStatus(enabled ? 'on' : 'off');
      onStatus?.(enabled);
    } catch (cause) {
      setError(authMessage(cause));
      setStatus('error');
    }
  }, [auth, onStatus]);
  useEffect(() => { void load(); }, [load]);

  async function run(task) {
    setBusy(true);
    setError('');
    try { await task(); } catch (cause) { setError(authMessage(cause)); } finally { setBusy(false); }
  }

  const begin = () => run(async () => { setNote(''); setSetup(await auth.startTotpEnrolment()); });
  const verify = (event) => {
    event.preventDefault();
    if (busy) return;
    void run(async () => {
      await auth.finishTotpEnrolment(code.trim());
      setSetup(null);
      setCode('');
      setStatus('on');
      setNote('Two-step sign-in is on. You will be asked for a code each time you log in.');
      onStatus?.(true);
    });
  };
  const turnOff = () => run(async () => {
    await auth.turnOffTotp();
    setConfirmOff(false);
    setStatus('off');
    setNote('Two-step sign-in is off. You can turn it on again at any time.');
    onStatus?.(false);
  });

  const needsFreshSignIn = admin && auth.user?.mfa === false;
  return <section className="pf-card ts-card" aria-labelledby="ts-title">
    <h2 id="ts-title">Two-step sign-in</h2>
    <p className="ts-status" role="status">
      {status === 'loading' && 'Checking your settings…'}
      {status === 'on' && <><span className="tag ts-on">On</span> A code from your authenticator app is needed when you log in.</>}
      {status === 'off' && <><span className="tag ts-off">Off</span> {admin ? 'Admin accounts must use an authenticator app.' : 'Optional. Add an authenticator app for extra protection.'}</>}
      {status === 'error' && 'We could not read your two-step setting.'}
    </p>
    {error && !confirmOff && <p role="alert" className="error">{error}</p>}
    {note && <p role="status" className="fx-note">{note}</p>}
    {needsFreshSignIn && status !== 'loading' && <p role="status" className="fx-note">
      Your current session was started without a code. {status === 'on' ? 'Log out and log in again with your code to use the admin area.' : 'Turn on two-step sign-in, then log out and log in again to use the admin area.'}
    </p>}
    {setup && <>
      <TotpSetupPanel setup={setup} email={auth.email || auth.user?.email} />
      <form onSubmit={verify} className="ts-form">
        <label>Six-digit authenticator code
          <input name="code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={(event) => setCode(event.target.value)} />
        </label>
        <div className="ts-actions">
          <button type="submit" disabled={busy}>{busy ? 'Please wait…' : 'Verify and turn on'}</button>
          <button type="button" className="secondary" disabled={busy} onClick={() => { setSetup(null); setCode(''); setError(''); }}>Cancel</button>
        </div>
      </form>
    </>}
    <div className="ts-actions">
      {status === 'off' && !setup && <button type="button" disabled={busy} onClick={begin}>{busy ? 'Please wait…' : 'Turn on two-step sign-in'}</button>}
      {status === 'on' && !admin && <button type="button" className="secondary" disabled={busy} onClick={() => setConfirmOff(true)}>Turn off</button>}
      {status === 'error' && <button type="button" className="secondary" onClick={load}>Try again</button>}
      {needsFreshSignIn && <button type="button" className="secondary" onClick={() => auth.signOut()}>Log out</button>}
    </div>
    <ConfirmDialog open={confirmOff} danger title="Turn off two-step sign-in?" confirmLabel="Turn off" cancelLabel="Keep it on"
      pending={busy} error={error} onConfirm={turnOff} onCancel={() => { setConfirmOff(false); setError(''); }}>
      <p>Your account will be protected by your password alone. You can turn two-step sign-in back on later from this page.</p>
    </ConfirmDialog>
  </section>;
}
