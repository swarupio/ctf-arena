import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import Team from '../src/models/Team.js';

function team(fields = {}) {
  const captainId = new mongoose.Types.ObjectId();
  return new Team({ name: 'Team Alpha', inviteCode: 'ABCDEF', captainId, memberIds: [captainId], ...fields });
}

describe('Team schema without a database', () => {
  it('has a case-insensitive unique name index and a unique invite-code index', () => {
    expect(Team.schema.indexes()).toEqual(expect.arrayContaining([
      [{ name: 1 }, expect.objectContaining({ unique: true, collation: { locale: 'en', strength: 2 } })],
      [{ inviteCode: 1 }, expect.objectContaining({ unique: true })],
    ]));
  });

  it('defaults banned to false and tracks only createdAt', () => {
    expect(team().banned).toBe(false);
    expect(Team.schema.path('createdAt').instance).toBe('Date');
    expect(Team.schema.path('updatedAt')).toBeUndefined();
    expect(team().validateSync()).toBeUndefined();
  });

  it('rejects more than three members', () => {
    const members = Array.from({ length: 4 }, () => new mongoose.Types.ObjectId());
    expect(team({ memberIds: members }).validateSync().errors.memberIds).toBeDefined();
    expect(team({ memberIds: members.slice(0, 3) }).validateSync()).toBeUndefined();
  });

  it.each(['abcdef', 'ABCD', 'ABCDEF7', 'OOOOOO', '111111'])('rejects invalid invite code %s', (inviteCode) => {
    expect(team({ inviteCode }).validateSync().errors.inviteCode).toBeDefined();
  });
});
