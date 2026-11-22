import './onboarding.css';

const IDEAS = [
  ['1', 'Find the flag', 'Every level hides a secret string. Look, decode, inspect or exploit to get it.'],
  ['2', 'Submit it', 'Paste it into the level. The server checks it and tells you if it is right.'],
  ['3', 'Watch the scoreboard', 'Each captured flag scores points for your team on the leaderboard.'],
];

/** Three core ideas in one small strip. Static: no animation, no modal, nothing to dismiss. */
export default function HowItWorks({ className = '' }) {
  return <ol className={`ob-how ${className}`.trim()} aria-label="How it works">
    {IDEAS.map(([number, title, text]) => <li key={number}>
      <span className="ob-how-num" aria-hidden="true">{number}</span>
      <strong>{title}</strong>
      <span>{text}</span>
    </li>)}
  </ol>;
}
