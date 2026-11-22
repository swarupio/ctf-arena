import { useEffect, useState } from 'react';
import { askSuspect, getInterviews } from '../../api/forensics.js';
import { describeForensicsError } from '../../forensics/caseHelpers.js';

// Optional aid: ask each suspect whether the confirmed evidence is theirs. Questions appear as stages are solved. Suspects do
// not always tell the truth, so compare their answers with the facts on the suspect board.
export default function Interviews({ trackId, solved }) {
  const [data, setData] = useState({ questions: [], suspects: [] });
  const [answers, setAnswers] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setLoadFailed(false);
    getInterviews(trackId).then((d) => { if (live) { setData(d); } }).catch(() => { if (live) { setLoadFailed(true); } });
    return () => { live = false; };
  }, [trackId, solved, attempt]);

  const ask = async (suspectId, questionId) => {
    setBusy(true);
    setError('');
    try {
      const reply = await askSuspect(trackId, suspectId, questionId);
      setAnswers((prev) => ({ ...prev, [`${suspectId}:${questionId}`]: reply }));
    } catch (e) {
      setError(describeForensicsError(e));
    } finally {
      setBusy(false);
    }
  };

  if (loadFailed) {
    return <section className="fx-board" aria-labelledby="fx-interviews-title">
      <h2 id="fx-interviews-title">Interviews</h2>
      <p role="alert" className="error">Could not load interviews.</p>
      <button type="button" className="secondary small" onClick={() => setAttempt((n) => n + 1)}>Retry</button>
    </section>;
  }
  if (data.questions.length === 0) {
    return <section className="fx-board" aria-labelledby="fx-interviews-title">
      <h2 id="fx-interviews-title">Interviews</h2>
      <p className="fx-muted">Confirm a piece of evidence to unlock questions for the suspects. Interviews are optional.</p>
    </section>;
  }
  return <section className="fx-board" aria-labelledby="fx-interviews-title">
    <h2 id="fx-interviews-title">Interviews</h2>
    <p className="fx-muted">Optional. Suspects do not always tell the truth. Compare their answers with the evidence on the board and look for someone who keeps contradicting it.</p>
    {error && <p role="alert" className="error">{error}</p>}
    <ul className="fx-interviews">
      {data.suspects.map((suspect) => <li key={suspect.id} className="fx-suspect">
        <div className="fx-suspect-head"><h3>{suspect.name}</h3><span className="fx-role">{suspect.role}</span></div>
        <ul className="fx-qa">
          {data.questions.map((q) => {
            const reply = answers[`${suspect.id}:${q.id}`];
            return <li key={q.id}>
              <p className="fx-muted">{q.text}</p>
              {reply ? <p role="status"><strong>{reply.answer === 'yes' ? 'Yes' : 'No'}</strong> {reply.statement}</p>
                : <button type="button" className="secondary small" disabled={busy} onClick={() => ask(suspect.id, q.id)}>Ask {suspect.name}</button>}
            </li>;
          })}
        </ul>
      </li>)}
    </ul>
  </section>;
}
