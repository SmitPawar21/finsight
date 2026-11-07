# ADR 0002 — Phase 0 tooling and local infrastructure

- **Status**: Accepted
- **Date**: 2026-11-06
- **Amends**: [ADR 0001](0001-tech-stack.md)

## Context

Setting up Phase 0 ran into several facts that the original stack decision didn't anticipate. This record captures what we chose and why, so the reasons survive after the details are forgotten.

## Decisions

### 1. TypeScript 7 (native compiler), so linting moves from ESLint to oxlint

- TypeScript 7 is the Go-native compiler. It has **no JavaScript compiler API** (`ts.createProgram` is undefined).
- typescript-eslint needs that API and supports TypeScript `<6.1` only, so ESLint's type-aware rules (the valuable ones) can't run.
- **Choice:** `oxlint --type-aware` (rules executed by `oxlint-tsgolint`, built on typescript-go) plus Prettier for formatting.
- **Most important rule:** `no-floating-promises`. An un-awaited promise in LLM/agent code silently drops errors. It's verified to fire.
- **Rejected:** downgrading to TypeScript 6 (slower, going backwards); Biome (its type inference is its own, not the compiler's).
- **Revisit if** typescript-eslint adds TS 7 support and we need a rule oxlint lacks.

### 2. Workspace packages: source in dev, dist in prod

- Each package exports a custom `@finsight/source` condition that points to `src/*.ts`, alongside `types`/`default` that point to `dist/`.
- `tsc` (via `customConditions`), `tsx --conditions` and Vitest (`resolve.conditions`) all use source, so there's no build step during development and tests can't run against a stale `dist/`.
- Plain `node` in production ignores the custom condition and uses `dist/`.

### 3. Turborepo only for per-package, dependency-ordered tasks

- `build` and `typecheck` go through Turbo (cached; an unchanged rebuild drops from about 5 s to under 100 ms).
- `lint`, `format` and `test` stay single repo-wide commands. oxlint, Prettier and Vitest projects are already one fast pass, so per-package splitting adds overhead without benefit.

### 4. Tests: two Vitest projects

- `unit` (`*.test.ts`): no I/O, uses fakes and injected dependencies.
- `integration` (`*.int.test.ts`): Testcontainers starts the **same images** as `compose.yaml` on random ports. It already caught a real startup race (readiness probe vs the initial Redis connect) that the unit tests couldn't.
- Code is shaped for testability: `buildApp()` doesn't listen; `loadConfig(env)` is pure; `createShutdown({ exit })` takes an injected exit.

### 5. Local infrastructure

- **RustFS replaces MinIO.** MinIO stopped publishing community images in 2025; RustFS is S3-compatible under Apache-2.0.
- **Postgres on host port 5433**, because a native PostgreSQL service on the dev machine owns 5432. It's configurable via `POSTGRES_PORT`.
- **Redis uses `noeviction` + AOF.** BullMQ stores job state in Redis, and an evicting policy can silently drop queued jobs.
- **Langfuse pinned to v3.227, behind the `observability` compose profile.** It uses about 2 GB of RAM against about 210 MB for the core stack. v4 exists; upgrade deliberately, not by accident.
- **All ports bind to `127.0.0.1`.** Credentials are local-dev defaults, overridable through a root `.env`.

### 6. pnpm 10 via corepack

- pnpm 12's native-binary layout isn't launchable by the installed corepack (0.34).
- Dependency install scripts are blocked by default; `onlyBuiltDependencies` / `ignoredBuiltDependencies` record each reviewed decision.

## Consequences

- Faster type checking, at the cost of a younger lint ecosystem (fewer rules than typescript-eslint).
- Graceful shutdown on Windows can't be exercised with real signals (Windows has no SIGTERM). It's covered by unit tests with fake timers instead.
