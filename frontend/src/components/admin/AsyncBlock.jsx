// Wraps content that needs loaded data: skeleton while the first load runs, error with retry when it failed
// and there is nothing to show yet. Once data exists, the children stay visible during reloads.
export default function AsyncBlock({ loading, error, hasData, onRetry, label = 'data', lines = 3, children }) {
  if (hasData) return children;
  if (error) {
    return <div className="adm-state" role="alert">
      <p><strong>Could not load {label}.</strong></p>
      <p>{error}</p>
      {onRetry && <button type="button" onClick={onRetry}>Try again</button>}
    </div>;
  }
  if (loading) {
    return <div aria-busy="true" className="adm-skeleton-block">
      <p role="status" className="adm-sr">Loading {label}</p>
      {Array.from({ length: lines }, (_, index) => <span key={index} className="adm-skeleton" aria-hidden="true" />)}
    </div>;
  }
  return null;
}
