import { Route, Routes } from 'react-router-dom';
import Layout from './layout/Layout.jsx';
import ProtectedRoute from './auth/ProtectedRoute.jsx';
import AuthPage from './pages/AuthPages.jsx';
import Home from './pages/Home.jsx';
import Team from './pages/Team.jsx';

function Placeholder({ title }) {
  return <section><h1>{title}</h1><p>This part of the arena is coming soon.</p></section>;
}

export default function App() {
  return <Routes>
    <Route element={<Layout />}>
      <Route index element={<Home />} />
      {['signup', 'confirm', 'login', 'mfa-setup', 'mfa'].map((mode) => <Route key={mode} path={mode} element={<AuthPage key={mode} mode={mode} />} />)}
      <Route element={<ProtectedRoute />}>
        <Route path="challenges" element={<Placeholder title="Challenges" />} />
        <Route path="leaderboard" element={<Placeholder title="Leaderboard" />} />
        <Route path="team" element={<Team />} />
      </Route>
      <Route element={<ProtectedRoute admin />}>
        <Route path="admin" element={<Placeholder title="Admin" />} />
      </Route>
      <Route path="*" element={<Placeholder title="Page not found" />} />
    </Route>
  </Routes>;
}
