import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, type AppState } from './app.js';
import type { HealthCheck } from './health.js';

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

function make(checks: HealthCheck[], state: AppState = { shuttingDown: false }) {
  app = buildApp({ checks, healthCheckTimeoutMs: 50, state });
  return app;
}

const up: HealthCheck = { name: 'postgres', check: async () => {} };
const down: HealthCheck = {
  name: 'redis',
  check: async () => {
    throw new Error('ECONNREFUSED');
  },
};

describe('GET /health/live', () => {
  it('is 200 even when dependencies are down (liveness must not check deps)', async () => {
    const res = await make([down]).inject('/health/live');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok' });
  });
});

describe('GET /health/ready', () => {
  it('is 200 when all dependencies are up', async () => {
    const res = await make([up]).inject('/health/ready');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ready', checks: { postgres: { status: 'up' } } });
  });

  it('is 503 with per-dependency detail when one is down', async () => {
    const res = await make([up, down]).inject('/health/ready');
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({
      status: 'not_ready',
      checks: { postgres: { status: 'up' }, redis: { status: 'down', error: 'ECONNREFUSED' } },
    });
  });

  it('is 503 while shutting down, without running checks', async () => {
    let called = false;
    const spy: HealthCheck = {
      name: 'spy',
      check: async () => {
        called = true;
      },
    };
    const res = await make([spy], { shuttingDown: true }).inject('/health/ready');
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ status: 'shutting_down' });
    expect(called).toBe(false);
  });
});

describe('request ids', () => {
  it('echoes an incoming x-request-id', async () => {
    const res = await make([]).inject({ url: '/health/live', headers: { 'x-request-id': 'abc-123' } });
    expect(res.headers['x-request-id']).toBe('abc-123');
  });
  it('generates one when absent', async () => {
    const res = await make([]).inject('/health/live');
    expect(res.headers['x-request-id']).toBeTruthy();
  });
});

it('returns 404 JSON for unknown routes', async () => {
  const res = await make([]).inject('/nope');
  expect(res.statusCode).toBe(404);
});
