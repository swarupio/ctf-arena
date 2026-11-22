// Fallback hint prices, a copy of the backend defaults (backend/src/services/hintCost.js DEFAULT_HINT_COSTS).
// The server is the authority: the play screens read `hintPricing` from the level view or GET /api/hint-costs and only
// use these numbers when neither is available. Percentages of the level's base points by the hint's position.
export const DEFAULT_HINT_COSTS = Object.freeze({
  enabled: true,
  nudge: 5,
  approach: 10,
  walkthrough: 25,
  maxPercent: 40,
});

export const FREE_LINE = 'Free: no points deducted';
