const DIFFS = ['easy', 'medium', 'hard', 'insane'];
const TITLES = { easy: 'Rookie Desk', medium: 'Cipher Bureau', hard: 'The Vault Annex', insane: 'Warehouse of Lost ROMs' };
const STORY = {
  easy: 'Warm-up messages from a trainee desk.',
  medium: 'Keys, modular maths and a few stacked tricks that will take a while to untangle properly.',
  hard: 'Stacked puzzles. Every layer hides the next.',
  insane: 'Self-rewriting code, encrypted routines and boards that lie to debuggers. The warehouse offers no hints and no mercy at all.',
};
function track(id, i) {
  const n = [5, 4, 4, 4][i];
  const levels = Array.from({ length: n }, (_, k) => ({
    id: `${id[0]}${k + 1}`, n: k + 1, title: ['Caesar Kitchen', 'Two-Face Cabinet', 'Ghost in the Machine', 'Self-Modifying Cabinet', 'Final Boss: MEGA-ROM'][k], points: 50 + 50 * k + 50 * i,
    boss: k === n - 1, status: i === 0 ? (k < 2 ? 'solved' : k === 2 ? 'open' : 'locked') : i === 1 && k === 0 ? 'open' : 'locked', patched: false,
  }));
  const solved = levels.filter((l) => l.status === 'solved').length;
  return { id, title: TITLES[id], difficulty: id, story: STORY[id], solved, total: n, pointsEarned: solved * 50, maxPoints: levels.reduce((s, l) => s + l.points, 0), hintsAllowed: id !== 'insane', complete: false, speedrun: i === 0 ? { ms: 91000, badge: 'gold' } : null, levels };
}
const tracks = DIFFS.map((d, i) => track(d, i));
const overview = {
  solved: 2, total: 17, pointsEarned: 100, maxPoints: 3000, streak: 3, tracks,
  toolbox: [{ id: 'freq', name: 'Frequency chart', description: 'Count letters.', unlocked: true, unlockedBy: 'e1' }, { id: 'xor', name: 'XOR tool', description: 'XOR bytes.', unlocked: false, unlockedBy: 'm2' }, { id: 'vig', name: 'Vigenere', description: 'Try keys.', unlocked: false, unlockedBy: 'h1' }],
};
const forensics = DIFFS.map((d, i) => ({ id: d, difficulty: d, caseTitle: ['The Missing Laptop', 'Night Shift', 'Ghost Packets', 'Eyes Only'][i], title: TITLES[d], tagline: ['A trainee first log.', 'Who touched the server at 3am and why was it left on, the whole night through?', 'Packets that should not exist.', 'A mystery with decoys everywhere.'][i], stages: [3, 4, 5, 6][i], solved: i === 0 ? 2 : 0, pointsEarned: i === 0 ? 100 : 0, maxPoints: [150, 300, 500, 800][i], hints: i < 3 }));
const osint = DIFFS.map((d, i) => ({ id: d, difficulty: d, caseTitle: ['Lost Dog Lane', 'The Registry Gap', 'Harbour Photos', 'Eyes on Brightwater'][i], tagline: ['Find who posted the notice.', 'Cross-check the company registry against the feed and find the missing director.', 'Identify the harbour from three photos.', 'Name the culprit.'][i], questions: [4, 5, 6, 7][i], solved: i === 0 ? 4 : 0, pointsEarned: i === 0 ? 200 : 0, maxPoints: [200, 350, 500, 900][i], hints: i < 3 }));
const modes = ['easy', 'medium', 'hard'].map((m, i) => ({ mode: m, title: ['Guest Shell', 'Staff Box', 'Root Vault'][i], tagline: ['Poke around a friendly box.', 'Find the codes in a messy home directory.', 'No one gets root by accident.'][i], difficulty: m, codes: [6, 8, 10][i], solved: i === 0 ? 3 : 0, points: [300, 600, 1000][i], pointsEarned: i === 0 ? 150 : 0, lore: ['You log in as guest.', 'The admin left in a hurry.'] }));
const weblab = {
  totals: { solved: 1, labs: 10, pointsEarned: 100, points: 1500, bountyUsd: 500 }, inspector: { level: 1, features: ['a', 'b', 'c', 'd'], next: { label: 'Cookie view', solvesNeeded: 2 } },
  tracks: [['retro-bank', 'easy', 'Retro Bank', 3], ['pizza', 'medium', 'Pizza Palace', 3], ['hospital', 'hard', 'Mercy Hospital', 2], ['vault', 'insane', 'Vault Corp', 2]].map(([theme, id, name, n], i) => ({
    id, title: id, theme, company: { name, brief: 'A short brief about ' + name + (i === 1 ? ' and a longer description that wraps across a couple of lines on narrow cards.' : '.') }, cleared: false, points: n * 150, pointsEarned: i === 0 ? 100 : 0, solved: i === 0 ? 1 : 0, total: n,
    labs: Array.from({ length: n }, (_, k) => ({ id: id + k, slug: id + k, title: ['Cookie Tamper', 'Robots Rule Everything', 'Login Bypass'][k], summary: ['Change the cookie.', 'Read the robots file and follow what it hides from the crawlers.', 'Skip the login.'][k], boss: k === n - 1 && n > 2, points: 100 + 50 * k, pointsEarned: 0, solved: i === 0 && k === 0, locked: i > 0 && k > 0, available: true, lockedReason: 'Clear the previous lab first.', hintCount: i === 3 ? 0 : 2, severity: 'high', bountyUsd: 500 })),
  })),
};
const challenges = [
  ['Cookie Monster', 100, 'easy', 'docker', 'web', 1], ['Robots Rule', 100, 'easy', 'docker', 'web', 1], ['Login Bypass', 200, 'medium', 'docker', 'web', 0],
  ['Caesar Says', 75, 'easy', 'static', 'crypto', 1], ['Hidden Layer', 150, 'medium', 'static', 'forensics', 0], ['Stack Smash', 300, 'hard', 'docker', 'pwn', 0], ['Warmup', 25, 'easy', 'static', 'misc', 4],
  ['Term code 1', 50, 'easy', 'terminal', 'terminal', 1],
].map(([title, points, difficulty, type, category, solveCount], i) => ({ id: 'c' + i, title, points, difficulty, type, category, solveCount, solvedByMyTeam: i === 3 }));
module.exports = { '/cipherlab/overview': overview, '/crackme/overview': overview, '/forensics/tracks': forensics, '/osint/cases': osint, '/terminal/modes': modes, '/weblab/labs': weblab, '/challenges': challenges };
