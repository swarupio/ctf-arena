import './HopTrail.css';

/*
 * Breadcrumb of the request hops of the current demo step:
 *   Request path  [1 Browser -> Nginx] > [2 Nginx -> Backend 2] > ...
 * `hops` is step.hops ({ title, ... }), `current` the 0-based index of the active hop (hops before it are
 * "done", after it "upcoming"), `onSelect(i)` receives the 0-based index of the clicked chip.
 */
export default function HopTrail({ hops, current, onSelect }) {
  const list = Array.isArray(hops) ? hops : [];
  if (list.length === 0) return null;
  const at = Number.isInteger(current) ? current : -1;

  return (
    <div className="demo-hops" role="group" aria-label="Request path">
      <span className="demo-hops__label" aria-hidden="true">
        Request path
      </span>
      <ol className="demo-hops__list">
        {list.map((hop, i) => {
          const state = i < at ? 'is-done' : i === at ? 'is-current' : 'is-upcoming';
          const title = hop && hop.title ? String(hop.title) : `Hop ${i + 1}`;
          return (
            <li className="demo-hops__item" key={i}>
              {i > 0 ? <span className="demo-hops__arrow" aria-hidden="true" /> : null}
              <button
                type="button"
                className={`demo-hops__chip ${state}`}
                aria-current={i === at ? 'step' : undefined}
                aria-label={`Go to hop ${i + 1}: ${title}`}
                title={title}
                onClick={() => {
                  if (typeof onSelect === 'function') onSelect(i);
                }}
              >
                <span className="demo-hops__num" aria-hidden="true">
                  {i + 1}
                </span>
                <span className="demo-hops__title">{title}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
