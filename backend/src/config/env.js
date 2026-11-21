import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

// Resolve from this module so npm commands work from backend/ or the repo root.
// Existing process variables win, followed by root .env, then backend/.env.
dotenv.config({
  path: [
    fileURLToPath(new URL('../../../.env', import.meta.url)),
    fileURLToPath(new URL('../../.env', import.meta.url)),
  ],
  override: false,
  quiet: true,
});

// On Vercel (serverless) Docker challenges are unavailable, so the container-only settings get inert defaults
// and need not be configured. Real values in process.env always win.
const ON_VERCEL = Boolean(process.env.VERCEL);
const VERCEL_DEFAULTS = {
  PORT: '4000',
  PUBLIC_HOST: 'localhost',
  CHALLENGE_PORT_MIN: '30000',
  CHALLENGE_PORT_MAX: '30100',
  INSTANCE_TTL_MINUTES: '30',
  MAX_INSTANCES_PER_TEAM: '2',
  CHALLENGE_MEMORY_MB: '128',
  CHALLENGE_CPU_LIMIT: '0.25',
  CHALLENGE_PIDS_LIMIT: '64',
};

// Defaults fill in unset or empty variables only.
const withDefaults = (source) => ({
  ...VERCEL_DEFAULTS,
  ...Object.fromEntries(Object.entries(source).filter(([, value]) => value !== undefined && value !== '')),
});

const PLACEHOLDER_SECRET = /replace_with|placeholder|changeme|change_me|your[-_]secret/i;
const text = z.string().trim().min(1, 'is required');
const positiveInteger = text.pipe(z.coerce.number().int().positive());
const port = positiveInteger.pipe(z.number().max(65535));
// DOCKER_ENABLED: true on a laptop / docker compose, false on Vercel unless set explicitly.
const dockerEnabled = z.preprocess(
  (value) => (value === undefined || value === '' ? !ON_VERCEL : value),
  z.union([z.boolean(), z.string().trim().toLowerCase().pipe(z.enum(['true', 'false', '1', '0']))])
    .transform((value) => value === true || value === 'true' || value === '1'),
);
const schema = z.object({
  DOCKER_ENABLED: dockerEnabled,
  NODE_ENV: z.enum(['development', 'test', 'production']),
  PORT: port,
  MONGODB_URI: text.regex(/^mongodb(?:\+srv)?:\/\//, 'must start with mongodb:// or mongodb+srv://'),
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
}).refine((value) => value.NODE_ENV !== 'production' || !PLACEHOLDER_SECRET.test(value.FLAG_SECRET), {
  // Every team flag is HMAC(FLAG_SECRET, teamId:challengeId): the committed placeholder would let anyone forge them.
  path: ['FLAG_SECRET'],
  message: 'must be a private random value in production (the .env.example placeholder is public)',
});

const result = schema.safeParse(ON_VERCEL ? withDefaults(process.env) : process.env);

if (!result.success) {
  // Report names and constraints only; never include supplied values.
  const details = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
  process.stderr.write(`Invalid environment configuration:\n${details.join('\n')}\n`);
  process.exit(1);
}

export const env = Object.freeze(result.data);
