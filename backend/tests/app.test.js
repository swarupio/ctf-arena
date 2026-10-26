import os from 'node:os';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import app from '../src/app.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { AppError } from '../src/utils/AppError.js';

describe('backend skeleton', () => {
  it('serves health without authentication, with replica and security headers', async () => {
    const response = await request(app).get('/api/health').expect(200);
    expect(response.body).toEqual({ status: 'ok', replica: os.hostname() });
    expect(response.headers['x-served-by']).toBe(os.hostname());
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('formats unknown routes as 404 errors', async () => {
    const response = await request(app).get('/api/missing').expect(404);
    expect(response.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Route not found.' } });
    expect(response.headers['x-served-by']).toBe(os.hostname());
  });

  it('formats malformed JSON without exposing parser details', async () => {
    const response = await request(app).post('/api/health')
      .set('Content-Type', 'application/json').send('{"private":').expect(400);
    expect(response.body).toEqual({
      error: { code: 'VALIDATION_ERROR', message: 'Request body must be valid JSON.' },
    });
    expect(response.headers['x-served-by']).toBe(os.hostname());
  });

  it('rejects bodies larger than 100 KB', async () => {
    const response = await request(app).post('/api/health')
      .send({ data: 'x'.repeat(102400) }).expect(413);
    expect(response.body).toEqual({
      error: { code: 'VALIDATION_ERROR', message: 'Request body exceeds the 100 KB limit.' },
    });
  });

  it('preserves AppError status, code and public message', async () => {
    const testApp = express();
    testApp.get('/', () => { throw new AppError(409, 'CONFLICT', 'Resource already exists.'); });
    testApp.use(errorHandler);
    const response = await request(testApp).get('/').expect(409);
    expect(response.body).toEqual({ error: { code: 'CONFLICT', message: 'Resource already exists.' } });
  });

  it('hides unexpected error messages and stack traces', async () => {
    const testApp = express();
    testApp.get('/', () => { throw new Error('private database details'); });
    testApp.use(errorHandler);
    const response = await request(testApp).get('/').expect(500);
    expect(response.body).toEqual({
      error: { code: 'SERVER_ERROR', message: 'An unexpected error occurred.' },
    });
  });
});
