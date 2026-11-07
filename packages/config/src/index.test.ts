import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ConfigError, envBoolean, parseEnv, redactUrl } from './index.js';

const schema = z.object({
  PORT: z.coerce.number().int().default(3000),
  API_KEY: z.string().min(10),
  DEBUG: envBoolean.default(false),
});

describe('parseEnv', () => {
  it('parses, coerces and applies defaults', () => {
    const cfg = parseEnv(schema, { API_KEY: 'abcdefghijk', PORT: '8080' });
    expect(cfg).toEqual({ PORT: 8080, API_KEY: 'abcdefghijk', DEBUG: false });
  });

  it('returns a frozen object', () => {
    const cfg = parseEnv(schema, { API_KEY: 'abcdefghijk' });
    expect(Object.isFrozen(cfg)).toBe(true);
  });

  it('treats empty strings as unset (PORT= must not become 0)', () => {
    const cfg = parseEnv(schema, { API_KEY: 'abcdefghijk', PORT: '' });
    expect(cfg.PORT).toBe(3000);
  });

  it('reports ALL problems at once', () => {
    const err = catchConfigError(() => parseEnv(schema, { PORT: 'abc', DEBUG: 'yes' }));
    expect(err.problems).toHaveLength(3);
    expect(err.problems.join('\n')).toMatch(/PORT/);
    expect(err.problems.join('\n')).toMatch(/API_KEY/);
    expect(err.problems.join('\n')).toMatch(/DEBUG/);
  });

  it('never echoes the (possibly secret) values', () => {
    const secret = 'sk-short';
    const err = catchConfigError(() => parseEnv(schema, { API_KEY: secret }));
    expect(err.message).not.toContain(secret);
  });

  it('does not depend on process.env', () => {
    expect(() => parseEnv(schema, {})).toThrow(ConfigError);
  });
});

describe('envBoolean', () => {
  it.each([
    ['true', true],
    ['1', true],
    ['false', false],
    ['0', false],
  ])('%s -> %s', (input, expected) => {
    expect(envBoolean.parse(input)).toBe(expected);
  });

  it('rejects ambiguous values instead of guessing', () => {
    expect(envBoolean.safeParse('yes').success).toBe(false);
    // The bug envBoolean exists to prevent:
    expect(z.coerce.boolean().parse('false')).toBe(true);
  });
});

describe('redactUrl', () => {
  it('masks the password only', () => {
    expect(redactUrl('postgres://user:hunter2@db:5432/app')).toBe('postgres://user:***@db:5432/app');
  });
  it('leaves URLs without a password unchanged', () => {
    expect(redactUrl('redis://localhost:6379')).toBe('redis://localhost:6379');
  });
  it('never returns an unparseable input verbatim (it may contain a secret)', () => {
    expect(redactUrl('not a url with secret')).toBe('<unparseable url>');
  });
});

function catchConfigError(fn: () => unknown): ConfigError {
  try {
    fn();
  } catch (err) {
    if (err instanceof ConfigError) return err;
    throw err;
  }
  throw new Error('expected ConfigError');
}
