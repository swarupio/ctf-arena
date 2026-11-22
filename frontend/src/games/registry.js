import { normalizeModes } from '../terminal/adapters.js';
import { normalizeTrack } from './progress.js';

// Every category on The Range hub. To add one, append an entry:
//   id        unique key
//   title     card heading
//   path      the category's route (also the Open button target)
//   pitch     one line shown on the card
//   overview  GET path (relative to /api) whose answer lists the category's tracks
//   summarize (data) => { tracks: [{ id, title, difficulty, solved, total, pointsEarned, maxPoints }] }
// Categories that are not installed simply have no entry, so they never show a card.

const tracksOf = (data) => (Array.isArray(data) ? data : Array.isArray(data?.tracks) ? data.tracks : []);
const summary = (tracks) => ({ tracks: tracks.map(normalizeTrack) });

export const GAMES = [
  {
    id: 'terminal',
    title: 'Arena Terminal',
    path: '/terminal',
    pitch: 'Shell puzzles in a simulated Unix box. Dig through files and capture the hidden flags.',
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
    pitch: 'Cryptography. Break coded messages with a growing toolbox, from rookie desk to the Black Chamber.',
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
    pitch: 'Web vulnerabilities. Exploit safe, simulated sites with the request inspector.',
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
    pitch: 'Case files. Investigate logs, packets and disk images, then name the culprit.',
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
    pitch: 'Reverse engineering. Read the assembly, step through the debugger and crack the copy protection.',
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
    pitch: 'Open-source intelligence. Trace a fictional town through its feeds, registries, maps and photos.',
    overview: '/osint/cases',
    summarize: (data) => summary(tracksOf(data).map((track) => ({
      id: track?.id, title: track?.caseTitle || track?.title, difficulty: track?.difficulty,
      solved: track?.solved, total: track?.questions, pointsEarned: track?.pointsEarned, maxPoints: track?.maxPoints,
    }))),
  },
];
