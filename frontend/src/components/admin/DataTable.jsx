import { useId } from 'react';
import { ariaSort, nextSort, PAGE_SIZES } from '../../admin/query.js';
import { pageCount, pageWindow, rangeLabel } from '../../admin/pagination.js';

export function Pagination({ page, limit, total, onPage, onLimit, busy = false }) {
  const pages = pageCount(total, limit);
  const sizeId = useId();
  return <nav className="adm-pager" aria-label="Pagination">
    <p className="adm-pager-range" role="status" aria-live="polite">{rangeLabel(page, limit, total)}</p>
    <div className="adm-pager-pages">
      <button type="button" className="secondary small" onClick={() => onPage(page - 1)} disabled={busy || page <= 1}>Previous</button>
      {pageWindow(page, pages).map((item, index) => (item === 'gap'
        ? <span key={`gap-${index}`} className="adm-pager-gap" aria-hidden="true">&hellip;</span>
        : <button key={item} type="button" className={`small${item === page ? '' : ' secondary'}`} aria-current={item === page ? 'page' : undefined}
          aria-label={`Page ${item}`} onClick={() => onPage(item)} disabled={busy}>{item}</button>))}
      <button type="button" className="secondary small" onClick={() => onPage(page + 1)} disabled={busy || page >= pages}>Next</button>
    </div>
    {onLimit && <label className="adm-pager-size" htmlFor={sizeId}>
      <span>Per page</span>
      <select id={sizeId} value={limit} onChange={(event) => onLimit(Number(event.target.value))}>
        {PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
      </select>
    </label>}
  </nav>;
}

// columns: [{ key, header, render(row), sortKey?, align?, className? }]. `sort` is the API sort string (`-createdAt`).
// States: loading skeleton (no rows yet), error with retry, empty message, and a dimmed table while reloading.
export default function DataTable({
  caption, columns, rows = [], rowKey = (row) => row.id, loading = false, error = '', onRetry,
  emptyTitle = 'Nothing to show', emptyHint = '', sort = '', onSort, pagination, rowClassName, renderExpanded,
}) {
  const hasRows = rows.length > 0;
  const showSkeleton = loading && !hasRows && !error;
  const showError = Boolean(error) && !hasRows;
  const showEmpty = !loading && !error && !hasRows;
  const dim = loading && hasRows;

  return <div className="adm-table-block">
    {error && hasRows && <p role="alert" className="error adm-inline-error">{error} <button type="button" className="secondary small" onClick={onRetry}>Retry</button></p>}
    <div className={`adm-scroll${dim ? ' adm-dim' : ''}`} role="region" aria-label={caption} tabIndex={0}>
      <table className="adm-table" aria-busy={loading}>
        <caption className="adm-sr">{caption}</caption>
        <thead>
          <tr>{columns.map((column) => <th key={column.key} scope="col" className={column.align === 'right' ? 'adm-right' : undefined}
            aria-sort={column.sortKey && onSort ? ariaSort(sort, column.sortKey) : undefined}>
            {column.sortKey && onSort
              ? <button type="button" className="adm-sort" onClick={() => onSort(nextSort(sort, column.sortKey))}>
                {column.header}<span aria-hidden="true" className="adm-sort-mark">{ariaSort(sort, column.sortKey) === 'ascending' ? '▲' : ariaSort(sort, column.sortKey) === 'descending' ? '▼' : '↕'}</span>
              </button>
              : column.header}
          </th>)}</tr>
        </thead>
        <tbody>
          {showSkeleton && Array.from({ length: 5 }, (_, index) => <tr key={`skeleton-${index}`} className="adm-skeleton-row" aria-hidden="true">
            {columns.map((column) => <td key={column.key}><span className="adm-skeleton" /></td>)}
          </tr>)}
          {hasRows && rows.map((row) => [
            <tr key={rowKey(row)} className={rowClassName?.(row) || undefined}>
              {columns.map((column) => <td key={column.key} className={`${column.align === 'right' ? 'adm-right ' : ''}${column.className ?? ''}`.trim() || undefined}>{column.render(row)}</td>)}
            </tr>,
            renderExpanded?.(row) ? <tr key={`${rowKey(row)}-more`} className="adm-expanded"><td colSpan={columns.length}>{renderExpanded(row)}</td></tr> : null,
          ])}
          {showError && <tr><td colSpan={columns.length}>
            <div className="adm-state" role="alert">
              <p><strong>Could not load this list.</strong></p>
              <p>{error}</p>
              {onRetry && <button type="button" onClick={onRetry}>Try again</button>}
            </div>
          </td></tr>}
          {showEmpty && <tr><td colSpan={columns.length}>
            <div className="adm-state">
              <p><strong>{emptyTitle}</strong></p>
              {emptyHint && <p className="adm-muted">{emptyHint}</p>}
            </div>
          </td></tr>}
        </tbody>
      </table>
    </div>
    {showSkeleton && <p role="status" className="adm-sr">Loading {caption}</p>}
    {pagination && !showSkeleton && <Pagination {...pagination} busy={loading} />}
  </div>;
}
