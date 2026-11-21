import { useId } from 'react';
import PageBlocks from './PageBlocks.jsx';
import { displayUrl, themeOf } from './helpers.js';

const MARKS = { 'retro-bank': '$', pizza: 'P', hospital: '+', vault: '#' };

// The fake "target site": a themed browser window. The site form (login box, search box, ...) is generated from the
// lab's `form` description and only fills the request inspector; the real network call happens on Send.
export default function TargetFrame({
  site, company, theme, request, response, loading, form, values, onValuesChange, onSubmitForm,
}) {
  const id = useId();
  const kind = themeOf(theme);
  const page = response?.page ?? null;
  return <section className="wl-frame" data-theme={kind} aria-label={`Target site: ${site?.name ?? company?.name}`}>
    <div className="wl-frame-bar">
      <span className="wl-dots" aria-hidden="true"><span /><span /><span /></span>
      <span className="wl-url" title={displayUrl(site, request?.path)}>{displayUrl(site, request?.path)}</span>
      <span className={`wl-status${response ? ` is-${Math.floor(response.status / 100)}xx` : ''}`} aria-live="polite">
        {loading ? 'loading...' : response ? response.status : 'idle'}
      </span>
    </div>
    <div className="wl-site">
      <header className="wl-site-head">
        <span className="wl-logo" aria-hidden="true">{MARKS[kind]}</span>
        <div>
          <strong>{site?.name ?? company?.name}</strong>
          {company?.tagline && <small>{company.tagline}</small>}
        </div>
      </header>
      {form && <form
        className="wl-site-form"
        onSubmit={(event) => { event.preventDefault(); onSubmitForm(); }}
      >
        {form.fields.map((field) => <label key={field.name} htmlFor={`${id}-${field.name}`}>
          <span>{field.label}</span>
          <input
            id={`${id}-${field.name}`}
            type={field.type === 'password' ? 'password' : 'text'}
            value={values[field.name] ?? ''}
            maxLength={200}
            autoComplete="off"
            spellCheck="false"
            onChange={(event) => onValuesChange({ ...values, [field.name]: event.target.value })}
          />
        </label>)}
        <button type="submit" disabled={loading}>{form.submit.label}</button>
      </form>}
      <div className="wl-site-body" aria-busy={loading}>
        {loading && !page && <p className="wl-muted">Loading the page...</p>}
        {!loading && !response && <p className="wl-muted">
          {form ? 'Use the form above, or edit the raw request on the right and press Send.' : 'Press Send in the request inspector to load this page.'}
        </p>}
        {page && <PageBlocks blocks={page.blocks} />}
        {response && !page && <pre className="wl-code" tabIndex={0}>{response.body}</pre>}
      </div>
    </div>
  </section>;
}
