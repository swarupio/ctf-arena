import { Link } from 'react-router-dom';
import './FairPlay.css';

// Short, plain rules. Keep the wording firm but friendly. Do not list internal endpoints or decoy details here.
const RULES = [
  {
    title: 'Play it yourself',
    text: 'Use your own head, your teammates, your browser, a terminal, your notes, documentation and search engines. '
      + 'Reading up on how a technique works in general is part of the game.',
  },
  {
    title: 'Keep challenges away from AI and automated solvers',
    text: 'Do not give challenge files, page source, API traffic, session tokens or terminal output to an AI assistant '
      + 'or any automated tool and ask it to solve the challenge for you. Asking how a technique works in general is fine; '
      + 'handing it this challenge is not. Your session token is yours alone: never share it.',
  },
  {
    title: 'No bots against the platform',
    text: 'Do not run scripts, bots or scrapers against the arena itself: sign-in, flag submission, instances or the leaderboard. '
      + 'A short script of your own that helps you work on your own challenge instance is fine.',
  },
  {
    title: 'Only the challenges are in scope',
    text: 'Do not attack the platform itself: the login, the API, the servers, other players or other teams\' instances. '
      + 'If you find a real hole in the arena, tell an organiser instead of using it. We will be glad you did.',
  },
  {
    title: 'Flags are unique per team',
    text: 'Every team gets its own flags, so a flag you got from somebody else never scores. Passing flags around does not work, so do not bother.',
  },
  {
    title: 'We keep an eye out',
    text: 'To keep the game fair, the arena records signs of suspicious activity for admin review: unusual request rates and timing patterns, '
      + 'signs of automation, and access to debug or internal endpoints that players have no reason to touch. '
      + 'A signal is not a verdict. An admin looks at the evidence before anything happens.',
  },
  {
    title: 'What happens if you cheat',
    text: 'Points from the affected solves are removed. Serious or repeated cases get the whole team banned from the arena. '
      + 'Teams share a score and a ban, so agree on these rules with your teammates.',
  },
];

export default function FairPlay() {
  return <article className="fp-page" aria-labelledby="fair-play-title">
    <h1 id="fair-play-title">Fair play</h1>
    <p className="fp-why"><strong>Why:</strong> a CTF is practice. The point is that <em>you</em> learn it. A flag you did not earn teaches you nothing, and a leaderboard is only fun when everyone on it earned their place.</p>
    <ol className="fp-rules">
      {RULES.map((rule) => <li key={rule.title} className="fp-rule">
        <h2>{rule.title}</h2>
        <p>{rule.text}</p>
      </li>)}
    </ol>
    <div className="fp-help">
      <p>Not sure whether something is allowed? Ask an organiser before you try it.</p>
      <div className="fp-actions">
        <Link className="button" to="/challenges">Back to challenges</Link>
        <Link className="button secondary" to="/">Home</Link>
      </div>
    </div>
  </article>;
}
