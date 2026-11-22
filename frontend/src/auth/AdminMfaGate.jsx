import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { useAuth } from './AuthContext.jsx';
import TwoStepCard from './TwoStepCard.jsx';
import '../pages/Profile.css';

// Admin pages need two-step sign-in. This is a front-end convenience, not the security control: the backend rejects an
// admin token that provably lacks MFA (the `amr` claim, see docs/SECURITY.md). A token without that claim cannot be judged
// here either, so the gate then asks Cognito whether this user has an authenticator app turned on.
export default function AdminMfaGate() {
  const { user } = useAuth();
  const [enabled, setEnabled] = useState(false);
  if (user?.mfa !== false && enabled) return <Outlet />;
  return <section className="ts-gate">
    <h1>Two-step sign-in required</h1>
    <p>Admin accounts must use an authenticator app. Set it up here to continue.</p>
    <TwoStepCard onStatus={setEnabled} />
  </section>;
}
