import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pino } from 'pino';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { createDeps, type Deps } from './deps.js';

/**
 * Integration test: real Postgres (same pgvector image as compose.yaml) and real
 * Redis in throwaway containers on random ports. Nothing is mocked here; this
 * catches what unit tests with fakes can't (driver config, URLs, extensions).
 */
describe('readiness against real dependencies', () => {
  let pgC: StartedPostgreSqlContainer;
  let redisC: StartedRedisContainer;
  let deps: Deps;
  let app: FastifyInstance;

  beforeAll(async () => {
    [pgC, redisC] = await Promise.all([
      new PostgreSqlContainer('pgvector/pgvector:0.8.7-pg17-trixie').start(),
      new RedisContainer('redis:8.6-alpine').start(),
    ]);
    deps = createDeps(
      { DATABASE_URL: pgC.getConnectionUri(), REDIS_URL: redisC.getConnectionUrl() },
      pino({ level: 'silent' }),
    );
    app = buildApp({ checks: deps.checks, healthCheckTimeoutMs: 2_000, state: { shuttingDown: false } });
    // Without this, the first readiness probe races ioredis's initial connect
    // (offline queue is disabled), which is the bug this test originally caught.
    if (!(await deps.waitUntilConnected(10_000))) throw new Error('test containers did not become reachable');
  });

  it('waitUntilConnected returns false (not throw) when a dependency is unreachable', async () => {
    const bad = createDeps(
      { DATABASE_URL: pgC.getConnectionUri(), REDIS_URL: 'redis://127.0.0.1:1' },
      pino({ level: 'silent' }),
    );
    try {
      expect(await bad.waitUntilConnected(500)).toBe(false);
    } finally {
      bad.redis.disconnect(); // stop the reconnect loop
      await bad.close();
    }
  });

  afterAll(async () => {
    await app?.close();
    await deps?.close();
    await Promise.all([pgC?.stop(), redisC?.stop()]);
  });

  it('is ready when Postgres and Redis are up', async () => {
    const res = await app.inject('/health/ready');
    expect(res.json()).toMatchObject({
      status: 'ready',
      checks: { postgres: { status: 'up' }, redis: { status: 'up' } },
    });
    expect(res.statusCode).toBe(200);
  });

  it('can use pgvector in the same image as the dev stack', async () => {
    await deps.pg.query('CREATE EXTENSION IF NOT EXISTS vector');
    const { rows } = await deps.pg.query<{ d: number }>("SELECT ('[1,0]'::vector <=> '[0,1]'::vector) AS d");
    expect(rows[0]?.d).toBeCloseTo(1); // orthogonal vectors: cosine distance 1
  });

  it('becomes not-ready when Redis dies, while liveness stays 200', async () => {
    await redisC.stop();
    const ready = await app.inject('/health/ready');
    expect(ready.statusCode).toBe(503);
    expect(ready.json()).toMatchObject({ checks: { postgres: { status: 'up' }, redis: { status: 'down' } } });

    const live = await app.inject('/health/live');
    expect(live.statusCode).toBe(200);
  });
});
