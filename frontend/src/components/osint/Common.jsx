import { useDesk } from './DeskContext.jsx';
import { formatStamp, sceneShapes } from '../../osint/helpers.js';

export function PinButton({ source, id, title, text }) {
  const desk = useDesk();
  const done = desk.pinned(source, id);
  return <button
    type="button" className="secondary small os-pin-btn" aria-pressed={done} disabled={done}
    onClick={() => desk.pin({ source, id, title, text })}
  >{done ? 'Pinned' : 'Pin to board'}<span className="os-sr"> {title}</span></button>;
}

// A time stamp shown in the poster's own zone, or as UTC when the desk toggle is on. The raw value is the tooltip.
export function Stamp({ value }) {
  const { utc } = useDesk();
  return <time dateTime={value} title={value}>{formatStamp(value, utc ? 'utc' : 'local')}</time>;
}

export function LoadState({ paged, empty = 'Nothing here.' }) {
  if (paged.error) { return <p role="alert" className="error">{paged.error} <button type="button" className="secondary small" onClick={paged.reload}>Retry</button></p>; }
  if (paged.loading && paged.items.length === 0) { return <p role="status" className="os-muted">Pulling the files...</p>; }
  if (!paged.loading && paged.items.length === 0) { return <p className="os-muted">{empty}</p>; }
  return null;
}

export function MoreButton({ paged }) {
  if (!paged.hasMore) { return null; }
  return <button type="button" className="secondary" disabled={paged.loading} onClick={paged.more}>{paged.loading ? 'Loading...' : `Load more (${paged.items.length} of ${paged.total})`}</button>;
}

// A procedurally drawn photograph: the server sends shapes, the browser draws them as SVG elements (never markup).
export function SceneSvg({ scene, alt }) {
  const shapes = sceneShapes(scene);
  return <svg className="os-scene" viewBox={`0 0 ${scene?.w ?? 320} ${scene?.h ?? 200}`} role="img" aria-label={alt} preserveAspectRatio="xMidYMid slice">
    {shapes.map((s, i) => {
      if (s.t === 'r') { return <rect key={i} x={s.x} y={s.y} width={s.w} height={s.h} fill={s.f} />; }
      if (s.t === 'c') { return <circle key={i} cx={s.x} cy={s.y} r={s.r} fill={s.f} />; }
      if (s.t === 'p') { return <polygon key={i} points={s.pts} fill={s.f} stroke={s.f === 'none' ? '#555' : undefined} strokeWidth={s.f === 'none' ? 3 : undefined} />; }
      if (s.t === 'l') { return <line key={i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={s.s} strokeWidth={s.w} />; }
      return <text key={i} x={s.x} y={s.y} fontSize={s.sz} fill={s.f} textAnchor={s.anchor} fontFamily="monospace" fontWeight="700">{s.s}</text>;
    })}
  </svg>;
}
