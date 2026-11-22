import { lazy, Suspense } from 'react';
import { Link, Navigate, Route, Routes } from 'react-router-dom';
import Layout from './layout/Layout.jsx';
import ProtectedRoute from './auth/ProtectedRoute.jsx';
import PageFallback from './components/PageFallback.jsx';
import { RouteErrorBoundary } from './components/ErrorBoundary.jsx';
import DocumentTitle from './components/DocumentTitle.jsx';

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
// `title` becomes the tab title ("<title> · CTF Arena") as soon as the route matches, before the chunk has loaded.
const lazyPage = (element, title) => <RouteErrorBoundary><DocumentTitle title={title} /><Suspense fallback={<PageFallback />}>{element}</Suspense></RouteErrorBoundary>;
const AUTH_TITLES = { signup: 'Sign up', confirm: 'Confirm your email', login: 'Log in', 'mfa-setup': 'Set up authenticator', mfa: 'Authenticator code', forgot: 'Reset your password' };

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
  return <section className="placeholder not-found"><DocumentTitle title="Page not found" /><h1>Page not found</h1><p>That page does not exist.</p><div className="not-found-actions"><Link className="button" to="/">Back to home</Link><Link className="button secondary" to="/challenges">Browse challenges</Link></div></section>;
}

export default function App() {
  return <Suspense fallback={<PageFallback />}><Routes>
    <Route element={<Layout />}>
      <Route index element={lazyPage(<Home />, 'Home')} />
      {['signup', 'confirm', 'login', 'mfa-setup', 'mfa', 'forgot'].map((mode) => (
        <Route key={mode} path={mode} element={lazyPage(<AuthPage key={mode} mode={mode} />, AUTH_TITLES[mode])} />
      ))}
      <Route path="demo" element={lazyPage(<Demo />, 'Demo')} />
      <Route path="fair-play" element={lazyPage(<FairPlay />, 'Fair play')} />
      <Route path="skills" element={lazyPage(<Skills />, 'Skills')} />
      <Route path="games/*" element={<Navigate to="/range" replace />} />
      <Route element={<ProtectedRoute />}>
        <Route path="challenges" element={lazyPage(<ChallengeList />, 'Challenges')} />
        <Route path="challenges/:id" element={lazyPage(<ChallengeDetail />, 'Challenge')} />
        <Route path="range" element={lazyPage(<Games />, 'The Range')} />
        <Route path="terminal" element={lazyPage(<Terminal />, 'Arena Terminal')} />
        <Route path="terminal/:mode" element={lazyPage(<TerminalPlay />, 'Terminal')} />
        <Route path="cipherlab/*" element={lazyPage(<CipherLab />, 'Cipher Lab')} />
        <Route path="weblab" element={lazyPage(<WebLab />, 'Web Exploit Lab')} />
        <Route path="weblab/:slug" element={lazyPage(<WebLabPlay />, 'Web lab')} />
        <Route path="forensics" element={lazyPage(<ForensicsDesk />, 'Forensics Desk')} />
        <Route path="forensics/:track" element={lazyPage(<ForensicsCase />, 'Forensics case')} />
        <Route path="reversing" element={lazyPage(<CrackmeArcade />, 'Crackme Arcade')} />
        <Route path="reversing/:levelId" element={lazyPage(<CrackmeLevel />, 'Crackme level')} />
        <Route path="osint" element={lazyPage(<OsintTrail />, 'OSINT Trail')} />
        <Route path="osint/:track" element={lazyPage(<OsintCase />, 'OSINT case')} />
        <Route path="leaderboard" element={lazyPage(<Leaderboard />, 'Leaderboard')} />
        <Route path="team" element={lazyPage(<Team />, 'Team')} />
        <Route path="profile" element={lazyPage(<Profile />, 'Profile')} />
        <Route path="profile/:id" element={lazyPage(<Profile />, 'Profile')} />
      </Route>
      <Route element={<ProtectedRoute admin />}>
        <Route path="admin" element={lazyPage(<AdminLayout />, 'Admin')}>
          <Route index element={lazyPage(<AdminOverview />, 'Admin overview')} />
          <Route path="users" element={lazyPage(<AdminUsers />, 'Admin users')} />
          <Route path="teams" element={lazyPage(<AdminTeams />, 'Admin teams')} />
          <Route path="challenges" element={lazyPage(<AdminChallenges />, 'Admin challenges')} />
          <Route path="activity" element={lazyPage(<AdminActivity />, 'Admin activity')} />
          <Route path="integrity" element={lazyPage(<AdminIntegrity />, 'Admin integrity')} />
          <Route path="instances" element={lazyPage(<AdminInstances />, 'Admin instances')} />
          <Route path="audit" element={lazyPage(<AdminAudit />, 'Admin audit log')} />
          <Route path="settings" element={lazyPage(<AdminSettings />, 'Admin settings')} />
          <Route path="exports" element={lazyPage(<AdminExports />, 'Admin exports')} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Route>
      </Route>
      <Route path="*" element={<NotFound />} />
    </Route>
  </Routes></Suspense>;
}
