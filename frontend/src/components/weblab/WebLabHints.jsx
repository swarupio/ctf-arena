import { useCallback, useEffect } from 'react';
import { getHint } from '../../api/weblab.js';
import HintLadder from '../../hints/HintLadder.jsx';
import { useRemoteHints } from '../../hints/hooks.js';

// The server serves one hint per request and does not track opens, so the opened count is kept in this browser per player and lab.
export default function WebLabHints({ slug, user, count, onCount }) {
  const fetchHint = useCallback(async (level) => (await getHint(slug, level)).text, [slug]);
  const { texts, open } = useRemoteHints(user, `weblab:${slug}`, count, fetchHint);
  useEffect(() => { onCount(texts.length); }, [texts.length, onCount]);
  return <HintLadder
    category="weblab" title="" hints={texts} total={count} onOpen={open}
    describeError={() => 'Could not load that hint. Try again.'}
  />;
}
