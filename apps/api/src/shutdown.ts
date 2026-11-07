import type { FastifyBaseLogger } from 'fastify';
import type { AppState } from './app.js';

export interface ShutdownOptions {
  log: FastifyBaseLogger;
  state: AppState;
  /** Closed IN ORDER: e.g. [stop HTTP server, then close DB/Redis]. */
  steps: ReadonlyArray<{ name: string; run: () => Promise<unknown> }>;
  timeoutMs: number;
  /** Injected so tests can observe the exit code instead of killing the test runner. */
  exit: (code: number) => void;
}

/**
 * Graceful shutdown, in order:
 *  1. Mark not-ready, so the load balancer stops sending NEW traffic.
 *  2. Run steps in order: stop accepting connections and finish in-flight
 *     requests, THEN close DB/Redis (requests still in flight need them).
 *  3. Exit. A hard timeout guarantees exit even if a step hangs.
 * A second call (impatient Ctrl+C, or a crash during shutdown) forces exit(1).
 */
export function createShutdown(opts: ShutdownOptions) {
  let started = false;

  return async function shutdown(reason: string, exitCode = 0): Promise<void> {
    if (started) {
      opts.log.warn({ reason }, 'shutdown already in progress: forcing exit');
      opts.exit(1);
      return;
    }
    started = true;
    opts.state.shuttingDown = true;
    opts.log.info({ reason }, 'shutting down gracefully');

    let finished = false;
    // unref(): this timer alone must not keep the process alive.
    const timer = setTimeout(() => {
      if (finished) return;
      opts.log.error({ timeoutMs: opts.timeoutMs }, 'graceful shutdown timed out: forcing exit');
      opts.exit(1);
    }, opts.timeoutMs);
    timer.unref();

    let code = exitCode;
    for (const step of opts.steps) {
      try {
        await step.run();
      } catch (err) {
        // Keep going: a failing step must not leave the remaining resources open.
        opts.log.error({ err, step: step.name }, 'shutdown step failed');
        code = 1;
      }
    }
    finished = true;
    clearTimeout(timer);
    opts.log.info({ exitCode: code }, 'shutdown complete');
    opts.exit(code);
  };
}
