import { lazy, Suspense } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext.jsx';

// Loaded only for admins whose token does not already prove MFA (keeps the card and QR code out of the entry bundle).
const AdminMfaGate = lazy(() => import('./AdminMfaGate.jsx'));

export default function ProtectedRoute({ admin = false }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <p role="status">Restoring your session…</p>;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  if (admin && user.role !== 'admin') return <Navigate to="/" replace />;
  if (admin && user.mfa !== true) return <Suspense fallback={<p role="status">Checking your sign-in…</p>}><AdminMfaGate /></Suspense>;
  return <Outlet />;
}
