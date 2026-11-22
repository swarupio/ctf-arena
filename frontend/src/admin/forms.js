// Form logic of the admin sections: challenge form, score adjustment, settings, typed confirmation.
// Client-side checks only help the admin; the API validates everything again.

export const CATEGORIES = ['web', 'crypto', 'forensics', 'misc', 'pwn'];
export const DIFFICULTIES = ['easy', 'medium', 'hard'];
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// Types the API refuses to edit through the form: terminal challenges are seeded, `game` ones belong to their category.
export const READ_ONLY_TYPES = ['terminal', 'game'];
export const isReadOnlyType = (type) => READ_ONLY_TYPES.includes(type);

export function readOnlyNote(type) {
  if (type === 'terminal') {
    return 'Arena Terminal challenges are created by the seed script. Only points, title, visibility and similar fields can be changed through the API, '
      + 'and never the slug, type or flag, so the form is read-only. Use the publish/hide toggle for visibility.';
  }
  if (type === 'game') return 'Range challenges are managed by their category, so the API rejects edits from the form. Use the publish/hide toggle for visibility.';
  return '';
}

export const EMPTY_CHALLENGE = {
  slug: '', title: '', category: 'web', difficulty: 'easy', points: 100, description: '',
  type: 'static', image: '', internalPort: 8000, flag: '', visible: true, attachments: '',
};

// "name | /path" per line <-> [{ name, url }]
export function parseAttachments(text) {
  return String(text ?? '').split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
    const cut = line.indexOf('|');
    return cut === -1
      ? { name: line.split('/').pop() || line, url: line }
      : { name: line.slice(0, cut).trim(), url: line.slice(cut + 1).trim() };
  });
}

export const formatAttachments = (list) => (Array.isArray(list) ? list : []).map((item) => `${item.name} | ${item.url}`).join('\n');

export const challengeToForm = (challenge) => ({
  ...EMPTY_CHALLENGE,
  slug: challenge.slug ?? '',
  title: challenge.title ?? '',
  category: challenge.category ?? 'web',
  difficulty: challenge.difficulty ?? 'easy',
  points: challenge.points ?? 100,
  description: challenge.description ?? '',
  type: challenge.type ?? 'static',
  image: challenge.image ?? '',
  internalPort: challenge.internalPort ?? 8000,
  visible: challenge.visible !== false,
  attachments: formatAttachments(challenge.attachments),
  flag: '',
});

// Form -> request body. The flag is only sent when typed (an empty flag on edit keeps the stored one).
export function challengeBody(form) {
  const body = {
    slug: form.slug.trim(), title: form.title.trim(), category: form.category, difficulty: form.difficulty,
    points: Number(form.points), description: form.description, type: form.type, visible: Boolean(form.visible),
    attachments: parseAttachments(form.attachments),
  };
  if (form.type === 'docker') {
    body.image = form.image.trim();
    body.internalPort = Number(form.internalPort);
  } else if (form.flag.trim()) {
    body.flag = form.flag.trim();
  }
  return body;
}

// { field: message } for the fields that are clearly wrong. Empty object means "looks fine".
export function validateChallenge(form, { editing = false } = {}) {
  const errors = {};
  if (!SLUG_PATTERN.test(form.slug.trim())) errors.slug = 'Use lowercase letters, digits and single dashes.';
  if (!form.title.trim()) errors.title = 'A title is required.';
  const points = Number(form.points);
  if (!Number.isInteger(points) || points < 1 || points > 10000) errors.points = 'Points must be a whole number from 1 to 10000.';
  if (form.type === 'docker') {
    if (!form.image.trim().startsWith('ctf/')) errors.image = 'The image name must start with ctf/.';
    const port = Number(form.internalPort);
    if (!Number.isInteger(port) || port < 1 || port > 65535) errors.internalPort = 'Enter a port from 1 to 65535.';
  } else if (!editing && !form.flag.trim()) {
    errors.flag = 'A static challenge needs a flag.';
  }
  const bad = parseAttachments(form.attachments).find((item) => !/^(\/(?!\/)|https?:\/\/)\S*$/.test(item.url));
  if (bad) errors.attachments = `Attachment "${bad.name}" needs a URL starting with / or http(s)://, without spaces.`;
  return errors;
}

export const SCORE_LIMIT = 10_000;
export const REASON_MIN = 3;
export const REASON_MAX = 200;

// Score adjustment form { points, reason } -> { errors, body }. `points` is a non-zero integer within +-10000.
export function validateAdjustment({ points, reason }) {
  const errors = {};
  const text = String(points ?? '').trim();
  const value = Number(text);
  if (!/^[+-]?\d+$/.test(text) || !Number.isInteger(value) || value === 0) errors.points = 'Enter a non-zero whole number such as -50 or 25.';
  else if (Math.abs(value) > SCORE_LIMIT) errors.points = `Points must be between -${SCORE_LIMIT} and ${SCORE_LIMIT}.`;
  const why = String(reason ?? '').trim();
  if (why.length < REASON_MIN || why.length > REASON_MAX) errors.reason = `A reason of ${REASON_MIN}-${REASON_MAX} characters is required.`;
  return { errors, body: Object.keys(errors).length ? null : { points: value, reason: why } };
}

// Solve deletion and integrity resolution notes.
export function validateReason(reason, { min = REASON_MIN, max = REASON_MAX } = {}) {
  const text = String(reason ?? '').trim();
  if (text.length < min) return `Enter at least ${min} characters.`;
  if (text.length > max) return `Keep it under ${max} characters.`;
  return '';
}

// Typed confirmation: the admin must type the phrase exactly (surrounding spaces ignored, case kept).
export const typedMatches = (input, phrase) => String(phrase ?? '').length > 0 && String(input ?? '').trim() === String(phrase).trim();

export const ANNOUNCEMENT_LEVELS = ['info', 'warning', 'critical'];
export const ANNOUNCEMENT_MAX = 500;

// Settings form -> PUT body with only what changed (the API needs at least one key).
export function settingsPatch(saved, draft) {
  const patch = {};
  if (draft.registrationOpen !== saved.registrationOpen) patch.registrationOpen = draft.registrationOpen;
  if (draft.submissionsFrozen !== saved.submissionsFrozen) patch.submissionsFrozen = draft.submissionsFrozen;
  const text = draft.announcement.text.trim();
  if (text !== (saved.announcement?.text ?? '') || draft.announcement.level !== (saved.announcement?.level ?? 'info')) {
    patch.announcement = { text, level: draft.announcement.level };
  }
  return patch;
}

export function validateSettings(draft) {
  const errors = {};
  if (draft.announcement.text.trim().length > ANNOUNCEMENT_MAX) errors.announcement = `Keep the announcement under ${ANNOUNCEMENT_MAX} characters.`;
  if (!ANNOUNCEMENT_LEVELS.includes(draft.announcement.level)) errors.level = 'Pick info, warning or critical.';
  return errors;
}

export const settingsToDraft = (settings) => ({
  registrationOpen: settings?.registrationOpen !== false,
  submissionsFrozen: Boolean(settings?.submissionsFrozen),
  announcement: { text: settings?.announcement?.text ?? '', level: settings?.announcement?.level ?? 'info' },
});

// Group helper for the challenge import preview.
export function importSummary(result) {
  const count = (list) => (Array.isArray(list) ? list.length : 0);
  return {
    created: count(result?.created), updated: count(result?.updated), skipped: count(result?.skipped),
    needsFlag: count(result?.needsFlag), errors: count(result?.errors),
    writes: count(result?.created) + count(result?.updated),
  };
}
