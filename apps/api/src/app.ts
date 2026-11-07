import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { runReadinessChecks, type HealthCheck } from './health.js';

export interface AppState {
  /** Set to true when graceful shutdown begins; readiness then reports 503. */
  shuttingDown: boolean;
}

export interface BuildAppOptions {
  checks: readonly HealthCheck[];
  healthCheckTimeoutMs: number;
  state: AppState;
  /** An existing pino logger shared with the rest of the process. Omit in tests for silence. */
  logger?: FastifyBaseLogger;
}

/**
 * Builds the Fastify app WITHOUT listening on a port.
 * Tests call `app.inject()` (an in-memory request, with no network), and
 * server.ts calls `app.listen()`. Dependencies are passed in, not created here,
 * so tests can substitute fakes.
 */
export function buildApp(opts: BuildAppOptions): FastifyInstance {
  const app = Fastify({
    ...(opts.logger ? { loggerInstance: opts.logger } : { logger: false }),
    // Honour an incoming x-request-id (e.g. from a load balancer) so one ID
    // follows a request across services; otherwise Fastify generates one.
    requestIdHeader: 'x-request-id',
    // Return 503 instead of hanging if a request arrives mid-shutdown.
    return503OnClosing: true,
  });

  // Echo the request id so a client-side error report can be matched to server logs.
  app.addHook('onSend', async (req, reply) => {
    reply.header('x-request-id', req.id);
  });

  const startedAt = Date.now();

  // logLevel 'warn' keeps probe traffic (every few seconds) out of the logs.
  app.get('/health/live', { logLevel: 'warn' }, async () => ({
    status: 'ok',
    uptimeS: Math.round((Date.now() - startedAt) / 1000),
  }));

  app.get('/health/ready', { logLevel: 'warn' }, async (_req, reply) => {
    if (opts.state.shuttingDown) {
      return reply.code(503).send({ status: 'shutting_down', checks: {} });
    }
    const report = await runReadinessChecks(opts.checks, opts.healthCheckTimeoutMs);
    if (!report.ready) {
      // Not-ready is an expected operational state, so warn rather than error.
      _req.log.warn({ checks: report.checks }, 'readiness check failed');
    }
    return reply
      .code(report.ready ? 200 : 503)
      .send({ status: report.ready ? 'ready' : 'not_ready', checks: report.checks });
  });

  return app;
}
