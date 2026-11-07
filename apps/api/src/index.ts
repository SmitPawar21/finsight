import { existsSync } from 'node:fs';
import { pino } from 'pino';
import { ConfigError, redactUrl } from '@finsight/config';
import { loadConfig, type ApiConfig } from './config.js';
import { buildApp, type AppState } from './app.js';
import { createDeps } from './deps.js';
import { createShutdown } from './shutdown.js';

// Local dev convenience only: in production the platform injects real env vars.
// Existing process env always wins over the file.
if (existsSync('.env')) process.loadEnvFile('.env');

let config: ApiConfig;
try {
  config = loadConfig(process.env);
} catch (err) {
  if (err instanceof ConfigError) {
    // oxlint-disable-next-line no-console -- logger is not created yet; config is what configures it
    console.error(err.message);
    process.exit(1); // fail fast: never start half-configured
  }
  throw err;
}

// One logger for the whole process, shared by Fastify and the dependency clients.
const log = pino({
  level: config.LOG_LEVEL,
  // Defence in depth: never log credentials even if a header object is logged.
  redact: ['req.headers.authorization', 'req.headers.cookie'],
  // Human-readable in dev; raw JSON elsewhere (machines parse it, e.g. CloudWatch).
  ...(config.NODE_ENV === 'development'
    ? { transport: { target: 'pino-pretty', options: { translateTime: 'SYS:HH:MM:ss' } } }
    : {}),
});

const state: AppState = { shuttingDown: false };
const deps = createDeps(config, log);
const app = buildApp({
  checks: deps.checks,
  healthCheckTimeoutMs: config.HEALTH_CHECK_TIMEOUT_MS,
  state,
  logger: log,
});

const shutdown = createShutdown({
  log,
  state,
  steps: [
    { name: 'http', run: () => app.close() }, // stop accepting, drain in-flight requests
    { name: 'deps', run: () => deps.close() }, // then close DB/Redis connections
  ],
  timeoutMs: config.SHUTDOWN_TIMEOUT_MS,
  exit: (code) => process.exit(code),
});

// A repeated signal (impatient Ctrl+C) forces exit; see createShutdown.
process.on('SIGINT', () => void shutdown('SIGINT', 0));
process.on('SIGTERM', () => void shutdown('SIGTERM', 0));
process.on('unhandledRejection', (err) => {
  log.fatal({ err }, 'unhandled promise rejection');
  void shutdown('unhandledRejection', 1);
});
process.on('uncaughtException', (err) => {
  // Process state may be corrupt after this: shut down rather than continue.
  log.fatal({ err }, 'uncaught exception');
  void shutdown('uncaughtException', 1);
});

try {
  // Don't accept traffic before connections exist (bounded wait; see waitUntilConnected).
  await deps.waitUntilConnected(5_000);
  await app.listen({ host: config.HOST, port: config.PORT });
  log.info(
    { env: config.NODE_ENV, db: redactUrl(config.DATABASE_URL), redis: redactUrl(config.REDIS_URL) },
    'api started',
  );
} catch (err) {
  log.fatal({ err }, 'failed to start (port in use?)');
  await deps.close();
  process.exit(1);
}
