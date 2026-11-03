import { useEffect, useState } from 'react';
import { adminCreate, adminDelete, adminList, adminUpdate } from '../api/challenges.js';
import { challengeErrorMessage } from './challengeHelpers.js';
import './Challenge.css';

const EMPTY = {
  slug: '', title: '', category: 'web', difficulty: 'easy', points: 100, description: '',
  type: 'static', image: '', internalPort: 8000, flag: '', visible: true,
};

function toBody(form) {
  const body = {
    slug: form.slug.trim(), title: form.title.trim(), category: form.category, difficulty: form.difficulty,
    points: Number(form.points), description: form.description, type: form.type, visible: form.visible,
  };
  if (form.type === 'docker') {
    body.image = form.image.trim();
    body.internalPort = Number(form.internalPort);
  } else if (form.flag.trim()) {
    body.flag = form.flag.trim();
  }
  return body;
}

export default function ChallengeAdmin() {
  const [challenges, setChallenges] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    try { setChallenges(await adminList()); }
    catch (failure) { setError(challengeErrorMessage(failure)); }
  }
  useEffect(() => { load(); }, []);

  const set = (field) => (event) => setForm({
    ...form, [field]: event.target.type === 'checkbox' ? event.target.checked : event.target.value,
  });

  function edit(challenge) {
    setEditingId(challenge.id);
    setNotice('');
    setError('');
    setForm({ ...EMPTY, ...challenge, image: challenge.image ?? '', internalPort: challenge.internalPort ?? 8000, flag: '' });
  }

  function reset() { setEditingId(null); setForm(EMPTY); }

  async function save(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (editingId) await adminUpdate(editingId, toBody(form));
      else await adminCreate(toBody(form));
      setNotice(editingId ? 'Challenge updated.' : 'Challenge created.');
      reset();
      await load();
    } catch (failure) { setError(challengeErrorMessage(failure)); }
    finally { setBusy(false); }
  }

  async function remove(challenge) {
    if (busy || !window.confirm(`Delete "${challenge.title}" and stop its running instances?`)) return;
    setBusy(true);
    setError('');
    try { await adminDelete(challenge.id); setNotice('Challenge deleted.'); await load(); }
    catch (failure) { setError(challengeErrorMessage(failure)); }
    finally { setBusy(false); }
  }

  return <section className="challenge-admin">
    <h1>Manage challenges</h1>
    {error && <p role="alert" className="error">{error}</p>}
    {notice && <p role="status" className="notice">{notice}</p>}

    <form className="admin-form" onSubmit={save}>
      <h2>{editingId ? 'Edit challenge' : 'New challenge'}</h2>
      <label>Slug<input value={form.slug} onChange={set('slug')} required pattern="[a-z0-9]+(-[a-z0-9]+)*" /></label>
      <label>Title<input value={form.title} onChange={set('title')} required maxLength={100} /></label>
      <label>Category<select value={form.category} onChange={set('category')}>
        {['web', 'crypto', 'forensics', 'misc', 'pwn'].map((value) => <option key={value}>{value}</option>)}
      </select></label>
      <label>Difficulty<select value={form.difficulty} onChange={set('difficulty')}>
        {['easy', 'medium', 'hard'].map((value) => <option key={value}>{value}</option>)}
      </select></label>
      <label>Points<input type="number" min="1" max="10000" value={form.points} onChange={set('points')} required /></label>
      <label>Type<select value={form.type} onChange={set('type')}>
        <option>static</option><option>docker</option>
      </select></label>
      {form.type === 'docker' ? <>
        <label>Image (ctf/…)<input value={form.image} onChange={set('image')} required placeholder="ctf/cookie-monster" /></label>
        <label>Internal port<input type="number" min="1" max="65535" value={form.internalPort} onChange={set('internalPort')} required /></label>
      </> : <label>Flag{editingId ? ' (leave empty to keep the current one)' : ''}<input value={form.flag} onChange={set('flag')} required={!editingId} autoComplete="off" /></label>}
      <label className="wide">Description (markdown)<textarea value={form.description} onChange={set('description')} rows={5} /></label>
      <label className="check"><input type="checkbox" checked={form.visible} onChange={set('visible')} /> Visible to players</label>
      <div className="actions">
        <button disabled={busy}>{busy ? 'Saving…' : editingId ? 'Save changes' : 'Create challenge'}</button>
        {editingId && <button type="button" className="secondary" onClick={reset}>Cancel</button>}
      </div>
    </form>

    {!challenges ? <p role="status">Loading…</p> : <div className="table-wrap"><table className="admin-table">
      <thead><tr><th>Title</th><th>Type</th><th>Category</th><th>Points</th><th>Solves</th><th>Visible</th><th /></tr></thead>
      <tbody>{challenges.map((challenge) => <tr key={challenge.id}>
        <td data-label="Title">{challenge.title}</td><td data-label="Type">{challenge.type}</td><td data-label="Category">{challenge.category}</td>
        <td data-label="Points">{challenge.points}</td><td data-label="Solves">{challenge.solveCount}</td><td data-label="Visible">{challenge.visible ? 'yes' : 'hidden'}</td>
        <td className="actions">
          <button className="secondary" onClick={() => edit(challenge)}>Edit</button>
          <button className="secondary" onClick={() => remove(challenge)}>Delete</button>
        </td>
      </tr>)}</tbody>
    </table></div>}
  </section>;
}
