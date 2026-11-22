import { useEffect } from 'react';

// Sets the tab title to "<title> · CTF Arena" (just "CTF Arena" for the home page). One distinct title per route helps screen
// reader users (the title is read on every navigation), browser history and bookmarks.
export default function DocumentTitle({ title }) {
  useEffect(() => {
    document.title = !title || title === 'Home' ? 'CTF Arena · Train on the Range. Compete in the Arena.' : `${title} · CTF Arena`;
  }, [title]);
  return null;
}
