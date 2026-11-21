import { useId } from 'react';

// Controlled filter form. fields: [{ name, label, type: 'search' | 'text' | 'select' | 'date', options?, placeholder? }].
// `values` holds one string per field; the page decides how they become API parameters.
export default function FilterBar({ label, fields, values, onChange, onReset, children }) {
  const uid = useId();
  const active = fields.some((field) => String(values[field.name] ?? '') !== String(field.initial ?? ''));
  return <form className="adm-filters" role="search" aria-label={label} onSubmit={(event) => event.preventDefault()}>
    {fields.map((field) => {
      const id = `${uid}-${field.name}`;
      const value = values[field.name] ?? '';
      return <label key={field.name} htmlFor={id} className={field.type === 'search' ? 'adm-filter-wide' : undefined}>
        <span>{field.label}</span>
        {field.type === 'select'
          ? <select id={id} value={value} onChange={(event) => onChange(field.name, event.target.value)}>
            {field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          : <input id={id} type={field.type === 'date' ? 'date' : field.type === 'search' ? 'search' : 'text'} value={value} placeholder={field.placeholder}
            maxLength={field.maxLength} autoComplete="off" onChange={(event) => onChange(field.name, event.target.value)} />}
      </label>;
    })}
    <div className="adm-filter-actions">
      {children}
      <button type="button" className="secondary small" onClick={onReset} disabled={!active}>Reset filters</button>
    </div>
  </form>;
}
