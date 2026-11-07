import { z } from 'zod';
import { parseEnv } from '@finsight/config';

const apiEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  // 127.0.0.1 locally (not reachable from the LAN); containers set HOST=0.0.0.0.
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_URL: z.url({
    protocol: /^postgres(ql)?$/,
    error: (iss) => (iss.input === undefined ? 'is required' : 'must be a postgres:// URL'),
  }),
  REDIS_URL: z.url({
    protocol: /^rediss?$/,
    error: (iss) => (iss.input === undefined ? 'is required' : 'must be a redis:// or rediss:// URL'),
  }),
  HEALTH_CHECK_TIMEOUT_MS: z.coerce.number().int().positive().default(1_000),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
});

export type ApiConfig = Readonly<z.output<typeof apiEnvSchema>>;

/**
 * Pure function: env in, typed config out. It does not read process.env at
 * import time, so tests can pass any env object without mutating globals.
 */
export function loadConfig(env: Record<string, string | undefined>): ApiConfig {
  return parseEnv(apiEnvSchema, env);
}
