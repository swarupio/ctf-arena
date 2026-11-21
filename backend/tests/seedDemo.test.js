import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/models/Challenge.js', () => ({ default: { find: vi.fn(), updateOne: vi.fn() } }));
vi.mock('../src/models/Solve.js', () => ({
  default: { deleteMany: vi.fn(), exists: vi.fn(), create: vi.fn(), countDocuments: vi.fn() },
}));
vi.mock('../src/models/Team.js', () => ({ default: { countDocuments: vi.fn() } }));

const { default: Challenge } = await import('../src/models/Challenge.js');
const { default: Solve } = await import('../src/models/Solve.js');
const { default: Team } = await import('../src/models/Team.js');
const { plan, seedDemoSolves } = await import('../src/scripts/seedDemo.js');
const { fixtures } = await import('../src/scripts/seed.js');

const challenges = [...new Set(plan.map(([, slug]) => slug))].map((slug, index) => ({ _id: `c${index}`, slug, points: 100 }));

beforeEach(() => {
  vi.clearAllMocks();
  Challenge.find.mockResolvedValue(challenges);
  Solve.exists.mockResolvedValue(null);
  Solve.countDocuments.mockResolvedValue(0);
});

describe('seedDemoSolves', () => {
  it('refuses to add solves when the demo teams do not exist yet, and changes nothing', async () => {
    Team.countDocuments.mockResolvedValue(0);
    await expect(seedDemoSolves()).rejects.toThrow(/Run npm run seed first/);
    expect(Solve.deleteMany).not.toHaveBeenCalled();
    expect(Solve.create).not.toHaveBeenCalled();
  });

  it('adds the planned solves when the demo teams exist, replacing earlier ones (repeatable)', async () => {
    Team.countDocuments.mockResolvedValue(fixtures.length);
    await seedDemoSolves();
    await seedDemoSolves();
    expect(Solve.deleteMany).toHaveBeenCalledTimes(2);
    expect(Solve.create).toHaveBeenCalledTimes(plan.length * 2);
  });

  it('--reset only removes solves, even without the demo teams', async () => {
    Team.countDocuments.mockResolvedValue(0);
    Challenge.find.mockResolvedValue([]);
    await seedDemoSolves({ reset: true });
    expect(Solve.deleteMany).toHaveBeenCalledTimes(1);
    expect(Solve.create).not.toHaveBeenCalled();
  });
});
