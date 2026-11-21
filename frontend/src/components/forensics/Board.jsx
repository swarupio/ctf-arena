import { evidenceCards } from '../../forensics/caseHelpers.js';

// Corkboard of confirmed evidence: one card per question, a pin and the answer once the stage is solved.
export function EvidenceBoard({ evidence, stages }) {
  const cards = evidenceCards(evidence, stages);
  return <section className="fx-board" aria-labelledby="fx-evidence-title">
    <h2 id="fx-evidence-title">Evidence board</h2>
    <ul className="fx-cards">
      {cards.map((card) => <li key={card.n} className={`fx-card${card.confirmed ? ' is-confirmed' : ''}`}>
        <span className="fx-pin" aria-hidden="true" />
        <span className="fx-card-title">{card.title}</span>
        <strong className="fx-card-value">{card.confirmed ? card.value : '???'}</strong>
        <span className="fx-sr">{card.confirmed ? 'confirmed' : 'not yet confirmed'}</span>
      </li>)}
    </ul>
  </section>;
}

// Suspects with their facts. A fact stays hidden ("???") until the stage that proves it is solved.
export function SuspectBoard({ suspects, evidenceValues, canAccuse, onAccuse }) {
  return <section className="fx-board" aria-labelledby="fx-suspects-title">
    <h2 id="fx-suspects-title">Suspect board</h2>
    <p className="fx-muted">Exactly one suspect matches every confirmed clue. Look for who fits all of them, not just some.</p>
    <ul className="fx-suspects">
      {suspects.map((suspect) => {
        const hits = suspect.facts.filter((fact) => fact.value !== null && evidenceValues.get(fact.stage) === fact.value).length;
        const known = suspect.facts.filter((fact) => fact.value !== null).length;
        return <li key={suspect.id} className="fx-suspect">
          <div className="fx-suspect-head">
            <h3>{suspect.name}</h3>
            <span className="fx-role">{suspect.role}</span>
          </div>
          <dl>
            {suspect.facts.map((fact) => {
              const matches = fact.value !== null && evidenceValues.get(fact.stage) === fact.value;
              return <div key={fact.label} className={matches ? 'is-match' : undefined}>
                <dt>{fact.label}</dt>
                <dd>{fact.value ?? '???'}{matches && <span className="fx-sr"> (matches the evidence)</span>}</dd>
              </div>;
            })}
          </dl>
          {known > 0 && <p className="fx-score" aria-label={`${hits} of ${known} known clues match`}>{hits}/{known} clues match</p>}
          {canAccuse && <button type="button" className="secondary small" onClick={() => onAccuse(suspect.name)}>Accuse {suspect.name}</button>}
        </li>;
      })}
    </ul>
  </section>;
}
