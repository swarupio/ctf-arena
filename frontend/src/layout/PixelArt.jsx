// Small decorative pixel graphics. Purely visual: hidden from assistive technology.

export function PixelFlag({ className = '' }) {
  return <svg className={`pixel-flag ${className}`.trim()} viewBox="0 0 14 16" aria-hidden="true" focusable="false" shapeRendering="crispEdges">
    <path style={{ fill: 'var(--color-accent)' }} d="M3 2h9v1H3zM3 3h8v1H3zM3 4h7v1H3zM3 5h6v1H3zM3 6h5v1H3zM3 7h4v1H3z" />
    <path fill="currentColor" d="M2 0h1v16H2zM1 15h3v1H1zM3 1h10v1H3zM12 2h1v1h-1zM11 3h1v1h-1zM10 4h1v1h-1zM9 5h1v1H9zM8 6h1v1H8zM7 7h1v1H7zM3 8h5v1H3z" />
  </svg>;
}

// Each layout is a 4x4 grid: b = black, g = grey grid, l = lime, d = dither, '' = empty.
const LAYOUTS = {
  a: ['', 'd', '', '', 'b', '', 'g', 'b', 'd', 'g', 'l', '', '', 'l', '', 'd'],
  b: ['d', '', 'g', '', '', 'l', 'g', 'd', 'b', 'g', '', 'b', '', 'd', 'l', ''],
};

export function PixelBlocks({ variant = 'a', className = '' }) {
  return <div className={`pixel-blocks ${className}`.trim()} aria-hidden="true">
    {LAYOUTS[variant].map((kind, index) => <i key={index} className={kind ? `px-${kind}` : undefined} />)}
  </div>;
}
