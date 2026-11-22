import { useEffect, useRef, useState } from 'react';
import { barWidths, labelIndexes, lineChartModel, nearestIndex } from '../../admin/chart.js';

// Width of an element, kept up to date with ResizeObserver (falls back to `initial` before the first measure).
function useWidth(ref, initial = 640) {
  const [width, setWidth] = useState(initial);
  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const measure = () => setWidth(Math.max(200, Math.round(node.getBoundingClientRect().width)) || initial);
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref, initial]);
  return width;
}

// Line chart of several daily series. series: [{ key, label, className }] (className picks colour and dash from CSS).
// rows: [{ [xKey]: '2026-11-22', ...values }]. The hidden table below gives screen readers every number.
export function SvgLineChart({ rows, xKey = 'date', series, height = 220, formatX = String, label }) {
  const wrapRef = useRef(null);
  const width = useWidth(wrapRef);
  const [hover, setHover] = useState(null);
  const model = lineChartModel(rows, series.map((item) => item.key), { width, height });
  const { area } = model;
  const labels = labelIndexes(rows.length, area.right - area.left);
  const index = hover !== null && hover < rows.length ? hover : null;
  const tipLeft = index === null ? 0 : Math.min(Math.max(0, model.xs[index] + 12 > width - 150 ? model.xs[index] - 162 : model.xs[index] + 12), Math.max(0, width - 150));

  function onPointer(event) {
    const box = event.currentTarget.ownerSVGElement.getBoundingClientRect();
    setHover(nearestIndex(event.clientX - box.left, model.xs));
  }

  return <figure className="adm-chart">
    <div className="adm-chart-wrap" ref={wrapRef}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
        <g className="adm-chart-grid">
          {model.ticks.map((tick, index) => <line key={`${index}-${tick.value}`} x1={area.left} x2={area.right} y1={tick.y} y2={tick.y} />)}
        </g>
        <g className="adm-chart-axis">
          {model.ticks.map((tick, index) => <text key={`${index}-${tick.value}`} x={area.left - 6} y={tick.y} textAnchor="end" dominantBaseline="middle">{tick.value}</text>)}
          {labels.map((position) => <text key={position} x={model.xs[position]} y={area.bottom + 18}
            textAnchor={position === 0 ? 'start' : position === rows.length - 1 ? 'end' : 'middle'}>{formatX(rows[position][xKey])}</text>)}
        </g>
        {model.series.map((line, order) => <path key={line.key} d={line.path} className={`adm-line ${series[order].className}`} fill="none" />)}
        {index !== null && <g pointerEvents="none">
          <line className="adm-chart-cross" x1={model.xs[index]} x2={model.xs[index]} y1={area.top} y2={area.bottom} />
          {model.series.map((line, order) => <circle key={line.key} className={`adm-dot ${series[order].className}`} cx={line.points[index].x} cy={line.points[index].y} r="4" />)}
        </g>}
        <rect x={area.left} y={area.top} width={area.right - area.left} height={area.bottom - area.top} fill="transparent"
          onPointerMove={onPointer} onPointerDown={onPointer} onPointerLeave={() => setHover(null)} onPointerCancel={() => setHover(null)} />
      </svg>
      {index !== null && <div className="adm-chart-tip" style={{ left: tipLeft, top: area.top }} aria-hidden="true">
        <strong>{formatX(rows[index][xKey])}</strong>
        <ul>{series.map((item) => <li key={item.key}><span className={`adm-swatch ${item.className}`} />{item.label}: {rows[index][item.key] ?? 0}</li>)}</ul>
      </div>}
    </div>
    <ul className="adm-legend" aria-hidden="true">
      {series.map((item) => <li key={item.key}><span className={`adm-swatch ${item.className}`} />{item.label}</li>)}
    </ul>
    <table className="adm-sr">
      <caption>{label}</caption>
      <thead><tr><th scope="col">Day</th>{series.map((item) => <th key={item.key} scope="col">{item.label}</th>)}</tr></thead>
      <tbody>{rows.map((row) => <tr key={row[xKey]}><th scope="row">{formatX(row[xKey])}</th>{series.map((item) => <td key={item.key}>{row[item.key] ?? 0}</td>)}</tr>)}</tbody>
    </table>
  </figure>;
}

// Horizontal bars. items: [{ key, label, value, text? }]; `text` overrides the printed value.
export function SvgBarChart({ items, label, className = '', labelWidth = 150, rowHeight = 26 }) {
  const wrapRef = useRef(null);
  const width = useWidth(wrapRef, 480);
  const barSpace = Math.max(40, width - labelWidth - 56);
  const widths = barWidths(items.map((item) => item.value), barSpace);
  const height = Math.max(1, items.length) * rowHeight;
  return <figure className="adm-chart">
    <div className="adm-chart-wrap" ref={wrapRef}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
        {items.map((item, row) => <g key={item.key} transform={`translate(0 ${row * rowHeight})`}>
          <text className="adm-chart-axis-text" x={labelWidth - 8} y={rowHeight / 2} textAnchor="end" dominantBaseline="middle">
            {item.label.length > 20 ? `${item.label.slice(0, 19)}…` : item.label}
            <title>{item.label}</title>
          </text>
          <rect className={`adm-bar-rect ${className}`} x={labelWidth} y={4} width={widths[row]} height={rowHeight - 8} />
          <text className="adm-chart-axis-text" x={labelWidth + widths[row] + 6} y={rowHeight / 2} dominantBaseline="middle">{item.text ?? item.value}</text>
        </g>)}
      </svg>
    </div>
    <table className="adm-sr">
      <caption>{label}</caption>
      <thead><tr><th scope="col">Name</th><th scope="col">Value</th></tr></thead>
      <tbody>{items.map((item) => <tr key={item.key}><th scope="row">{item.label}</th><td>{item.text ?? item.value}</td></tr>)}</tbody>
    </table>
  </figure>;
}
