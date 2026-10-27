import { Route, Routes } from 'react-router-dom';
import Layout from './layout/Layout.jsx';
import Home from './pages/Home.jsx';
import Placeholder from './pages/Placeholder.jsx';
import NotFound from './pages/NotFound.jsx';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="challenges" element={<Placeholder title="Challenges" description="Challenge browsing and flag submissions will be available here." />} />
        <Route path="leaderboard" element={<Placeholder title="Leaderboard" description="Team standings and scores will appear here when competition opens." />} />
        <Route path="team" element={<Placeholder title="Team" description="Creating a team, joining with an invite code, and managing members will be available here." />} />
        <Route path="login" element={<Placeholder title="Login" description="Account sign-in and authenticator setup will be available here." />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
