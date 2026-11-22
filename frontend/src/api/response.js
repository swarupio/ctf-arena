// Pure helpers that turn a fetch Response into data or a normal API error. No auth, no DOM.
export const SERVER_TROUBLE = 'The server is having trouble. Try again in a moment.';
export const GENERIC_FAILURE = 'The request failed. Try again in a moment.';

// An API error with the same shape callers already read: message, status, code.
export function apiError(status, message, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

// A non-JSON body (an HTML 502/504 page from a proxy) never reaches the player as a SyntaxError.
export function badResponseError(status) {
  return apiError(status, status >= 500 ? SERVER_TROUBLE : GENERIC_FAILURE, 'BAD_RESPONSE');
}

// Resolves with the parsed body (null for 204) or throws an API error. A JSON error keeps the server's message and code.
export async function parseApiResponse(response) {
  const empty = response.status === 204;
  let data = null;
  let parsed = empty;
  if (!empty) {
    try { data = await response.json(); parsed = true; } catch { parsed = false; }
  }
  if (!response.ok) {
    if (!parsed || data === null || typeof data !== 'object') throw badResponseError(response.status);
    throw apiError(response.status, data?.error?.message ?? 'The API request failed.', data?.error?.code);
  }
  if (!parsed) throw badResponseError(response.status);
  return data;
}
