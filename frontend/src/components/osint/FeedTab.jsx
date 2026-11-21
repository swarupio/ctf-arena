import { useState } from 'react';
import { LoadState, MoreButton, PinButton, Stamp } from './Common.jsx';
import { usePaged } from './usePaged.js';
import { useDesk } from './DeskContext.jsx';

function Post({ post }) {
  const desk = useDesk();
  return <li className="os-paper os-post" id={`post-${post.id}`}>
    <header>
      <span className="os-avatar" aria-hidden="true">{post.author.display.slice(0, 1)}</span>
      <div>
        <strong>{post.author.display}</strong> <span className="os-handle">{post.author.handle}</span>
        <div className="os-meta"><Stamp value={post.time} /></div>
      </div>
      <PinButton source="feed" id={post.id} title={`Post by ${post.author.handle}`} text={`${post.time} ${post.text}${post.place ? ` [place: ${post.place.name}]` : ''}`} />
    </header>
    <p>{post.text}</p>
    <p className="os-chips">
      {post.place && <span className="os-chip">Place: {post.place.name}</span>}
      {post.tags.map((t) => <span key={t.id} className="os-chip">Tagged {t.handle}</span>)}
      {post.photo && <button type="button" className="secondary small" onClick={() => desk.openTab('photos')}>Photo {post.photo}</button>}
    </p>
  </li>;
}

function Profiles() {
  const { track } = useDesk();
  const paged = usePaged(track, 'cast', {}, 20);
  return <div className="os-stack">
    <LoadState paged={paged} />
    <ul className="os-grid os-plain">
      {paged.items.map((c) => <li key={c.id} className="os-paper">
        <h3><span className="os-avatar" aria-hidden="true">{c.display.slice(0, 1)}</span> {c.display} <span className="os-handle">{c.handle}</span></h3>
        <p>{c.bio}</p>
        <dl className="os-kv"><dt>Lives in</dt><dd>{c.city}</dd><dt>Joined</dt><dd><Stamp value={c.joined} /></dd></dl>
        <PinButton source="cast" id={c.id} title={`Profile ${c.handle}`} text={`${c.handle} ${c.bio} ${c.city} joined ${c.joined}`} />
      </li>)}
    </ul>
  </div>;
}

export default function FeedTab() {
  const { track, utc, setUtc } = useDesk();
  const [view, setView] = useState('feed');
  const [author, setAuthor] = useState('');
  const [date, setDate] = useState('');
  const profiles = usePaged(track, 'cast', {}, 20);
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined;
  const feed = usePaged(track, 'feed', { author: author || undefined, date: validDate }, 25);
  return <div className="os-stack">
    <div className="os-subtabs" role="group" aria-label="Social network sections">
      <button type="button" className={view === 'feed' ? '' : 'secondary'} aria-pressed={view === 'feed'} onClick={() => setView('feed')}>Feed</button>
      <button type="button" className={view === 'cast' ? '' : 'secondary'} aria-pressed={view === 'cast'} onClick={() => setView('cast')}>Profiles</button>
    </div>
    {view === 'cast' ? <Profiles /> : <>
      <div className="os-controls">
        <label>Author<select value={author} onChange={(e) => setAuthor(e.target.value)}>
          <option value="">Everyone</option>
          {profiles.items.map((c) => <option key={c.id} value={c.id}>{c.handle}</option>)}
        </select></label>
        <label>Day (YYYY-MM-DD, poster's own clock)<input value={date} onChange={(e) => setDate(e.target.value.slice(0, 10))} placeholder="2031-03-14" inputMode="numeric" /></label>
        <label className="os-check"><input type="checkbox" checked={utc} onChange={(e) => setUtc(e.target.checked)} /> Show times as UTC</label>
      </div>
      <p className="os-muted">Times are shown on each poster's own clock with their UTC offset. Compare moments by instant, not by clock face.</p>
      <LoadState paged={feed} empty="No posts match." />
      <ol className="os-plain os-stack" aria-label="Posts, newest first">{feed.items.map((p) => <Post key={p.id} post={p} />)}</ol>
      <MoreButton paged={feed} />
    </>}
  </div>;
}
