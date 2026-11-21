import { Suspense, lazy } from 'react';
import { Route, Routes } from 'react-router-dom';
import Layout from './layout/Layout.jsx';
import ProtectedRoute from './auth/ProtectedRoute.jsx';
import AuthPage from './pages/AuthPages.jsx';
import Home from './pages/Home.jsx';
import Team from './pages/Team.jsx';
import ChallengeList from './pages/ChallengeList.jsx';
import ChallengeDetail from './pages/ChallengeDetail.jsx';
import ChallengeAdmin from './pages/ChallengeAdmin.jsx';
import Terminal from './pages/Terminal.jsx';
import TerminalPlay from './pages/TerminalPlay.jsx';
import Leaderboard from './pages/Leaderboard.jsx';
import AdminDashboard from './pages/AdminDashboard.jsx';
import Demo from './pages/Demo.jsx';
import FairPlay from './pages/FairPlay.jsx';

// Forensics Desk is lazy-loaded: its viewers and helpers only download when a player opens the game.
const ForensicsDesk = lazy(() => import('./pages/ForensicsDesk.jsx'));
const ForensicsCase = lazy(() => import('./pages/ForensicsCase.jsx'));
const lazyPage = (element) => <Suspense fallback={<p role="status">Loading...</p>}>{element}</Suspense>;

function Placeholder({ title }) {
  return <section className="placeholder"><h1>{title}</h1><p>This part of the arena is coming soon.</p></section>;
}

export default function App() {
  return <Routes>
    <Route element={<Layout />}>
      <Route index element={<Home />} />
      {['signup', 'confirm', 'login', 'mfa-setup', 'mfa'].map((mode) => (
        <Route key={mode} path={mode} element={<AuthPage key={mode} mode={mode} />} />
      ))}
      <Route path="demo" element={<Demo />} />
      <Route path="fair-play" element={<FairPlay />} />
      <Route element={<ProtectedRoute />}>
        <Route path="challenges" element={<ChallengeList />} />
        <Route path="challenges/:id" element={<ChallengeDetail />} />
        <Route path="terminal" element={<Terminal />} />
        <Route path="terminal/:mode" element={<TerminalPlay />} />
        <Route path="forensics" element={lazyPage(<ForensicsDesk />)} />
        <Route path="forensics/:track" element={lazyPage(<ForensicsCase />)} />
        <Route path="leaderboard" element={<Leaderboard />} />
        <Route path="team" element={<Team />} />
      </Route>
      <Route element={<ProtectedRoute admin />}>
        <Route path="admin" element={<AdminDashboard />} />
        <Route path="admin/challenges" element={<ChallengeAdmin />} />
      </Route>
      <Route path="*" element={<Placeholder title="Page not found" />} />
    </Route>
  </Routes>;
}
