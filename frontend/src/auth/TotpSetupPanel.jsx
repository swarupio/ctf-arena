import { useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { copyStatusText, copyText } from './logic.js';

// QR code, setup key and copy button for an authenticator app. `setup` is the amplify totpSetupDetails object.
// Shared by the sign-in setup page and the profile "Two-step sign-in" card.
export default function TotpSetupPanel({ setup, email }) {
  const [copied, setCopied] = useState('');
  const keyRef = useRef(null);

  async function copyKey() {
    const result = await copyText(setup?.sharedSecret, navigator.clipboard);
    setCopied(result);
    if (result === 'failed' && keyRef.current) {
      const range = document.createRange();
      range.selectNodeContents(keyRef.current);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }

  return <div className="totp-setup">
    <ol className="auth-steps">
      <li>Install an authenticator app on your phone (Google Authenticator, Microsoft Authenticator, Authy or 1Password).</li>
      <li>Scan this QR code with the app.</li>
      <li>Type the 6-digit code the app shows into the box below.</li>
    </ol>
    <QRCodeSVG value={setup.getSetupUri('CTF Arena', email).toString()} size={208} marginSize={4} title="Scan to add CTF Arena to your authenticator" />
    <p>No camera or on this phone? Enter this key in your app (choose enter a setup key).</p>
    <p className="shared-secret" ref={keyRef}>{setup.sharedSecret}</p>
    <div className="copy-row">
      <button type="button" className="secondary" onClick={copyKey}>Copy key</button>
      <span className="copy-status" role="status" aria-live="polite">{copyStatusText(copied)}</span>
    </div>
  </div>;
}
