import { LoadState, MoreButton, PinButton, SceneSvg, Stamp } from './Common.jsx';
import { usePaged } from './usePaged.js';
import { useDesk } from './DeskContext.jsx';

export default function PhotosTab() {
  const { track } = useDesk();
  const paged = usePaged(track, 'photos', {}, 6);
  return <div className="os-stack">
    <p className="os-muted">Every picture is drawn for your team on the fly. Alt text describes what is visible; the metadata table is what the camera and the editing software wrote. Camera clocks are not always set to the local time.</p>
    <LoadState paged={paged} empty="No photos in this case." />
    <ul className="os-grid os-plain">{paged.items.map((p) => <li key={p.id} className="os-paper os-photo">
      <SceneSvg scene={p.scene} alt={p.alt} />
      <p><strong>{p.id}</strong> posted by {p.author?.handle ?? 'unknown'} {p.time && <>on <Stamp value={p.time} /></>}</p>
      <p className="os-muted">{p.alt}</p>
      {p.signs.length > 0 && <p>Street sign reads: <strong>{p.signs.join('; ')}</strong></p>}
      <div className="os-table-wrap"><table className="os-table os-exif">
        <caption className="os-sr">Metadata of {p.id}</caption>
        <thead><tr><th scope="col">Tag</th><th scope="col">Value</th></tr></thead>
        <tbody>{Object.entries(p.exif).map(([tag, value]) => <tr key={tag}><th scope="row">{tag}</th><td>{value}</td></tr>)}</tbody>
      </table></div>
      <PinButton source="photos" id={p.id} title={`Photo ${p.id}`} text={`${p.alt} ${p.signs.length ? `Sign: ${p.signs.join('; ')}. ` : ''}${Object.entries(p.exif).map(([k, v]) => `${k}=${v}`).join(' ')}`} />
    </li>)}</ul>
    <MoreButton paged={paged} />
  </div>;
}
