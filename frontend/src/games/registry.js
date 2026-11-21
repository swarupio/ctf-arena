import { normalizeModes } from '../terminal/adapters.js';
import { normalizeTrack } from './progress.js';

// Every game on the hub. To add one, append an entry:
//   id        unique key
//   title     card heading
//   path      the game's route (also the Open button target)
//   pitch     one line shown on the card
//   overview  GET path (relative to /api) whose answer lists the game's tracks
//   summarize (data) => { tracks: [{ id, title, difficulty, solved, total, pointsEarned, maxPoints }] }
// Games that are not installed simply have no entry, so they never show a card.

const tracksOf = (data) => (Array.isArray(data) ? data : Array.isArray(data?.tracks) ? data.tracks : []);
const summary = (tracks) => ({ tracks: tracks.map(normalizeTrack) });

export const GAMES = [
  {
    id: 'terminal',
    title: 'Arena Terminal',
    path: '/terminal',
    pitch: 'A fake Unix box in your tab. Dig through files and find the hidden codes.',
    overview: '/terminal/modes',
    summarize: (data) => summary(normalizeModes(data).map((mode) => ({
      id: mode.mode, title: mode.title, difficulty: mode.difficulty || mode.mode,
      solved: mode.solved, total: mode.codes, pointsEarned: mode.pointsEarned, maxPoints: mode.points,
    }))),
  },
  {
    id: 'cipherlab',
    title: 'Cipher Lab',
    path: '/cipherlab',
    pitch: 'Crack coded messages with a growing toolbox, from rookie desk to the Black Chamber.',
    overview: '/cipherlab/overview',
    summarize: (data) => summary(tracksOf(data).map((track) => ({
      id: track?.id, title: track?.title, difficulty: track?.difficulty,
      solved: track?.solved, total: track?.total, pointsEarned: track?.pointsEarned, maxPoints: track?.maxPoints,
    }))),
  },
  {
    id: 'weblab',
    title: 'Web Exploit Lab',
    path: '/weblab',
    pitch: 'Bug bounty hunting against safe, simulated sites. Break in with the request inspector.',
    overview: '/weblab/labs',
    summarize: (data) => summary(tracksOf(data).map((track) => ({
      id: track?.id, title: track?.title, difficulty: track?.difficulty,
      solved: track?.solved, total: track?.total, pointsEarned: track?.pointsEarned, maxPoints: track?.points,
    }))),
  },
  {
    id: 'forensics',
    title: 'Forensics Desk',
    path: '/forensics',
    pitch: 'Investigate logs, packets and disk images in four case files, then name the culprit.',
    overview: '/forensics/tracks',
    summarize: (data) => summary(tracksOf(data).map((track) => ({
      id: track?.id, title: track?.caseTitle || track?.title, difficulty: track?.difficulty,
      solved: track?.solved, total: track?.stages, pointsEarned: track?.pointsEarned, maxPoints: track?.maxPoints,
    }))),
  },
  {
    id: 'crackme',
    title: 'Crackme Arcade',
    path: '/reversing',
    pitch: 'Read the assembly of arcade cabinets, step through the debugger and crack their copy protection.',
    overview: '/crackme/overview',
    summarize: (data) => summary(tracksOf(data).map((track) => ({
      id: track?.id, title: track?.title, difficulty: track?.difficulty,
      solved: track?.solved, total: track?.total, pointsEarned: track?.pointsEarned, maxPoints: track?.maxPoints,
    }))),
  },
  {
    id: 'osint',
    title: 'OSINT Trail',
    path: '/osint',
    pitch: 'Investigate a fictional town from its feeds, registries, maps and photos, then name the culprit.',
    overview: '/osint/cases',
    summarize: (data) => summary(tracksOf(data).map((track) => ({
      id: track?.id, title: track?.caseTitle || track?.title, difficulty: track?.difficulty,
      solved: track?.solved, total: track?.questions, pointsEarned: track?.pointsEarned, maxPoints: track?.maxPoints,
    }))),
  },
];
