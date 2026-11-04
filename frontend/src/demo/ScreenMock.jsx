import './panels.css';

const GLYPH = { ok: '✓', bad: '✗', info: 'i' };
const KIND_LABEL = { ok: 'Success: ', bad: 'Failure: ', info: 'Info: ' };

function slugify(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function clockText(minute) {
  const m = Math.max(0, Math.floor(Number(minute) || 0));
  return `T+${String(m).padStart(2, '0')}:00`;
}

function actorTag(actor) {
  if (!actor) return null;
  if (actor === 'System') return <span>Background job</span>;
  return (
    <>
      <span>Player: {actor}</span>
      {actor === 'Admin' ? <span className="demo-screen-chip">ADMIN</span> : null}
    </>
  );
}

// A fake browser window: what the acting player (or the admin) would see on screen at this moment of the demo.
export default function ScreenMock({ screen, actor, minute }) {
  const badge = screen?.badge ?? null;
  const kind = badge && GLYPH[badge.kind] ? badge.kind : 'info';
  const rows = Array.isArray(screen?.rows) ? screen.rows : [];
  const slug = screen ? slugify(screen.title) : '';
  // Keying the content on title + badge text remounts it, so the pop-in animation replays on every change.
  const contentKey = screen ? `${screen.title}|${badge ? badge.text : ''}` : 'empty';
  const actorNode = actorTag(actor);

  return (
    <section className="demo-pnl demo-screen" aria-label="Browser window showing the player view">
      <div className="demo-screen-bar">
        <span className="demo-screen-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <span className="demo-screen-url">{slug ? `localhost / ${slug}` : 'localhost /'}</span>
      </div>
      <div className="demo-screen-meta">
        {actorNode ? <span className="demo-pnl-tag demo-screen-actor">{actorNode}</span> : <span />}
        <span className="demo-screen-clock">{clockText(minute)}</span>
      </div>
      <div className="demo-screen-body" aria-live="polite">
        {screen ? (
          <div className="demo-screen-content" key={contentKey}>
            <h3 className="demo-screen-title">{screen.title}</h3>
            {rows.length > 0 ? (
              <dl className="demo-screen-rows">
                {rows.map((row, i) => (
                  <div className="demo-screen-row" key={`${row.label}-${i}`}>
                    <dt>{row.label}</dt>
                    <dd>
                      {row.mono ? (
                        <code className="demo-screen-code">{String(row.value ?? '')}</code>
                      ) : (
                        String(row.value ?? '')
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {badge ? (
              <div className={`demo-screen-stamp demo-screen-stamp-${kind}`}>
                <span className="demo-pnl-sr">{KIND_LABEL[kind]}</span>
                <span className="demo-screen-glyph" aria-hidden="true">
                  {GLYPH[kind]}
                </span>
                <span>{badge.text}</span>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="demo-screen-empty">Waiting for the match to start</p>
        )}
      </div>
    </section>
  );
}
