import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../src/app.js';
import { getCognitoVerifier } from '../src/config/cognito.js';
import User from '../src/models/User.js';

vi.mock('../src/config/cognito.js', () => ({ getCognitoVerifier: vi.fn() }));
vi.mock('../src/models/User.js', () => ({ default: { findOneAndUpdate: vi.fn(), findOne: vi.fn(), exists: vi.fn() } }));

const duplicate = () => Object.assign(new Error('E11000 duplicate key'), { code: 11000, keyPattern: { cognitoSub: 1 } });
let stored;

beforeEach(() => {
  vi.resetAllMocks();
  stored = null;
  getCognitoVerifier.mockReturnValue({
    verify: vi.fn().mockResolvedValue({ sub: 'new-user', email: 'new@example.com', 'cognito:groups': ['player'] }),
  });
  User.exists.mockResolvedValue(null);
});

describe('two parallel first requests of a new user', () => {
  it('both succeed: the loser of the insert race retries and updates the winner document', async () => {
    // Both requests read "no user" before either writes; the second upsert hits the unique cognitoSub index.
    User.findOne.mockResolvedValue(null);
    User.findOneAndUpdate.mockImplementation(async (filter, update) => {
      if (stored && !stored.updated) {
        stored.updated = true;
        throw duplicate();
      }
      stored ??= { _id: '507f1f77bcf86cd799439011', cognitoSub: filter.cognitoSub, teamId: null, ...update.$setOnInsert, ...update.$set };
      return stored;
    });
    const [first, second] = await Promise.all([
      request(app).get('/api/me').set('Authorization', 'Bearer t'),
      request(app).get('/api/me').set('Authorization', 'Bearer t'),
    ]);
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(first.body.id).toBe(second.body.id);
  });

  it('retries a duplicate on the rename path too, and still reports a banned account as 403', async () => {
    User.findOneAndUpdate
      .mockRejectedValueOnce(duplicate())
      .mockResolvedValueOnce({ _id: '507f1f77bcf86cd799439011', email: 'new@example.com', displayName: 'Nova', role: 'player', teamId: null });
    const renamed = await request(app).patch('/api/me').set('Authorization', 'Bearer t').send({ displayName: 'Nova' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.displayName).toBe('Nova');

    User.findOneAndUpdate.mockReset();
    User.findOneAndUpdate.mockRejectedValue(duplicate());
    User.exists.mockResolvedValue({ _id: 'x' });
    const banned = await request(app).patch('/api/me').set('Authorization', 'Bearer t').send({ displayName: 'Nova' });
    expect(banned.status).toBe(403);
    expect(banned.body.error.code).toBe('USER_BANNED');
  });

  it('does not retry unrelated failures or a duplicate on another index', async () => {
    User.findOne.mockResolvedValue(null);
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    User.findOneAndUpdate.mockRejectedValue(Object.assign(new Error('E11000'), { code: 11000, keyPattern: { email: 1 } }));
    const response = await request(app).get('/api/me').set('Authorization', 'Bearer t');
    expect(User.findOneAndUpdate).toHaveBeenCalledTimes(1);
    // Surfaces through the central handler as a conflict, never as a crash.
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('CONFLICT');
  });
});
