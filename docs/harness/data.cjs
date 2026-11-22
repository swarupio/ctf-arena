const now = Date.now();
const iso = (minAgo) => new Date(now - minAgo * 60000).toISOString();
const oid = (n) => String(n).padStart(24, '0');
const teamNames = ['bazooka', 'Demo Alpha', 'Demo Beta', 'Null Pointers', 'The Rustaceans With A Very Long Team', 'Byte Me', 'Stack Smashers', 'Hash Browns'];
const teams = teamNames.map((name, i) => ({ id: oid(100 + i), name }));
const me = { id: oid(1), email: 'player.with.a.rather.long.email.address@example-university.edu', displayName: 'bazooka_player', role: 'player', team: teams[0] };
const challenges = [
  ['Cookie Monster', 'web', 'easy', 100, 'docker'], ['Robots Rule', 'web', 'easy', 100, 'docker'], ['Login Bypass', 'web', 'medium', 200, 'docker'],
  ['Caesar Says', 'crypto', 'easy', 75, 'static'], ['Salted Password', 'crypto', 'hard', 130, 'static'], ['Hidden In Plain Sight', 'forensics', 'medium', 150, 'static'],
].map(([title, category, difficulty, points, type], i) => ({
  id: oid(200 + i), slug: title.toLowerCase().replace(/ /g, '-'), title, category, difficulty, points, type, solveCount: i % 3, solvedByMyTeam: i === 3,
  visible: i !== 5, hasFlag: true, description: 'A short description of the challenge.', attachments: [], image: '', internalPort: 8000,
}));
const instance = { id: oid(300), status: 'running', url: 'http://localhost:40123', expiresAt: new Date(now + 14 * 60000).toISOString(), extended: false };
const detail = (id) => {
  const c = challenges.find((x) => x.id === id) ?? challenges[0];
  return { ...c, description: 'The server stores your session in a cookie. Can you convince it that you are somebody more important?\n\nHint: look at what the browser sends with every request, and think about who decides what is inside it.',
    attachments: [{ name: 'source.zip', url: '/files/source.zip' }, { name: 'a-really-long-attachment-file-name-for-overflow-testing-1234567890.tar.gz', url: '/files/x.tgz' }],
    dockerAvailable: true, myInstance: c.type === 'docker' ? instance : null };
};
const members = [{ id: oid(1), displayName: 'bazooka_player', email: me.email, isCaptain: true }, { id: oid(2), displayName: 'second_member' }];
const teamMe = { id: teams[0].id, name: teams[0].name, inviteCode: 'K7Q9XM', members, score: 340, banned: false };
const board = teams.map((t, i) => ({ rank: i + 1, teamId: t.id, teamName: t.name, points: 340 - i * 40, solves: 5 - Math.floor(i / 2) }));
const timeline = { teams: teams.slice(0, 6).map((t, i) => ({ teamId: t.id, teamName: t.name, points: [0, 1, 2, 3, 4].map((k) => ({ t: iso(600 - k * 100 - i * 7), score: Math.max(0, (k + 1) * (60 - i * 6)) })) })) };
const feed = [['first_blood', 'Demo Alpha', 'Robots Rule'], ['solve', 'bazooka', 'Terminal Easy #3'], ['badge', 'Demo Beta', 'First Flag'], ['team', 'Null Pointers', ''], ['solve', 'bazooka', 'Caesar Says'], ['solve', 'Byte Me', 'Cookie Monster']]
  .map(([type, team, challenge], i) => ({ type, team, challenge, badge: challenge, at: iso(5 + i * 30) }));
const badges = Array.from({ length: 11 }, (_, i) => ({ key: 'b' + i, name: ['First Flag', 'First Blood', 'Streak 3', 'Web Wizard', 'Crypto Cat', 'Forensics Fox', 'Team Player', 'Night Owl', 'Terminal Pro', 'Cipher Lab Hero', 'OSINT Ace'][i], description: 'Earn this badge by playing the game for a while.', icon: 'ABCDEFGHIJK'[i], unlocked: i < 5, awardedAt: iso(i * 600) }));
const playerProfile = { id: me.id, displayName: 'bazooka_player', team: { id: teams[0].id, name: teams[0].name }, solves: 12, firstBloods: 2, streak: { current: 3, best: 5 }, badges,
  recentSolves: [{ category: 'web', difficulty: 'easy', firstBlood: true, solvedAt: iso(30) }, { category: 'crypto', difficulty: 'hard', firstBlood: false, solvedAt: iso(600) }, { category: 'forensics', difficulty: 'medium', firstBlood: false, solvedAt: iso(2000) }] };
const series = Array.from({ length: 14 }, (_, i) => ({ date: new Date(now - (13 - i) * 86400000).toISOString().slice(0, 10), signups: (i * 3) % 7, solves: (i * 5) % 11, submissions: 10 + ((i * 7) % 17), wrongSubmissions: (i * 3) % 9 }));
const chRows = (n) => challenges.slice(0, n).map((c) => ({ id: c.id, title: c.title, category: c.category, difficulty: c.difficulty, points: c.points, solves: 4, solveRate: 0.4, submissions: 20, wrongRate: 0.35 }));
const overview = { totals: { users: 128, bannedUsers: 2, teams: 42, bannedTeams: 1, solves: 311, submissions: 1873, wrongRate: 0.41, activeInstances: 6 }, series, topTeams: board.slice(0, 5).map((t) => ({ id: t.teamId, name: t.teamName, score: t.points })),
  instances: { dockerEnabled: true, active: 6 }, challenges: { hardest: chRows(5), easiest: chRows(5), wrongRates: chRows(6) },
  terminal: { modes: [{ mode: 'easy', codes: 6, teamsPlaying: 12, completions: 4, averageScore: 120.5, maxScore: 300 }, { mode: 'hard', codes: 8, teamsPlaying: 3, completions: 0, averageScore: 40, maxScore: 200 }] } };
const page = (items) => ({ items, total: items.length * 5, page: 1, limit: 25 });
const users = Array.from({ length: 8 }, (_, i) => ({ id: oid(10 + i), displayName: ['alice', 'bob_the_builder_with_a_long_name', 'carol', 'dave', 'erin', 'frank', 'grace', 'heidi'][i], email: `user${i}.has.a.longish.address@example-university.edu`, role: i === 0 ? 'admin' : 'player', banned: i === 3, team: i % 3 === 2 ? null : teams[i % 4], createdAt: iso(i * 5000) }));
const solves = Array.from({ length: 8 }, (_, i) => ({ id: oid(400 + i), solvedAt: iso(i * 90), team: teams[i % 4], user: { id: users[i].id, displayName: users[i].displayName }, challenge: { id: challenges[i % 5].id, title: challenges[i % 5].title }, points: i === 3 ? -50 : 100 + i * 10, firstBlood: i === 1, adjustment: i === 3, reason: 'Manual correction after review' }));
const subs = Array.from({ length: 8 }, (_, i) => ({ id: oid(500 + i), createdAt: iso(i * 20), team: teams[i % 4], user: { id: users[i].id, displayName: users[i].displayName }, challenge: { id: challenges[i % 5].id, title: challenges[i % 5].title }, correct: i % 3 === 0 }));
const adminTeams = teams.map((t, i) => ({ id: t.id, name: t.name, members: 1 + (i % 3), score: 340 - i * 30, solves: 5 - (i % 4), banned: i === 5, lastSolveAt: iso(i * 200), createdAt: iso(i * 9000) }));
const adminChallenges = challenges.map((c) => ({ ...c, solveCount: c.solveCount }));
const integrity = [{ userId: oid(13), displayName: 'dave', teamName: 'Null Pointers', risk: 14, lastSignalAt: iso(40), signals: [{ kind: 'honeypot-endpoint', detail: '/api/internal/debug/flags', severity: 3, count: 4, events: 4, firstAt: iso(500), lastAt: iso(40) }, { kind: 'tainted-flag', detail: '', severity: 2, count: 1, events: 1, firstAt: iso(300), lastAt: iso(300) }] },
  { userId: null, displayName: 'anonymous scrapers', teamName: null, risk: 3, lastSignalAt: iso(900), signals: [{ kind: 'honeypot-endpoint', detail: '/api/internal/config', severity: 1, count: 9, events: 9, firstAt: iso(2000), lastAt: iso(900) }] }];
const instances = Array.from({ length: 5 }, (_, i) => ({ id: oid(600 + i), team: teams[i], challenge: { id: challenges[i].id, title: challenges[i].title }, status: ['running', 'running', 'failed', 'running', 'stopped'][i], port: 40000 + i, url: `http://localhost:${40000 + i}`, expiresAt: new Date(now + (i + 1) * 300000).toISOString(), extended: i % 2 === 0 }));
const audit = Array.from({ length: 6 }, (_, i) => ({ id: oid(700 + i), createdAt: iso(i * 300), actor: { email: 'admin@arena.test' }, action: ['user.ban', 'team.rename', 'settings.update', 'instance.kill', 'solve.delete', 'challenge.update'][i], targetType: 'user', targetId: oid(10 + i), note: i % 2 ? 'Reviewed evidence by an organiser' : '', details: { before: 1, after: 2 } }));
const settings = { registrationOpen: true, submissionsFrozen: false, announcement: { text: 'Maintenance window tonight at 22:00 UTC.', level: 'warning' }, updatedAt: iso(1200) };
const userDetail = { ...users[1], solveCount: 12, submissionCount: 40, terminal: { codesSolved: 3, points: 120, solvedByMode: { easy: 3 }, commandsLast48h: 55, lastCommandAt: iso(20) }, integrity: { signals: 2, events: 5, maxSeverity: 3, lastAt: iso(40) },
  recentSolves: solves.slice(0, 3).map((s) => ({ id: s.id, challenge: s.challenge, points: s.points, firstBlood: s.firstBlood, solvedAt: s.solvedAt })), recentSubmissions: subs.slice(0, 3).map((s) => ({ id: s.id, challenge: s.challenge, correct: s.correct, createdAt: s.createdAt })) };
const teamDetail = { ...adminTeams[0], adjustmentsTotal: -50, activeInstances: 2, members: members.map((m) => ({ ...m, banned: false })), timeline: solves.slice(0, 5).map((s) => ({ ...s })) };

function route(p) {
  if (p === '/me') return me;
  if (p === '/teams/me') return teamMe;
  if (p === '/leaderboard') return board;
  if (p === '/leaderboard/timeline') return timeline;
  if (p.startsWith('/feed')) return feed;
  if (p === '/daily') return { bonusLabel: 'Double fun', challenge: { id: challenges[4].id, title: 'Salted Password', category: 'crypto', difficulty: 'hard', points: 130 } };
  if (p === '/announcement') return { text: '', level: 'info', registrationOpen: true, submissionsFrozen: false };
  if (p === '/challenges') return challenges;
  const m = p.match(/^\/challenges\/(\w+)$/); if (m) return detail(m[1]);
  if (p.startsWith('/players/')) return playerProfile;
  if (p === '/me/achievements') return { badges };
  if (p === '/admin/stats/overview') return overview;
  if (p === '/admin/users') return page(users);
  if (/^\/admin\/users\/\w+$/.test(p)) return userDetail;
  if (p === '/admin/teams') return page(adminTeams);
  if (/^\/admin\/teams\/\w+$/.test(p)) return teamDetail;
  if (p === '/admin/challenges') return page(adminChallenges);
  if (/^\/admin\/challenges\/\w+\/stats$/.test(p)) return { solves: 4, solveRate: 0.4, submissions: 30, wrongSubmissions: 12, wrongRate: 0.4, teamsAttempted: 9, firstBlood: { teamName: 'Demo Alpha', at: iso(900) } };
  if (p === '/admin/solves') return page(solves);
  if (p === '/admin/submissions') return page(subs);
  if (p === '/admin/integrity/summary') return { flaggedUsers: 2, signalRows: 6, signalEvents: 14, activeLast24h: 3, highRiskThreshold: 10, byKind: [{ kind: 'honeypot-endpoint', rows: 3, events: 13, lastAt: iso(40) }, { kind: 'tainted-flag', rows: 1, events: 1, lastAt: iso(300) }] };
  if (p === '/admin/integrity/users') return page(integrity);
  if (p === '/admin/instances') return { ...page(instances), dockerEnabled: true };
  if (p === '/admin/audit') return page(audit);
  if (p === '/admin/settings') return settings;
  return { items: [], total: 0 };
}
module.exports = { route };
