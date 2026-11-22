// In-memory stand-in for the HintOpen model (services/hintLedger.js uses updateOne with upsert and find(...).lean()).
// Use with: vi.mock('../../src/models/HintOpen.js', () => ({ default: { updateOne: vi.fn(), find: vi.fn() } }))
// and call installHintOpen(HintOpen) in beforeEach after vi.resetAllMocks(). Returns the array of stored rows.
export function installHintOpen(HintOpen) {
  const rows = [];
  const same = (row, filter) => ['teamId', 'scope', 'key', 'index'].every((field) => String(row[field]) === String(filter[field]));
  HintOpen.updateOne.mockImplementation(async (filter, update) => {
    if (rows.some((row) => same(row, filter))) { return { upsertedCount: 0 }; }
    rows.push({ ...filter, ...update.$setOnInsert, createdAt: new Date() });
    return { upsertedCount: 1 };
  });
  HintOpen.find.mockImplementation((filter) => ({
    lean: async () => rows.filter((row) => ['teamId', 'scope', 'key'].every((field) => String(row[field]) === String(filter[field]))),
  }));
  return rows;
}
