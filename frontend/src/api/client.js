import { getToken } from '../auth/token.js';
import { setServedBy } from './servedBy.js';

export class ApiError extends Error {
  constructor(message, code, status) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

export function createApiClient({
  baseUrl = import.meta.env?.VITE_API_URL || '/api',
  tokenProvider = getToken,
  fetchImpl = (...args) => fetch(...args),
} = {}) {
  return async function request(path, { body, headers, ...options } = {}) {
    const requestHeaders = new Headers(headers);
    requestHeaders.set('Accept', 'application/json');
    const token = await tokenProvider();
    if (token) { requestHeaders.set('Authorization', `Bearer ${token}`); }
    if (body !== undefined) {
      requestHeaders.set('Content-Type', 'application/json');
    }

    let response;
    try {
      response = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`, {
        ...options, headers: requestHeaders,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (error) {
      if (error.name === 'AbortError') { throw error; }
      throw new ApiError('Unable to reach the arena. Please try again.', 'NETWORK_ERROR', 0);
    }
    setServedBy(response.headers.get('X-Served-By'));
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      if (response.ok) {
        throw new ApiError('The arena returned an invalid response.', 'INVALID_RESPONSE', response.status);
      }
    }
    if (!response.ok) {
      throw new ApiError(
        data?.error?.message || `The request failed (HTTP ${response.status}).`,
        data?.error?.code || 'HTTP_ERROR', response.status,
      );
    }
    return data;
  };
}

export const api = createApiClient();
