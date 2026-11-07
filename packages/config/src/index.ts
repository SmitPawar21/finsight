import { z } from 'zod';

type EnvSource = Record<string, string | undefined>;

/**
 * Thrown when the environment does not satisfy a config schema.
 * The message lists every problem at once (not just the first) and never
 * includes the raw values, since env vars frequently hold secrets.
 */
export class ConfigError extends Error {
  override readonly name = 'ConfigError';
  constructor(readonly problems: readonly string[]) {
    super(`Invalid configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  }
}

/**
 * Validate an env-like object against a zod schema and return typed, frozen config.
 *
 * Empty strings are treated as "unset". `PORT=` in a .env file would otherwise
 * reach z.coerce.number() as "" and silently become 0.
 */
export function parseEnv<S extends z.ZodType>(schema: S, source: EnvSource): Readonly<z.output<S>> {
  const cleaned: EnvSource = {};
  for (const [key, value] of Object.entries(source)) {
    cleaned[key] = value === '' ? undefined : value;
  }

  const result = schema.safeParse(cleaned);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => {
      const key = issue.path.length > 0 ? issue.path.join('.') : '(root)';
      return `${key}: ${issue.message}`;
    });
    throw new ConfigError(problems);
  }
  return Object.freeze(result.data);
}

/**
 * Strict boolean env var. Do NOT use z.coerce.boolean(), which does Boolean("false")
 * and returns true for any non-empty string.
 */
export const envBoolean = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

/** Remove the password from a connection URL so it is safe to log. */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return '<unparseable url>';
  }
}
