import { useRef, useState } from 'react';
import { LoadState, PinButton } from './Common.jsx';
import { usePaged } from './usePaged.js';
import { useDesk } from './DeskContext.jsx';
import { CELL_SIZE, MAP_CELLS, latLonToXY, pointFromClick, toCell, xyToLatLon } from '../../osint/helpers.js';

const COLS = 'ABCDEFGH';

// The fictional town as an SVG map: grid cells, street names and landmarks. Click to pick a point; the pick can fill an answer.
export default function MapTab() {
  const { track, pick, setPick } = useDesk();
  const paged = usePaged(track, 'map', {}, 1);
  const svg = useRef(null);
  const [lat, setLat] = useState('');
  const [lon, setLon] = useState('');
  const map = paged.items[0];

  function choose(point) { if (point) { setPick({ ...point, cell: toCell(point.x, point.y) }); } }
  const onClick = (event) => choose(pointFromClick(svg.current?.getBoundingClientRect(), event.clientX, event.clientY));
  const converted = map ? latLonToXY(lat, lon, map.bounds) : null;

  return <div className="os-stack">
    <LoadState paged={paged} />
    {map && <>
      <p className="os-muted">
        Map of <strong>{map.town}</strong>, {map.cells} x {map.cells} grid, cells {COLS[0]}1 to {COLS[MAP_CELLS - 1]}{MAP_CELLS}. Local time: <strong>{map.tz.label}</strong>.
        Survey bounds: latitude {map.bounds.south} to {map.bounds.north}, longitude {map.bounds.west} to {map.bounds.east}. Click the map to pick a point.
      </p>
      <div className="os-map-layout">
        <svg
          ref={svg} className="os-map" viewBox="0 0 1000 1000" role="img" tabIndex={0}
          aria-label={`Street map of ${map.town} with ${map.landmarks.length} landmarks. A table of landmarks follows the map.`}
          onClick={onClick}
          onKeyDown={(event) => {
            const step = event.shiftKey ? CELL_SIZE : 25;
            const from = pick ?? { x: 500, y: 500 };
            const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
            if (moves[event.key]) { event.preventDefault(); choose({ x: Math.min(1000, Math.max(0, from.x + moves[event.key][0])), y: Math.min(1000, Math.max(0, from.y + moves[event.key][1])) }); }
          }}
        >
          <rect x="0" y="0" width="1000" height="1000" fill="#f3efe0" />
          <rect x="560" y="0" width="440" height="140" fill="#cfe6f2" opacity="0.0" />
          {Array.from({ length: MAP_CELLS + 1 }, (_, i) => <g key={i} stroke="#b9b39c" strokeWidth="1.5">
            <line x1={i * CELL_SIZE} y1="0" x2={i * CELL_SIZE} y2="1000" /><line x1="0" y1={i * CELL_SIZE} x2="1000" y2={i * CELL_SIZE} />
          </g>)}
          {Array.from({ length: MAP_CELLS }, (_, i) => <g key={i} fill="#8a8470" fontSize="22" fontFamily="monospace">
            <text x={i * CELL_SIZE + 8} y="24">{COLS[i]}</text><text x="6" y={i * CELL_SIZE + 44}>{i + 1}</text>
          </g>)}
          {map.streets.rows.map((s) => <g key={s.name}>
            <line x1="0" y1={s.y} x2="1000" y2={s.y} stroke="#6b6a63" strokeWidth="9" />
            <line x1="0" y1={s.y} x2="1000" y2={s.y} stroke="#fff" strokeWidth="3" strokeDasharray="14 12" />
            <text x="12" y={s.y - 14} fontSize="20" fontFamily="monospace" fill="#222">{s.name}</text>
          </g>)}
          {map.streets.cols.map((s) => <g key={s.name}>
            <line x1={s.x} y1="0" x2={s.x} y2="1000" stroke="#6b6a63" strokeWidth="9" />
            <line x1={s.x} y1="0" x2={s.x} y2="1000" stroke="#fff" strokeWidth="3" strokeDasharray="14 12" />
            <text transform={`translate(${s.x + 16} 990) rotate(-90)`} fontSize="20" fontFamily="monospace" fill="#222">{s.name}</text>
          </g>)}
          {map.landmarks.map((lm) => <g key={lm.id}>
            <rect x={lm.x - 12} y={lm.y - 12} width="24" height="24" fill="#b5f23d" stroke="#0a0a0a" strokeWidth="3" />
            <text x={lm.x + 18} y={lm.y + 6} fontSize="19" fontFamily="monospace" fontWeight="700" fill="#0a0a0a" stroke="#f3efe0" strokeWidth="5" paintOrder="stroke">{lm.name}</text>
          </g>)}
          {pick && <g><circle cx={pick.x} cy={pick.y} r="14" fill="none" stroke="#a8001a" strokeWidth="5" /><circle cx={pick.x} cy={pick.y} r="3" fill="#a8001a" /></g>}
        </svg>
        <div className="os-stack os-side">
          <div className="os-paper" aria-live="polite">
            <h3>Picked point</h3>
            {pick ? <dl className="os-kv"><dt>Cell</dt><dd>{pick.cell}</dd><dt>Map units</dt><dd>{pick.x},{pick.y}</dd><dt>Lat / lon</dt><dd>{Object.values(xyToLatLon(pick.x, pick.y, map.bounds)).join(' / ')}</dd></dl>
              : <p className="os-muted">Click the map (or focus it and use the arrow keys, Shift for big steps).</p>}
          </div>
          <form className="os-paper os-stack" onSubmit={(e) => e.preventDefault()}>
            <h3>GPS to map</h3>
            <label>Latitude<input value={lat} onChange={(e) => setLat(e.target.value.slice(0, 12))} inputMode="decimal" placeholder="0.55120" /></label>
            <label>Longitude<input value={lon} onChange={(e) => setLon(e.target.value.slice(0, 12))} inputMode="decimal" placeholder="0.52310" /></label>
            <p aria-live="polite" className="os-muted">{lat && lon ? (converted ? `Cell ${toCell(converted.x, converted.y)}, map units ${converted.x},${converted.y}` : 'Outside the survey bounds.') : 'Enter both values.'}</p>
            {converted && <button type="button" className="secondary small" onClick={() => choose(converted)}>Mark on map</button>}
          </form>
        </div>
      </div>
      <div className="os-table-wrap"><table className="os-table">
        <caption>Landmarks ({map.landmarks.length})</caption>
        <thead><tr><th scope="col">Name</th><th scope="col">Kind</th><th scope="col">Cell</th><th scope="col">Map units</th><th scope="col"><span className="os-sr">Pin</span></th></tr></thead>
        <tbody>{map.landmarks.map((lm) => <tr key={lm.id}>
          <th scope="row">{lm.name}</th><td>{lm.kind}</td><td>{lm.cell}</td><td>{lm.x},{lm.y}</td>
          <td><PinButton source="map" id={lm.id} title={lm.name} text={`${lm.name} (${lm.kind}) in cell ${lm.cell} at ${lm.x},${lm.y}`} /></td>
        </tr>)}</tbody>
      </table></div>
    </>}
  </div>;
}
