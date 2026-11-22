import { percent } from './helpers.js';

export default function ProgressBar({ done, total, label }) {
  const value = percent(done, total);
  return <div className="ov-progress has-label">
    <span className="ov-progress-label">{done}/{total}</span>
    <div className="ov-bar" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label={label}>
      <span style={{ width: `${value}%` }} />
    </div>
  </div>;
}
