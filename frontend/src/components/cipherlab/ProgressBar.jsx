import { percent } from './helpers.js';

export default function ProgressBar({ done, total, label }) {
  const value = percent(done, total);
  return <div className="cl-progress" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label={label}>
    <span className="cl-progress-fill" style={{ width: `${value}%` }} />
    <span className="cl-progress-text">{done}/{total}</span>
  </div>;
}
