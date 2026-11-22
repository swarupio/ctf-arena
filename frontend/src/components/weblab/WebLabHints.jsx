import { useCallback, useEffect, useRef, useState } from 'react';
import { openLabHint } from '../../api/weblab.js';
import HintLadder from '../../hints/HintLadder.jsx';
import { useRemoteHints } from '../../hints/hooks.js';
import { mergeSpent } from '../../hints/pricing.js';
import { restoreTarget } from '../../hints/restore.js';

// The server serves one hint per request (POST, idempotent) and records the open for the team. After a reload the opened
// hints come back from the lab view's `hintsOpened` (1-based levels the team opened): hints 1..highest are fetched again in
// order, which costs nothing twice. Admins get no `hintsOpened`, so their previews fall back to the count kept in this
// browser. Each answer may carry `cost` and `spent` (never for admins): the latest `spent` is what the panel shows.
export default function WebLabHints({ slug, user, count, onCount, pricing, spent, base, opened, priced = true }) {
  const [seen, setSeen] = useState(null);
  const [restore] = useState(() => restoreTarget(opened, count)); // read once: a later reload of the lab view must not restore again
  const last = useRef(null);
  const fetchHint = useCallback(async (level) => {
    const answer = await openLabHint(slug, level);
    last.current = answer;
    if (answer?.spent) { setSeen((current) => mergeSpent(current, answer.spent)); }
    return answer.text;
  }, [slug]);
  const { texts, open } = useRemoteHints(user, `weblab:${slug}`, count, fetchHint, restore);
  useEffect(() => { onCount(texts.length); }, [texts.length, onCount]);
  const onOpen = async () => {
    last.current = null;
    await open();
    return last.current;
  };
  return <HintLadder
    category="weblab" title="" hints={texts} total={count} onOpen={onOpen} pricing={pricing} spent={mergeSpent(spent, seen)}
    base={base} priced={priced} cumulative describeError={() => 'Could not load that hint. Try again.'}
  />;
}
