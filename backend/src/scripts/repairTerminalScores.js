// One-off, idempotent: resets terminal solves that got the old first-blood bonus. Usage: node src/scripts/repairTerminalScores.js
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { connectDB } from '../config/db.js';
import { repairTerminalSolves } from '../services/terminalService.js';

await connectDB(env.MONGODB_URI);
const fixed = await repairTerminalSolves();
process.stdout.write(`repaired ${fixed} terminal solve rows\n`);
await mongoose.disconnect();
