import mongoose from 'mongoose';

// Every query and aggregation (including the user-triggered leaderboard, search and admin ones) gets a server-side
// time limit, so one slow operation cannot pile up on the database after the HTTP request has already given up.
// Kept below the request timeout (middleware/requestTimeout.js). Imported by app.js; scripts and seeds are unaffected.
export const MONGO_MAX_TIME_MS = process.env.VERCEL ? 10_000 : 20_000;

mongoose.set?.('maxTimeMS', MONGO_MAX_TIME_MS);
