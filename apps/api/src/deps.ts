import { Pool } from 'pg';
import { Redis } from 'ioredis';
import type { FastifyBaseLogger } from 'fastify';
import { withTimeout, type HealthCheck } from './health.js';

export interface Deps {
  pg: Pool;
  redis: Redis;
  checks: HealthCheck[];
  /**
   * Wait (bounded) for initial connections. Returns false instead of throwing on
   * timeout: the caller decides whether to start anyway (readiness will report it).
   */
  waitUntilConnected(timeoutMs: number): Promise<boolean>;
  /** Close all connections. Safe to call once during shutdown. */
  close(): Promise<void>;
}

export interface DepsConfig {
  DATABASE_URL: string;
  REDIS_URL: string;
}

export function createDeps(config: DepsConfig, log: FastifyBaseLogger): Deps {
  const pool = new Pool({
    connectionString: config.DATABASE_URL,
    max: 10,
    // Fail fast instead of waiting forever for a connection when the DB is down.
    connectionTimeoutMillis: 2_000,
    idleTimeoutMillis: 30_000,
  });
  // An idle client erroring (e.g. DB restart) emits 'error' on the pool.
  // Without a listener, Node treats it as unhandled and CRASHES the process.
  pool.on('error', (err) => log.warn({ err }, 'postgres idle client error'));

  const redis = new Redis(config.REDIS_URL, {
    // Don't buffer commands while disconnected: a readiness ping should fail
    // immediately, not sit in a queue until Redis comes back.
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
  });
  // ioredis emits 'error' on EVERY failed reconnect attempt (and needs a
  // listener, or Node crashes). Log only on state transitions so an outage
  // produces two lines (down, recovered) instead of one per retry.
  let redisHealthy = true;
  redis.on('error', (err: Error & { code?: string }) => {
    if (!redisHealthy) return;
    redisHealthy = false;
    // Connection failures to "localhost" are often an AggregateError (IPv6 + IPv4
    // attempts) with an EMPTY message; the useful detail is in `code`.
    log.warn({ code: err.code, err }, 'redis connection lost; retrying in background');
  });
  redis.on('ready', () => {
    if (redisHealthy) return;
    redisHealthy = true;
    log.info('redis connection restored');
  });

  const checks: HealthCheck[] = [
    {
      name: 'postgres',
      check: async () => {
        await pool.query('SELECT 1');
      },
    },
    {
      name: 'redis',
      check: async () => {
        const pong = await redis.ping();
        if (pong !== 'PONG') throw new Error(`unexpected ping reply: ${JSON.stringify(pong)}`);
      },
    },
  ];

  const redisReady = (): Promise<void> =>
    redis.status === 'ready'
      ? Promise.resolve()
      : new Promise((resolve) => redis.once('ready', () => resolve()));

  return {
    pg: pool,
    redis,
    checks,
    waitUntilConnected: async (timeoutMs) => {
      try {
        await withTimeout(Promise.all([redisReady(), pool.query('SELECT 1')]), timeoutMs, 'initial connect');
        return true;
      } catch (err) {
        log.warn(
          { err },
          'dependencies not reachable at startup; starting anyway (readiness will report it)',
        );
        return false;
      }
    },
    close: async () => {
      // allSettled: one failing close must not prevent closing the others.
      await Promise.allSettled([pool.end(), redis.quit()]);
    },
  };
}
