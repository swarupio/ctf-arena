// Maps API failures to friendly sentences. The API sends { error: { code, message } }; apiRequest copies them onto
// the Error as `code` and `status`.
const BY_CODE = {
  UNAUTHENTICATED: 'Your session has expired. Sign in again.',
  FORBIDDEN: 'Only admins can do this.',
  USER_BANNED: 'That user is banned.',
  SUBMISSIONS_FROZEN: 'Submissions are frozen. Unfreeze them in Settings first.',
  CANNOT_BAN_ADMIN: 'Admins cannot be banned.',
  NOT_A_MEMBER: 'That user is not a member of a team.',
  TEAM_NOT_EMPTY: 'The team still has members. Remove them first.',
  ACTOR_NOT_FOUND: 'Your admin account has no user row yet. Open your profile once, then try again.',
  CONFLICT: 'That name or slug is already taken.',
  NOT_FOUND: 'That item no longer exists. It may have been deleted already.',
  RATE_LIMITED: 'Too many requests. Wait a moment and try again.',
  DOCKER_DISABLED: 'Docker is disabled on this server.',
};

const BY_STATUS = {
  401: BY_CODE.UNAUTHENTICATED,
  403: BY_CODE.FORBIDDEN,
  404: BY_CODE.NOT_FOUND,
  409: 'That conflicts with the current state. Reload and try again.',
  423: 'This is locked right now (submissions are frozen).',
  429: BY_CODE.RATE_LIMITED,
};

const GENERIC = 'The API request failed.';

export const isAuthError = (error) => error?.status === 401 || error?.status === 403;

// '' for an aborted request (nothing to tell the admin).
export function friendlyError(error, fallback = 'Something went wrong. Please try again.') {
  if (!error) return fallback;
  if (error.name === 'AbortError') return '';
  const detail = error.message && error.message !== GENERIC ? error.message : '';
  if (error.code === 'CONFLICT' && detail) return detail;
  if (error.code && BY_CODE[error.code]) return BY_CODE[error.code];
  if (error.status === 400 || error.status === 422) {
    return detail ? `Check the form: ${detail}` : 'Check the form: some values are not valid.';
  }
  if (BY_STATUS[error.status]) return BY_STATUS[error.status];
  if (error.status >= 500) return 'The server had a problem. Try again in a moment.';
  if (error.name === 'TypeError' || error.name === 'SyntaxError') return 'Cannot reach the server. Check your connection and try again.';
  return detail || fallback;
}
