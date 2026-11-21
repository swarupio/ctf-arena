// Hard caps for everything a player can type into a lab. Every loop in the labs is bounded by one of these.
export const LIMITS = Object.freeze({
  PATH: 300,
  BODY: 2000,
  HEADER_COUNT: 20,
  HEADER_NAME: 40,
  HEADER_VALUE: 500,
  COOKIE_COUNT: 10,
  COOKIE_NAME: 40,
  COOKIE_VALUE: 500,
  QUERY_PARAMS: 20,
  FIELD: 200,
  SQL_LENGTH: 1000,
  SQL_TOKENS: 250,
  SQL_DEPTH: 12,
  ROWS: 50,
  TOKEN: 700,
  SEGMENTS: 40,
  HTML_SCAN: 1500,
  OUTPUT: 8000,
  PARALLEL: 20,
});

export const clip = (value, max) => String(value ?? '').slice(0, max);
