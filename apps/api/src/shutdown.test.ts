import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pino } from 'pino';
import { createShutdown } from './shutdown.js';
import type { AppState } from './app.js';

const log = pino({ level: 'silent' });

function setup(steps: Array<{ name: string; run: () => Promise<unknown> }>, timeoutMs = 1_000) {
  const state: AppState = { shuttingDown: false };
  const exit = vi.fn<(code: number) => void>();
  const shutdown = createShutdown({ log, state, steps, timeoutMs, exit });
  return { state, exit, shutdown };
}

describe('createShutdown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('marks not-ready FIRST, runs steps in order, then exits 0', async () => {
    const order: string[] = [];
    let readyFlagDuringHttpClose: boolean | undefined;
    const { state, exit, shutdown } = setup([
      {
        name: 'http',
        run: async () => {
          readyFlagDuringHttpClose = state.shuttingDown;
          order.push('http');
        },
      },
      { name: 'deps', run: async () => void order.push('deps') },
    ]);

    await shutdown('SIGTERM');

    expect(readyFlagDuringHttpClose).toBe(true);
    expect(order).toEqual(['http', 'deps']);
    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
  });

  it('still runs later steps if one fails, and exits 1', async () => {
    const depsClosed = vi.fn<() => void>();
    const { exit, shutdown } = setup([
      { name: 'http', run: async () => Promise.reject(new Error('boom')) },
      { name: 'deps', run: async () => depsClosed() },
    ]);
    await shutdown('SIGTERM');
    expect(depsClosed).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('forces exit(1) when a step hangs past the timeout', async () => {
    const { exit, shutdown } = setup([{ name: 'http', run: () => new Promise(() => {}) }], 5_000);
    void shutdown('SIGTERM');
    await vi.advanceTimersByTimeAsync(4_999);
    expect(exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('a second signal forces exit(1) immediately', async () => {
    const { exit, shutdown } = setup([{ name: 'http', run: () => new Promise(() => {}) }]);
    void shutdown('SIGINT');
    await shutdown('SIGINT');
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('propagates a non-zero requested exit code (e.g. after a crash)', async () => {
    const { exit, shutdown } = setup([]);
    await shutdown('uncaughtException', 1);
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });
});
