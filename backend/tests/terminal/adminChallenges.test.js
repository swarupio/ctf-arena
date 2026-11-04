import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../../src/app.js';
import { getCognitoVerifier } from '../../src/config/cognito.js';
import Challenge from '../../src/models/Challenge.js';
import { hashStaticFlag } from '../../src/services/flagService.js';

vi.mock('../../src/config/cognito.js', () => ({ getCognitoVerifier: vi.fn() }));
vi.mock('../../src/models/Challenge.js', () => ({
  default: { find: vi.fn(), findOne: vi.fn(), findById: vi.fn(), create: vi.fn(), findOneAndUpdate: vi.fn(), deleteOne: vi.fn() },
}));
vi.mock('../../src/services/instanceService.js', () => ({
  instanceService: { start: vi.fn(), stop: vi.fn(), extend: vi.fn(), stopTeamChallenge: vi.fn(), stopChallengeInstances: vi.fn() },
  serializeInstance: (i) => ({ id: String(i._id) }),
}));

const oid = (n) => String(n).padStart(24, '0');
const api = (method, path, sub = 'admin', body) => {
  const call = request(app)[method](`/api${path}`).set('Authorization', `Bearer ${sub}`);
  return body === undefined ? call : call.send(body);
};

const terminalDoc = {
  _id: oid(40), slug: 'terminal-easy-1', title: 'Terminal Easy #1', description: 'A hidden code.', category: 'terminal',
  difficulty: 'easy', points: 40, type: 'terminal', terminal: { mode: 'easy', code: 1 }, attachments: [], visible: true, solveCount: 2,
};
const staticStored = hashStaticFlag('CTF{static_one}');
const staticDoc = {
  _id: oid(10), slug: 'sanity-check', title: 'Sanity', description: 'hi', category: 'misc', difficulty: 'easy', points: 25,
  type: 'static', attachments: [], visible: true, solveCount: 3, ...staticStored,
};
// What the admin UI sends back: the whole challenge with its edits.
const terminalBody = {
  slug: 'terminal-easy-1', title: 'Terminal Easy #1', description: 'A hidden code.', category: 'terminal', difficulty: 'easy',
  points: 50, type: 'terminal', visible: false,
};
const staticBody = {
  slug: 'sanity-check', title: 'Sanity Check', category: 'misc', difficulty: 'easy', points: 25, type: 'static', flag: 'CTF{welcome_to_the_arena}',
};

beforeEach(() => {
  vi.resetAllMocks();
  getCognitoVerifier.mockReturnValue({
    verify: vi.fn(async (sub) => ({ sub, email: `${sub}@example.com`, 'cognito:groups': [sub === 'admin' ? 'admin' : 'player'] })),
  });
  Challenge.findById.mockResolvedValue(terminalDoc);
  Challenge.findOneAndUpdate.mockImplementation(async (filter, update) => ({ ...terminalDoc, ...update.$set }));
});

describe('admin challenges and terminal challenges', () => {
  it('lists terminal challenges with their mode and code and no flag material', async () => {
    const stray = { ...terminalDoc, _id: oid(41), slug: 'terminal-easy-9', terminal: undefined }; // a malformed row must not crash the list
    Challenge.find.mockReturnValue({ sort: vi.fn().mockResolvedValue([staticDoc, terminalDoc, stray]) });
    const { body } = await api('get', '/admin/challenges').expect(200);
    expect(body[1]).toMatchObject({
      id: oid(40), slug: 'terminal-easy-1', type: 'terminal', category: 'terminal', points: 40, hasFlag: false,
      terminal: { mode: 'easy', code: 1 }, visible: true, solveCount: 2,
    });
    expect(body[0]).toMatchObject({ type: 'static', hasFlag: true, terminal: null });
    expect(body[2].terminal).toBeNull();
    const text = JSON.stringify(body);
    for (const field of ['flag"', 'flagHash', 'flagSalt', staticStored.flagHash]) { expect(text).not.toContain(field); }
  });

  it('cannot create terminal challenges (type or category terminal) through the API', async () => {
    await api('post', '/admin/challenges', 'admin', terminalBody).expect(400);
    await api('post', '/admin/challenges', 'admin', { ...staticBody, category: 'terminal' }).expect(400);
    await api('post', '/admin/challenges', 'admin', {
      ...staticBody, category: 'terminal', type: 'docker', image: 'ctf/x', internalPort: 80,
    }).expect(400);
    const { body } = await api('post', '/admin/challenges', 'admin', { ...terminalBody, flag: 'CTF{x}' }).expect(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(Challenge.create).not.toHaveBeenCalled();
  });

  it('lets an admin edit points and visibility of a terminal challenge without storing any flag', async () => {
    const { body } = await api('put', `/admin/challenges/${terminalDoc._id}`, 'admin', terminalBody).expect(200);
    expect(body).toMatchObject({ points: 50, visible: false, type: 'terminal', hasFlag: false, terminal: { mode: 'easy', code: 1 }, solveCount: 2 });
    const [filter, update] = Challenge.findOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({ _id: terminalDoc._id });
    expect(update.$set).toMatchObject({ points: 50, visible: false, type: 'terminal', category: 'terminal' });
    // The mode and code of a terminal challenge are not editable and no flag fields are written.
    for (const key of ['terminal', 'flagHash', 'flagSalt', 'flag', 'image', 'internalPort']) { expect(update.$set).not.toHaveProperty(key); }
    expect(Object.keys(update.$unset).sort()).toEqual(['flagHash', 'flagSalt', 'image', 'internalPort']);
    expect(JSON.stringify(body)).not.toContain('flagHash');
  });

  it('keeps the slug, the type and the category of a terminal challenge fixed', async () => {
    const put = (body) => api('put', `/admin/challenges/${terminalDoc._id}`, 'admin', body);
    await put({ ...terminalBody, slug: 'terminal-easy-2' }).expect(400);
    await put({ ...terminalBody, type: 'static', category: 'terminal', flag: 'CTF{x}' }).expect(400);
    await put({ ...terminalBody, type: 'static', category: 'misc', flag: 'CTF{x}' }).expect(400);
    await put({ ...terminalBody, category: 'misc' }).expect(400);
    await put({ ...terminalBody, type: 'docker', image: 'ctf/x', internalPort: 80 }).expect(400);
    await put({ ...terminalBody, flag: 'CTF{x}' }).expect(400);
    await put({ ...terminalBody, extra: true }).expect(400);
    expect(Challenge.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('refuses to turn an ordinary challenge into a terminal one', async () => {
    Challenge.findById.mockResolvedValue(staticDoc);
    const { body } = await api('put', `/admin/challenges/${staticDoc._id}`, 'admin', { ...terminalBody, slug: 'sanity-check' }).expect(400);
    expect(body.error.message).toContain('terminal');
    expect(Challenge.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('still updates ordinary static and docker challenges as before', async () => {
    Challenge.findById.mockResolvedValue(staticDoc);
    Challenge.findOneAndUpdate.mockImplementation(async (filter, update) => ({ ...staticDoc, ...update.$set }));
    const { flag, ...noFlag } = staticBody;
    await api('put', `/admin/challenges/${staticDoc._id}`, 'admin', { ...noFlag, points: 60 }).expect(200);
    const [, update] = Challenge.findOneAndUpdate.mock.calls[0];
    expect(update.$set.flagHash).toBeUndefined();
    expect(Object.keys(update.$unset).sort()).toEqual(['image', 'internalPort']);
    Challenge.findOneAndUpdate.mockClear();
    Challenge.findById.mockResolvedValue({ ...staticDoc, type: 'docker' });
    await api('put', `/admin/challenges/${staticDoc._id}`, 'admin', {
      ...noFlag, type: 'docker', image: 'ctf/cookie-monster', internalPort: 8000,
    }).expect(200);
    expect(Object.keys(Challenge.findOneAndUpdate.mock.calls[0][1].$unset).sort()).toEqual(['flagHash', 'flagSalt']);
  });

  it('deletes a terminal challenge like any other', async () => {
    Challenge.deleteOne.mockResolvedValue({});
    await api('delete', `/admin/challenges/${terminalDoc._id}`, 'admin').expect(204);
    expect(Challenge.deleteOne).toHaveBeenCalledWith({ _id: terminalDoc._id });
  });

  it('stays admin-only', async () => {
    await api('put', `/admin/challenges/${terminalDoc._id}`, 'player', terminalBody).expect(403);
    expect(Challenge.findById).not.toHaveBeenCalled();
  });
});
