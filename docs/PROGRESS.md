# FinSight AI — Progress Log

Status legend: ⬜ not started · 🟡 in progress · ✅ done
A phase is ✅ only when **every exit criterion is checked AND the explain-back is passed**.

## Current: Phase 0 — Engineering Foundations ✅ build complete · explain-back + first GitHub CI run pending

| Lesson | Topic                                                            | Status                              |
| ------ | ---------------------------------------------------------------- | ----------------------------------- |
| 0.1    | Monorepo, pnpm workspaces, strict TypeScript                     | ✅ (explain-back pending)           |
| 0.2    | Config & env validation (12-factor, zod, fail-fast)              | ✅ (explain-back pending)           |
| 0.3    | Docker & docker-compose (Postgres+pgvector, Redis, S3, Langfuse) | ✅ (explain-back pending)           |
| 0.4    | Fastify health endpoint (liveness vs readiness)                  | ✅ (explain-back pending)           |
| 0.5    | Testing pyramid: Vitest + Testcontainers                         | ✅ (explain-back pending)           |
| 0.6    | Lint/format + GitHub Actions CI                                  | ✅ (explain-back pending)           |
| 0.7    | ADR practice + explain-back                                      | ✅ ADRs done · explain-back pending |

Exit criteria

- [x] `pnpm test` green locally (57 tests: 53 unit + 4 integration) and in a clean Linux container simulating both CI jobs
- [ ] First real GitHub Actions run green (needs the repo pushed to GitHub)
- [x] `docker compose up` brings up all services healthy (`pnpm stack:up` core, `pnpm stack:up:obs` + Langfuse; verified functionally)
- [x] Config validated by zod at boot; missing env var → clear error, non-zero exit (automated in `config.test.ts`)
- [x] ADR 0001 accepted, amended by ADR 0002
- [ ] Explain-back passed

## Upcoming phases

- ⬜ **P1 Financial Data Engineering**: idempotent re-runs · quarantine on validation failure · lineage traceable · ~50 companies loaded
- ⬜ **P2 LLM Engineering Core**: gateway survives 429/500/timeouts · JSON repair or clean failure · every call traced with tokens+cost · explain attention & BPE
- ⬜ **P3 Baseline RAG**: resumable ingestion · dedup · "not found" on empty retrieval · ANN vs exact recall measured
- ⬜ **P4 Evaluation**: judge ≥80% agreement on 40 samples · reproducible runs · CI gate blocks degraded prompt
- ⬜ **P5 Advanced RAG**: +2 metrics over baseline · ≥95% numeric exact-match · unsupported-claim rate reported
- ⬜ **P6 Financial Tools**: property + fixture tests · 3 spreadsheet cross-checks
- ⬜ **P7 ML**: baselines + walk-forward for all experiments · leakage checklist · scratch vs library agree · reproducible from run ID
- ⬜ **P8 Agents**: 30-task eval reported · resume from checkpoint · budgets enforced
- ⬜ **P9 Product & Reports**: Playwright E2E · every claim linked to evidence/calculation
- ⬜ **P10 Security**: red-team suite in CI · cross-tenant isolation test
- ⬜ **P11 Production**: zero-touch deploy · dashboards · load test bottleneck found · 3 runbooks
- ⬜ **P12 Capstone**: docs, eval report, demo, mock interview

## Decisions log

- 2026-11-06: Roadmap accepted. See [adr/0001-tech-stack.md](adr/0001-tech-stack.md).
- 2026-11-06: pnpm pinned to 10.x via corepack (pnpm 12 native layout unsupported by corepack 0.34). TypeScript 7: `types` defaults to [], so each package declares its ambient types. Workspace packages resolve to `src` in dev via the `@finsight/source` export condition and to `dist` in production.
- 2026-11-06: `cagr` throws RangeError on invalid input rather than returning NaN, so the tool layer can return actionable errors to agents.
- 2026-11-06: Config: zod schemas, parsed once at boot, all problems reported together, values never echoed. Empty string = unset. No dotenv: Node 22 `process.loadEnvFile` for local dev only; real env always wins.
- 2026-11-06: Local stack: pgvector 0.8.7 on Postgres 17 (host port 5433, since a native PG service owns 5432); Redis 8.6 with noeviction + AOF (required for BullMQ); RustFS replaces MinIO (no longer published); Langfuse pinned to v3.227 (v4 exists; upgrade deliberately later) behind the `observability` profile (~2 GB RAM). Langfuse shares Postgres (own DB), Redis and S3 (own bucket).

- 2026-11-06: Phase 0 tooling (see [ADR 0002](adr/0002-phase0-tooling.md)): oxlint type-aware + Prettier (typescript-eslint can't run on TS 7); Turborepo for build/typecheck only; Vitest unit/integration projects; Testcontainers with the same images as compose; API split into buildApp/createDeps/createShutdown for testability; bounded wait for connections at startup.

## Open questions / parking lot

- Weekly time budget assumed at 15–20 hrs. Rescale if different.
- Langfuse v4 upgrade: evaluate before Phase 2 (when tracing is first used).
- Push to GitHub to get the first real CI run (and add branch protection requiring CI).
