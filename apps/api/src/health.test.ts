import { describe, expect, it } from 'vitest';
import { runReadinessChecks, withTimeout, type HealthCheck } from './health.js';

const ok = (name: string): HealthCheck => ({ name, check: async () => {} });
const failing = (name: string, msg: string): HealthCheck => ({
  name,
  check: async () => {
    throw new Error(msg);
  },
});
const hanging = (name: string): HealthCheck => ({ name, check: () => new Promise(() => {}) });
const slow = (name: string, ms: number): HealthCheck => ({
  name,
  check: () => new Promise((r) => setTimeout(r, ms)),
});

describe('withTimeout', () => {
  it('resolves with the value when fast enough', async () => {
    await expect(withTimeout(Promise.resolve(42), 50, 'x')).resolves.toBe(42);
  });
  it('rejects with a labelled error when too slow', async () => {
    await expect(withTimeout(new Promise(() => {}), 20, 'postgres')).rejects.toThrow(
      'postgres timed out after 20ms',
    );
  });
});

describe('runReadinessChecks', () => {
  it('is ready when every check passes', async () => {
    const r = await runReadinessChecks([ok('a'), ok('b')], 100);
    expect(r.ready).toBe(true);
    expect(r.checks.a?.status).toBe('up');
  });

  it('is not ready if any check fails, and reports which one and why', async () => {
    const r = await runReadinessChecks([ok('postgres'), failing('redis', 'ECONNREFUSED')], 100);
    expect(r.ready).toBe(false);
    expect(r.checks.postgres?.status).toBe('up');
    expect(r.checks.redis).toMatchObject({ status: 'down', error: 'ECONNREFUSED' });
  });

  it('treats a hanging dependency as down instead of hanging the probe', async () => {
    const r = await runReadinessChecks([hanging('db')], 30);
    expect(r.checks.db).toMatchObject({ status: 'down', error: 'db timed out after 30ms' });
  });

  it('runs checks in parallel (total time ≈ slowest, not the sum)', async () => {
    const start = performance.now();
    await runReadinessChecks([slow('a', 150), slow('b', 150), slow('c', 150)], 1_000);
    // Parallel ≈150ms; sequential would be ≥450ms. Wide margin keeps it stable on slow CI.
    expect(performance.now() - start).toBeLessThan(350);
  });

  it('is ready with zero checks', async () => {
    expect((await runReadinessChecks([], 10)).ready).toBe(true);
  });
});
