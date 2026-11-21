import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import Layout from './layout/Layout.jsx';
import ProtectedRoute from './auth/ProtectedRoute.jsx';

// Every page is its own chunk, loaded when its route is first visited.
const AuthPage = lazy(() => import('./pages/AuthPages.jsx'));
const Home = lazy(() => import('./pages/Home.jsx'));
const Team = lazy(() => import('./pages/Team.jsx'));
const ChallengeList = lazy(() => import('./pages/ChallengeList.jsx'));
const ChallengeDetail = lazy(() => import('./pages/ChallengeDetail.jsx'));
const ChallengeAdmin = lazy(() => import('./pages/ChallengeAdmin.jsx'));
const Terminal = lazy(() => import('./pages/Terminal.jsx'));
const TerminalPlay = lazy(() => import('./pages/TerminalPlay.jsx'));
const Leaderboard = lazy(() => import('./pages/Leaderboard.jsx'));
const AdminDashboard = lazy(() => import('./pages/AdminDashboard.jsx'));
const Demo = lazy(() => import('./pages/Demo.jsx'));
const FairPlay = lazy(() => import('./pages/FairPlay.jsx'));

const Profile = lazy(() => import('./pages/Profile.jsx'));

const CipherLab = lazy(() => import('./pages/CipherLab.jsx'));

const Games = lazy(() => import('./pages/Games.jsx'));
const WebLab = lazy(() => import('./pages/WebLab.jsx'));
const WebLabPlay = lazy(() => import('./pages/WebLabPlay.jsx'));
const lazyPage = (element) => <Suspense fallback={<p role="status">Loading...</p>}>{element}</Suspense>;

// Forensics Desk is lazy-loaded: its viewers and helpers only download when a player opens the game.
const ForensicsDesk = lazy(() => import('./pages/ForensicsDesk.jsx'));
const ForensicsCase = lazy(() => import('./pages/ForensicsCase.jsx'));

function Placeholder({ title }) {
  return <section className="placeholder"><h1>{title}</h1><p>This part of the arena is coming soon.</p></section>;
}

export default function App() {
  return <Suspense fallback={<p role="status">Loading…</p>}><Routes>
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
        <Route path="games" element={lazyPage(<Games />)} />
        <Route path="terminal" element={<Terminal />} />
        <Route path="terminal/:mode" element={<TerminalPlay />} />
        <Route path="cipherlab/*" element={<Suspense fallback={<p role="status">Loading…</p>}><CipherLab /></Suspense>} />
        <Route path="weblab" element={lazyPage(<WebLab />)} />
        <Route path="weblab/:slug" element={lazyPage(<WebLabPlay />)} />
        <Route path="forensics" element={lazyPage(<ForensicsDesk />)} />
        <Route path="forensics/:track" element={lazyPage(<ForensicsCase />)} />
        <Route path="leaderboard" element={<Leaderboard />} />
        <Route path="team" element={<Team />} />
        <Route path="profile" element={<Suspense fallback={<p role="status">Loading…</p>}><Profile /></Suspense>} />
        <Route path="profile/:id" element={<Suspense fallback={<p role="status">Loading…</p>}><Profile /></Suspense>} />
      </Route>
      <Route element={<ProtectedRoute admin />}>
        <Route path="admin" element={<AdminDashboard />} />
        <Route path="admin/challenges" element={<ChallengeAdmin />} />
      </Route>
      <Route path="*" element={<Placeholder title="Page not found" />} />
    </Route>
  </Routes></Suspense>;
}
