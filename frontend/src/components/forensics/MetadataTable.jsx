import { useArtefact } from './hooks.js';

export default function MetadataTable({ track, artefact }) {
  const { data, loading, error } = useArtefact(track, artefact.id, {});
  return <section className="fx-tool" aria-label="Metadata viewer">
    {loading && <p role="status">Reading metadata...</p>}
    {error && <p role="alert" className="error">{error}</p>}
    {data && <>
      <p className="fx-meta">{data.name} · {data.tags.length} tags. Some values are encoded: the decoder tool can help.</p>
      <div className="fx-table-wrap">
        <table className="fx-table">
          <caption className="fx-sr">Metadata tags of {data.name}</caption>
          <thead><tr><th scope="col">Tag</th><th scope="col">Value</th></tr></thead>
          <tbody>{data.tags.map((tag) => <tr key={tag.tag}><th scope="row">{tag.tag}</th><td className="fx-wrap">{tag.value}</td></tr>)}</tbody>
        </table>
      </div>
    </>}
  </section>;
}
