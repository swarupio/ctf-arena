import os from 'node:os';
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import app from '../src/app.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { AppError } from '../src/utils/AppError.js';

vi.mock('../src/config/cognito.js', () => ({ getCognitoVerifier: vi.fn() }));
// Skeleton tests exercise health/errors only; avoid loading schemas into the DB-state mock.
vi.mock('../src/models/User.js', () => ({ default: {} }));
vi.mock('mongoose', () => ({ default: { connection: { readyState: 0 } } }));

describe('backend skeleton', () => {
  it('serves health without authentication, with replica and security headers', async () => {
    const response = await request(app).get('/api/health').expect(200);
    expect(response.body).toEqual({ status: 'ok', db: 'down', replica: os.hostname() });
    expect(response.headers['x-served-by']).toBe(os.hostname());
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it.each([0, 1, 2, 3, 99])('reports current database state %i', async (state) => {
    mongoose.connection.readyState = state;
    try {
      const response = await request(app).get('/api/health').expect(200);
      expect(response.body).toEqual({
        status: 'ok', db: state === 1 ? 'up' : 'down', replica: os.hostname(),
      });
    } finally {
      mongoose.connection.readyState = 0;
    }
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
