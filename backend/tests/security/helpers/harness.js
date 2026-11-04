// Shared setup for the security tests: fake identities (ID-token claims), a seeded two-team world on top of the
// in-memory fake database, and small request helpers. Each test file registers the vi.mock calls itself (vitest
// hoists them per file) and points them at the factories exported here.
import request from 'supertest';
import { vi } from 'vitest';
import { env } from '../../../src/config/env.js';
import { expectedFlagFor, hashStaticFlag } from '../../../src/services/flagService.js';
import { MODES } from '../../../src/terminal/modes/index.js';
import { database, models } from './fakeDb.js';

// ---- identities -------------------------------------------------------------------------------------------------
const claims = (sub, groups, extra = {}) => ({
  sub, email: `${sub}@example.com`, ...(groups === undefined ? {} : { 'cognito:groups': groups }), ...extra,
});

// Token string -> claims the (mocked) Cognito verifier returns. Anything not listed is an invalid token.
export const TOKENS = {
  alice: claims('alice', ['player']),
  alice2: claims('alice2', ['player']),
  bob: claims('bob', ['player']),
  carol: claims('carol', ['player']), // player without a team
  dave: claims('dave', ['player']), // member of the team that tests ban
  eve: claims('eve', ['player']), // valid token, never seen by the API before (no database row)
  admin: claims('admin', ['admin']),
  // Role derivation must be an exact match on the group name `admin`.
  'groups-none': claims('groups-none'),
  'groups-empty': claims('groups-empty', []),
  'groups-admin-upper': claims('g-upper', ['Admin']),
  'groups-admin-padded': claims('g-padded', [' admin']),
  'groups-admin-suffix': claims('g-suffix', ['admin-readonly']),
  'groups-admin-prefix': claims('g-prefix', ['superadmin']),
  'groups-admin-substring': claims('g-sub', ['administrators']),
  'groups-player-and-admin': claims('g-both', ['player', 'admin']),
  // Malformed claim sets: all must be 401, never a crash or a privilege.
  'groups-as-string': claims('g-string', 'admin'),
  'groups-with-objects': claims('g-objects', [{ admin: true }]),
  'no-email': { sub: 'no-email', 'cognito:groups': ['player'] },
  'bad-email': claims('bad-email', ['player'], { email: 'not-an-email' }),
  'no-sub': { email: 'nosub@example.com', 'cognito:groups': ['player'] },
  'empty-sub': claims('', ['player']),
  // Same address as alice in another case, but a different Cognito identity: must not see alice's data.
  mallory: claims('mallory', ['player'], { email: 'ALICE@EXAMPLE.COM' }),
};

export const verify = vi.fn(async (token) => {
  const found = TOKENS[token];
  // expired, wrong audience, wrong token_use, bad signature and garbage all look the same to the middleware: a throw.
  if (!found) { throw new Error('Token is not valid'); }
  return structuredClone(found);
});

// For: vi.mock('../../src/config/cognito.js', async () => (await import('./helpers/harness.js')).cognitoModule())
export const cognitoModule = () => ({ getCognitoVerifier: () => ({ verify }) });

// The terminal engine is another module's job; here it is a probe that prints the team's flag 1 so tests can see
// whose flag the server derived. For: vi.mock('../../src/terminal/shell.js', async () => (await import(...)).shellModule())
export const shellModule = () => ({
  execute: vi.fn(async (command, ctx) => ({ output: `ran: ${command}\n${ctx.flag(1)}`, cwd: ctx.cwd, exit: 0 })),
  complete: vi.fn(async () => ['alpha', 'beta']),
});

// ---- the world --------------------------------------------------------------------------------------------------
export const secret = env.FLAG_SECRET;
export const STATIC_FLAG = 'CTF{welcome_to_the_arena}';
export const HIDDEN_FLAG = 'CTF{hidden_flag_never_shown}';

export const world = { users: {}, teams: {}, challenges: {}, terminal: {} };

const capital = (text) => text[0].toUpperCase() + text.slice(1);

// Two real teams (Alpha: alice, alice2; Bravo: bob), a third one for ban tests (Charlie: dave), a team-less player,
// an admin with a database row, five docker challenges, a static one, a hidden one and the terminal codes.
export function seedWorld() {
  database.reset();
  const { User, Team, Challenge, Solve } = models;
  const addUser = (key, role = 'player') => {
    world.users[key] = User.insertRaw({ cognitoSub: key, email: `${key}@example.com`, displayName: key, role });
  };
  ['alice', 'alice2', 'bob', 'carol', 'dave'].forEach((key) => addUser(key));
  addUser('admin', 'admin');

  const addTeam = (key, name, inviteCode, members) => {
    world.teams[key] = Team.insertRaw({
      name, inviteCode, captainId: world.users[members[0]]._id, memberIds: members.map((m) => world.users[m]._id),
    });
    for (const member of members) { User.docs.get(world.users[member]._id).teamId = world.teams[key]._id; }
  };
  addTeam('A', 'Team Alpha', 'ALPHA2', ['alice', 'alice2']);
  addTeam('B', 'Team Bravo', 'BRAVE3', ['bob']);
  addTeam('C', 'Team Charlie', 'CHARL4', ['dave']);

  world.challenges.static = Challenge.insertRaw({
    slug: 'sanity-check', title: 'Sanity Check', category: 'misc', difficulty: 'easy', points: 25, type: 'static',
    description: 'Welcome.', attachments: [{ name: 'a.txt', url: '/files/a.txt' }], ...hashStaticFlag(STATIC_FLAG),
  });
  world.challenges.hidden = Challenge.insertRaw({
    slug: 'hidden-trap', title: 'Hidden Trap', category: 'misc', difficulty: 'easy', points: 50, type: 'static',
    description: 'Not published yet.', visible: false, ...hashStaticFlag(HIDDEN_FLAG),
  });
  const dockers = ['cookie-monster', 'login-bypass', 'robots-rule', 'jwt-none', 'sql-lite'];
  dockers.forEach((slug, index) => {
    world.challenges[`docker${index + 1}`] = Challenge.insertRaw({
      slug, title: capital(slug.replaceAll('-', ' ')), category: 'web', difficulty: 'easy', points: 100, type: 'docker',
      image: `ctf/${slug}`, internalPort: 8000 + index, description: `Docker challenge ${slug}.`,
    });
  });
  for (const mode of Object.keys(MODES)) {
    world.terminal[mode] = MODES[mode].codes.map((code) => Challenge.insertRaw({
      slug: `terminal-${mode}-${code.n}`, title: `Terminal ${capital(mode)} #${code.n}`, category: 'terminal',
      type: 'terminal', difficulty: mode, points: code.points, terminal: { mode, code: code.n },
    }));
  }

  const solve = (team, challenge, points, firstBlood = false) => Solve.insertRaw({
    teamId: world.teams[team]._id, challengeId: world.challenges[challenge]._id, userId: world.users.alice._id,
    points, firstBlood, solvedAt: new Date('2026-11-01T10:00:00Z'),
  });
  solve('A', 'static', 27, true);
  solve('B', 'docker1', 110, true);
  return world;
}

// The flag a team would legitimately hold for a challenge document of the world.
export const flagOf = (challenge, teamKey) => expectedFlagFor(challenge, { secret, teamId: world.teams[teamKey]._id });
export const terminalFlagOf = (mode, code, teamKey) => flagOf(world.terminal[mode][code - 1], teamKey);

// ---- requests ---------------------------------------------------------------------------------------------------
let appPromise;
export function getApp() {
  appPromise ??= import('../../../src/app.js').then((module) => module.default);
  return appPromise;
}

// Resolves to the supertest response (it never rejects on 4xx/5xx). `token` null/undefined sends no Authorization header.
export async function call(method, path, token, body, headers = {}) {
  const app = await getApp();
  let req = request(app)[method](path);
  if (token !== undefined && token !== null) { req = req.set('Authorization', `Bearer ${token}`); }
  for (const [name, value] of Object.entries(headers)) { req = req.set(name, value); }
  return body === undefined ? req : req.send(body);
}
