// The ONE place that says what a hint costs. Every value is in points per opened hint and ships at 0 (free).
//
// Changing a number here only changes the line the player reads. Nothing is deducted until the server also charges the
// hint (see docs/HINTS.md, "Adding a cost later"). Do not set a value above 0 before that server change exists, or the
// screen would promise a cost that is never charged.
export const HINT_COSTS = Object.freeze({
  cipherlab: 0,
  crackme: 0,
  osint: 0,
  weblab: 0,
  forensics: 0,
  terminal: 0,
});

export const FREE_LINE = 'Free: no points deducted';

export function hintCost(category, costs = HINT_COSTS) {
  const value = costs[category];
  return Number.isInteger(value) && value > 0 ? value : 0;
}

export function costLine(category, costs = HINT_COSTS) {
  const cost = hintCost(category, costs);
  if (cost === 0) { return FREE_LINE; }
  return `Costs ${cost} ${cost === 1 ? 'point' : 'points'} per hint`;
}
