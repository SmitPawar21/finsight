/**
 * Health checking.
 *
 * Liveness  = "is this process able to make progress?" If it fails, the
 *             orchestrator RESTARTS the container. It must NOT check
 *             dependencies: if Postgres is down, restarting every API
 *             container doesn't fix Postgres, it just causes a restart storm.
 * Readiness = "should this instance receive traffic right now?" If it fails,
 *             the load balancer STOPS ROUTING to it, but doesn't restart it.
 *             This is where dependency checks belong.
 */

export interface HealthCheck {
  readonly name: string;
  /** Resolve if healthy, reject (or hang) if not. */
  check(): Promise<void>;
}

export interface CheckResult {
  status: 'up' | 'down';
  latencyMs: number;
  error?: string;
}

export interface ReadinessReport {
  ready: boolean;
  checks: Record<string, CheckResult>;
}

/** Reject if `promise` doesn't settle within `ms`. Always clears its timer. */
export async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run all checks in PARALLEL, each with its own timeout, so total latency is
 * bounded by the slowest check (≈ timeoutMs) rather than their sum.
 * A failing check never throws out of here; it's reported as "down".
 */
export async function runReadinessChecks(
  checks: readonly HealthCheck[],
  timeoutMs: number,
): Promise<ReadinessReport> {
  const entries = await Promise.all(
    checks.map(async (c): Promise<[string, CheckResult]> => {
      const start = performance.now();
      try {
        await withTimeout(c.check(), timeoutMs, c.name);
        return [c.name, { status: 'up', latencyMs: Math.round(performance.now() - start) }];
      } catch (err) {
        return [
          c.name,
          {
            status: 'down',
            latencyMs: Math.round(performance.now() - start),
            error: err instanceof Error ? err.message : String(err),
          },
        ];
      }
    }),
  );
  return {
    ready: entries.every(([, r]) => r.status === 'up'),
    checks: Object.fromEntries(entries),
  };
}
