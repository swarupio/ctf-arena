import { useEffect, useRef } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Navbar from './Navbar.jsx';
import Footer from './Footer.jsx';

export default function Layout() {
  const { pathname } = useLocation();
  const main = useRef(null);
  useEffect(() => {
    main.current?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [pathname]);
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">Skip to content</a>
      <Navbar />
      <main className="container main-content" id="main" tabIndex={-1} ref={main}><Outlet /></main>
      <Footer />
    </div>
  );
}
