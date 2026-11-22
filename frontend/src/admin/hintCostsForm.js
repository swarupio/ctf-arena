// Form logic of the "Hint costs" panel in admin Settings. Pure functions, no React.
// Mirrors backend/src/services/hintCost.js (the server is the authority; this only previews and validates).
export const HINT_COST_FIELDS = ['nudge', 'approach', 'walkthrough', 'maxPercent'];
export const HINT_COST_LABELS = {
  nudge: 'Nudge (1st hint)',
  approach: 'Approach (2nd hint)',
  walkthrough: 'Walkthrough (3rd hint and later)',
  maxPercent: 'Cap per level',
};
export const PREVIEW_BASES = [10, 50, 100, 300];

export const HINT_COST_DEFAULTS = Object.freeze({
  enabled: true, nudge: 5, approach: 10, walkthrough: 25, maxPercent: 40,
});
export const FREE_HINTS = Object.freeze({
  enabled: true, nudge: 0, approach: 0, walkthrough: 0, maxPercent: 0,
});

const isWhole = (value) => /^\d{1,3}$/.test(String(value).trim()) && Number(value) <= 100;

// Saved settings (always a complete object from the API; defaults when something is missing) -> draft. Inputs hold text.
export function costsToDraft(saved) {
  const draft = { enabled: typeof saved?.enabled === 'boolean' ? saved.enabled : HINT_COST_DEFAULTS.enabled };
  for (const field of HINT_COST_FIELDS) {
    const value = saved?.[field];
    draft[field] = String(Number.isInteger(value) && value >= 0 && value <= 100 ? value : HINT_COST_DEFAULTS[field]);
  }
  return draft;
}

// { field: message }; empty when the draft can be saved. Percentages are whole numbers from 0 to 100.
export function validateCostsDraft(draft) {
  const errors = {};
  for (const field of HINT_COST_FIELDS) {
    const text = String(draft[field] ?? '').trim();
    if (text === '') errors[field] = 'Enter a number from 0 to 100.';
    else if (!isWhole(text)) errors[field] = 'Use a whole number from 0 to 100.';
  }
  return errors;
}

// PUT body for a valid draft.
export function costsBody(draft) {
  return {
    hintCosts: {
      enabled: Boolean(draft.enabled),
      nudge: Number(draft.nudge),
      approach: Number(draft.approach),
      walkthrough: Number(draft.walkthrough),
      maxPercent: Number(draft.maxPercent),
    },
  };
}

// True when the draft differs from what is saved.
export function costsDirty(saved, draft) {
  const base = costsToDraft(saved);
  return base.enabled !== Boolean(draft.enabled)
    || HINT_COST_FIELDS.some((field) => base[field] !== String(draft[field]).trim());
}

// Draft for a preset ({ enabled, nudge, ... } numbers).
export const presetDraft = (preset) => costsToDraft(preset);

// Same rules as the server: round(base * percent / 100), at least 1 when the percent is > 0 and the level is worth >= 10.
export function hintPoints(base, percent) {
  if (!(base > 0) || !(percent > 0)) return 0;
  const points = Math.round((base * percent) / 100);
  return points < 1 && base >= 10 ? 1 : points;
}

// One row per example level: points of each tier, the cap and the net when all three tiers are opened. A row with an
// invalid draft has nulls (the table shows dashes).
export function previewRows(draft, bases = PREVIEW_BASES) {
  const valid = Object.keys(validateCostsDraft(draft)).length === 0;
  return bases.map((base) => {
    if (!valid) return { base, nudge: null, approach: null, walkthrough: null, cap: null, spent: null, net: null };
    const enabled = Boolean(draft.enabled);
    const tier = (field) => (enabled ? hintPoints(base, Number(draft[field])) : 0);
    const nudge = tier('nudge');
    const approach = tier('approach');
    const walkthrough = tier('walkthrough');
    const cap = enabled ? Math.round((base * Number(draft.maxPercent)) / 100) : 0;
    const spent = Math.min(nudge + approach + walkthrough, cap);
    return { base, nudge, approach, walkthrough, cap, spent, net: Math.max(1, base - spent) };
  });
}

export const isFreeDraft = (draft) => !draft.enabled
  || ['nudge', 'approach', 'walkthrough'].every((field) => Number(draft[field]) === 0)
  || Number(draft.maxPercent) === 0;
