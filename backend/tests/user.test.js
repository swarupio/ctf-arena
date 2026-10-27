import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import User from '../src/models/User.js';

describe('User schema (without a database connection)', () => {
  it('defines the unique identity index and timestamps', () => {
    expect(User.schema.indexes()).toEqual(expect.arrayContaining([
      [{ cognitoSub: 1 }, expect.objectContaining({ unique: true })],
    ]));
    expect(User.schema.options.timestamps).toBe(true);
    expect(User.schema.path('createdAt').instance).toBe('Date');
    expect(User.schema.path('updatedAt').instance).toBe('Date');
  });

  it('defaults the display name from email and permits a null or ObjectId team', () => {
    const user = new User({ cognitoSub: 'sub', email: 'alice@example.com', role: 'player' });
    expect(user.validateSync()).toBeUndefined();
    expect(user.displayName).toBe('alice');
    expect(user.teamId).toBeNull();
    user.teamId = new mongoose.Types.ObjectId();
    expect(user.validateSync()).toBeUndefined();
  });

  it('only permits player and admin roles', () => {
    const user = new User({ cognitoSub: 'sub', email: 'alice@example.com', role: 'owner' });
    expect(user.validateSync().errors.role).toBeDefined();
    user.role = 'admin';
    expect(user.validateSync()).toBeUndefined();
  });
});
