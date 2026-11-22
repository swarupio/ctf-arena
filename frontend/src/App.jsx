import { lazy, Suspense } from 'react';
import { Link, Navigate, Route, Routes } from 'react-router-dom';
import Layout from './layout/Layout.jsx';
import ProtectedRoute from './auth/ProtectedRoute.jsx';
import PageFallback from './components/PageFallback.jsx';
import { RouteErrorBoundary } from './components/ErrorBoundary.jsx';

// Every page is its own chunk, loaded when its route is first visited.
const AuthPage = lazy(() => import('./pages/AuthPages.jsx'));
const Home = lazy(() => import('./pages/Home.jsx'));
const Team = lazy(() => import('./pages/Team.jsx'));
const ChallengeList = lazy(() => import('./pages/ChallengeList.jsx'));
const ChallengeDetail = lazy(() => import('./pages/ChallengeDetail.jsx'));
const Terminal = lazy(() => import('./pages/Terminal.jsx'));
const TerminalPlay = lazy(() => import('./pages/TerminalPlay.jsx'));
const Leaderboard = lazy(() => import('./pages/Leaderboard.jsx'));
const Demo = lazy(() => import('./pages/Demo.jsx'));
const FairPlay = lazy(() => import('./pages/FairPlay.jsx'));
const Skills = lazy(() => import('./pages/Skills.jsx'));

const Profile = lazy(() => import('./pages/Profile.jsx'));

const CipherLab = lazy(() => import('./pages/CipherLab.jsx'));

const Games = lazy(() => import('./pages/Games.jsx'));
const WebLab = lazy(() => import('./pages/WebLab.jsx'));
const WebLabPlay = lazy(() => import('./pages/WebLabPlay.jsx'));
// One boundary per page (an error boundary too, reset on route change, so one bad field cannot blank the app): the layout (header, nav) stays mounted while a page chunk loads, and a fast load never flashes the fallback.
const lazyPage = (element) => <RouteErrorBoundary><Suspense fallback={<PageFallback />}>{element}</Suspense></RouteErrorBoundary>;

// Forensics Desk is lazy-loaded: its viewers and helpers only download when a player opens the desk.
const ForensicsDesk = lazy(() => import('./pages/ForensicsDesk.jsx'));
const ForensicsCase = lazy(() => import('./pages/ForensicsCase.jsx'));
// The admin area: a layout chunk plus one chunk per section, none of it in the entry bundle.
const AdminLayout = lazy(() => import('./pages/admin/AdminLayout.jsx'));
const AdminOverview = lazy(() => import('./pages/admin/Overview.jsx'));
const AdminUsers = lazy(() => import('./pages/admin/Users.jsx'));
const AdminTeams = lazy(() => import('./pages/admin/Teams.jsx'));
const AdminChallenges = lazy(() => import('./pages/admin/Challenges.jsx'));
const AdminActivity = lazy(() => import('./pages/admin/Activity.jsx'));
const AdminIntegrity = lazy(() => import('./pages/admin/Integrity.jsx'));
const AdminInstances = lazy(() => import('./pages/admin/Instances.jsx'));
const AdminAudit = lazy(() => import('./pages/admin/Audit.jsx'));
const AdminSettings = lazy(() => import('./pages/admin/Settings.jsx'));
const AdminExports = lazy(() => import('./pages/admin/Exports.jsx'));

// Crackme Arcade (reverse engineering) is lazy-loaded too; its VM and debugger only download when a player opens it.
const CrackmeArcade = lazy(() => import('./pages/CrackmeArcade.jsx'));
const CrackmeLevel = lazy(() => import('./pages/CrackmeLevel.jsx'));

// OSINT Trail: lazy-loaded like the other range categories.
const OsintTrail = lazy(() => import('./pages/OsintTrail.jsx'));
const OsintCase = lazy(() => import('./pages/OsintCase.jsx'));

function NotFound() {
  return <section className="placeholder"><h1>Page not found</h1><p>That page does not exist.</p><Link className="button" to="/">Back to home</Link></section>;
}

export default function App() {
  return <Suspense fallback={<PageFallback />}><Routes>
    <Route element={<Layout />}>
      <Route index element={lazyPage(<Home />)} />
      {['signup', 'confirm', 'login', 'mfa-setup', 'mfa', 'forgot'].map((mode) => (
        <Route key={mode} path={mode} element={lazyPage(<AuthPage key={mode} mode={mode} />)} />
      ))}
      <Route path="demo" element={lazyPage(<Demo />)} />
      <Route path="fair-play" element={lazyPage(<FairPlay />)} />
      <Route path="skills" element={lazyPage(<Skills />)} />
      <Route path="games/*" element={<Navigate to="/range" replace />} />
      <Route element={<ProtectedRoute />}>
        <Route path="challenges" element={lazyPage(<ChallengeList />)} />
        <Route path="challenges/:id" element={lazyPage(<ChallengeDetail />)} />
        <Route path="range" element={lazyPage(<Games />)} />
        <Route path="terminal" element={lazyPage(<Terminal />)} />
        <Route path="terminal/:mode" element={lazyPage(<TerminalPlay />)} />
        <Route path="cipherlab/*" element={lazyPage(<CipherLab />)} />
        <Route path="weblab" element={lazyPage(<WebLab />)} />
        <Route path="weblab/:slug" element={lazyPage(<WebLabPlay />)} />
        <Route path="forensics" element={lazyPage(<ForensicsDesk />)} />
        <Route path="forensics/:track" element={lazyPage(<ForensicsCase />)} />
        <Route path="reversing" element={lazyPage(<CrackmeArcade />)} />
        <Route path="reversing/:levelId" element={lazyPage(<CrackmeLevel />)} />
        <Route path="osint" element={lazyPage(<OsintTrail />)} />
        <Route path="osint/:track" element={lazyPage(<OsintCase />)} />
        <Route path="leaderboard" element={lazyPage(<Leaderboard />)} />
        <Route path="team" element={lazyPage(<Team />)} />
        <Route path="profile" element={lazyPage(<Profile />)} />
        <Route path="profile/:id" element={lazyPage(<Profile />)} />
      </Route>
      <Route element={<ProtectedRoute admin />}>
        <Route path="admin" element={lazyPage(<AdminLayout />)}>
          <Route index element={lazyPage(<AdminOverview />)} />
          <Route path="users" element={lazyPage(<AdminUsers />)} />
          <Route path="teams" element={lazyPage(<AdminTeams />)} />
          <Route path="challenges" element={lazyPage(<AdminChallenges />)} />
          <Route path="activity" element={lazyPage(<AdminActivity />)} />
          <Route path="integrity" element={lazyPage(<AdminIntegrity />)} />
          <Route path="instances" element={lazyPage(<AdminInstances />)} />
          <Route path="audit" element={lazyPage(<AdminAudit />)} />
          <Route path="settings" element={lazyPage(<AdminSettings />)} />
          <Route path="exports" element={lazyPage(<AdminExports />)} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Route>
      </Route>
      <Route path="*" element={<NotFound />} />
    </Route>
  </Routes></Suspense>;
}
