import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

// Resolve from this module so npm commands work from backend/ or the repo root.
dotenv.config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });

const text = z.string().trim().min(1, 'is required');
const positiveInteger = text.pipe(z.coerce.number().int().positive());
const port = positiveInteger.pipe(z.number().max(65535));
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  PORT: port,
  MONGODB_URI: text.regex(/^mongodb(?:\+srv)?:\/\/\S+$/, 'must be a MongoDB URI'),
  COGNITO_REGION: text,
  COGNITO_USER_POOL_ID: text,
  COGNITO_CLIENT_ID: text,
  VITE_COGNITO_REGION: text,
  VITE_COGNITO_USER_POOL_ID: text,
  VITE_COGNITO_CLIENT_ID: text,
  PUBLIC_HOST: text,
  FLAG_SECRET: text.min(32, 'must contain at least 32 characters'),
  CHALLENGE_PORT_MIN: port,
  CHALLENGE_PORT_MAX: port,
  INSTANCE_TTL_MINUTES: positiveInteger,
  MAX_INSTANCES_PER_TEAM: positiveInteger,
  CHALLENGE_MEMORY_MB: positiveInteger,
  CHALLENGE_CPU_LIMIT: text.pipe(z.coerce.number().positive()),
  CHALLENGE_PIDS_LIMIT: positiveInteger,
}).refine((value) => value.CHALLENGE_PORT_MAX >= value.CHALLENGE_PORT_MIN, {
  path: ['CHALLENGE_PORT_MAX'],
  message: 'must be at least CHALLENGE_PORT_MIN',
});

const result = schema.safeParse(process.env);

if (!result.success) {
  // Report names and constraints only; never include supplied values.
  const details = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
  process.stderr.write(`Invalid environment configuration:\n${details.join('\n')}\n`);
  process.exit(1);
}

export const env = Object.freeze(result.data);
