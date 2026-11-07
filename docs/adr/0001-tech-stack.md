# ADR 0001 — Technology Stack

- **Status**: Accepted (2026-11-06, end of Phase 0). Amended by [ADR 0002](0002-phase0-tooling.md) for linting and local infrastructure.
- **Date**: 2026-11-06

## Context

FinSight AI is a learning-first AI Engineering project. Hard constraint: TypeScript/JavaScript only, no Python. Goals: depth of understanding, a production-oriented architecture, and few moving parts for a solo developer.

## Decisions

| Concern       | Decision                                                     | Main alternative rejected       | Reason                                                                                                                                                                 |
| ------------- | ------------------------------------------------------------ | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Monorepo      | pnpm workspaces + Turborepo                                  | Nx, single package              | Light. Strict dependency isolation.                                                                                                                                    |
| API           | Fastify                                                      | Express                         | Schema-first, faster, first-class TS.                                                                                                                                  |
| Frontend      | Next.js (UI/BFF only)                                        | Next.js as full backend         | Long agent runs and SSE need a long-lived server.                                                                                                                      |
| Validation    | zod everywhere                                               | —                               | One schema language for API, LLM output and tools.                                                                                                                     |
| DB            | PostgreSQL 17 + pgvector + FTS                               | Pinecone / Qdrant as primary    | One store for relational data, vectors and lexical search. Transactional metadata. Qdrant kept as a Phase 5 benchmark.                                                 |
| ORM           | **Drizzle**                                                  | Prisma (initial preference)     | Prisma lacks native pgvector/tsvector types, so the important queries would be raw SQL anyway. Drizzle is SQL-first. _Reversible_: Prisma + `$queryRaw` is acceptable. |
| LLM access    | Raw HTTP → official SDKs → Vercel AI SDK                     | LangChain.js chains             | Learn the protocol first. The AI SDK is a thin abstraction.                                                                                                            |
| Agents        | Hand-rolled loop → LangGraph.js                              | CrewAI-style frameworks, Mastra | Explicit state graph, checkpointing, HITL interrupts.                                                                                                                  |
| Lake          | S3 (RustFS locally) + Parquet + DuckDB                       | Spark/Delta/Iceberg             | Spark/Delta/Iceberg aren't viable in JS. DuckDB teaches the concepts honestly; it is not a distributed engine.                                                         |
| ML            | From scratch + ml-matrix/ml.js + TensorFlow.js               | Python scikit-learn             | Constraint. JS ML is immature, so we implement algorithms ourselves.                                                                                                   |
| Jobs          | BullMQ (Redis)                                               | Kafka, SQS                      | Retries, flows and repeat jobs at our scale. Kafka isn't justified.                                                                                                    |
| Testing       | Vitest, Testcontainers, Playwright, Promptfoo, k6            | Jest                            | ESM-native and fast. Real dependencies in integration tests.                                                                                                           |
| Lint / format | oxlint (type-aware, via tsgolint) + Prettier (see ADR 0002)  | ESLint + typescript-eslint      | typescript-eslint cannot run on TypeScript 7 (no JS compiler API). oxlint's type-aware mode is built on typescript-go.                                                 |
| Observability | Langfuse (self-hosted) + pino + OpenTelemetry                | LangSmith                       | Open source, self-hostable, has datasets/experiments.                                                                                                                  |
| CI/CD         | GitHub Actions                                               | Jenkins                         | One CI system is enough. Jenkins adds server ops without adding learning.                                                                                              |
| IaC/Cloud     | AWS CDK (TS) on ECS Fargate/RDS/S3; budget tier = single EC2 | Terraform                       | Keeps IaC in TypeScript.                                                                                                                                               |

## Consequences

- Fewer infrastructure components to operate locally (no separate vector DB).
- Some ML and data capabilities are deliberately weaker than the Python ecosystem. These limits are documented in ROADMAP §1.3.
- Vector and FTS queries are hand-written SQL, which is intentional for learning.
