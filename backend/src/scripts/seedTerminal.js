// Registers one Challenge per code of the Arena Terminal game (docs/TERMINAL_GAME.md section 9).
// Safe to repeat: rows are keyed by slug `terminal-<mode>-<n>`, updated in place, and keep solveCount and
// `visible` (an admin may hide a code). Usage: npm run seed:terminal
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import Challenge from '../models/Challenge.js';
import { MODE_NAMES, MODES } from '../terminal/modes/index.js';
import { isEntryPoint } from './seedChallenges.js';

const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);

export const terminalSlug = (mode, n) => `terminal-${mode}-${n}`;

export function terminalDefinitions(modes = MODES, names = MODE_NAMES) {
  return names.flatMap((name) => modes[name].codes.map((code) => ({
    slug: terminalSlug(name, code.n),
    title: `Terminal ${capitalize(name)} #${code.n}`,
    description: `A hidden code in the Arena Terminal ${name} mode. Open the Terminal page, explore the virtual machine with Unix commands and submit the flag you find.`,
    category: 'terminal',
    type: 'terminal',
    difficulty: name,
    points: code.points,
    terminal: { mode: name, code: code.n },
  })));
}

export async function seedTerminal(definitions = terminalDefinitions()) {
  const summary = { created: 0, updated: 0 };
  for (const definition of definitions) {
    const existing = await Challenge.findOne({ slug: definition.slug });
    if (existing) {
      // solveCount and visible are not part of the update: solves and admin choices survive a re-seed.
      await Challenge.updateOne({ _id: existing._id }, { $set: definition });
      summary.updated += 1;
    } else {
      await Challenge.create({ ...definition, visible: true });
      summary.created += 1;
    }
  }
  return summary;
}

if (isEntryPoint(import.meta.url)) {
  try {
    await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
    const summary = await seedTerminal();
    process.stdout.write(`Terminal challenges seeded: ${summary.created} created, ${summary.updated} updated.\n`);
  } catch {
    // Driver errors can contain credentials; never print them.
    process.stderr.write('Terminal seeding failed. Check MONGODB_URI.\n');
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}
