import { describe, expect, it } from 'vitest';
import { ConfigError } from '@finsight/config';
import { loadConfig } from './config.js';

const valid = {
  DATABASE_URL: 'postgres://u:p@localhost:5433/finsight',
  REDIS_URL: 'redis://localhost:6379',
};

describe('loadConfig', () => {
  it('applies safe defaults', () => {
    const cfg = loadConfig(valid);
    expect(cfg).toMatchObject({
      NODE_ENV: 'development',
      HOST: '127.0.0.1',
      PORT: 3001,
      LOG_LEVEL: 'info',
      HEALTH_CHECK_TIMEOUT_MS: 1000,
      SHUTDOWN_TIMEOUT_MS: 10000,
    });
  });

  it('says "is required" for missing URLs', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL: is required/);
    expect(() => loadConfig({})).toThrow(/REDIS_URL: is required/);
  });

  it.each([
    ['DATABASE_URL', 'mysql://u:p@h/db', /must be a postgres:\/\/ URL/],
    ['REDIS_URL', 'http://localhost:6379', /must be a redis/],
    ['PORT', '70000', /PORT/],
    ['NODE_ENV', 'prod', /NODE_ENV/],
  ])('rejects invalid %s', (key, value, message) => {
    expect(() => loadConfig({ ...valid, [key]: value })).toThrow(message);
  });

  it('accepts rediss:// (TLS) and postgresql://', () => {
    expect(() =>
      loadConfig({ DATABASE_URL: 'postgresql://h/db', REDIS_URL: 'rediss://h:6380' }),
    ).not.toThrow();
  });

  it('throws ConfigError specifically (index.ts relies on this to exit cleanly)', () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
  });
});
