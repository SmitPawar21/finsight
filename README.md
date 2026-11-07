# FinSight AI

An AI financial research and investment analysis platform, built as a learning-first AI Engineering project in TypeScript.

- Roadmap: [docs/ROADMAP.md](docs/ROADMAP.md)
- Progress: [docs/PROGRESS.md](docs/PROGRESS.md)
- Decisions: [docs/adr/](docs/adr/)

## Prerequisites

- Node 22 (see `.nvmrc`)
- pnpm via corepack: `corepack enable` (or `corepack pnpm …`)
- Docker Desktop

## Quick start

```sh
pnpm install
cp .env.example .env                    # optional: compose overrides
cp apps/api/.env.example apps/api/.env  # API config for local dev
pnpm stack:up        # Postgres+pgvector (:5433), Redis (:6379), S3/RustFS (:9000, console :9001)
pnpm dev:api         # http://127.0.0.1:3001/health/live and /health/ready
```

Optional LLM observability (about 2 GB RAM): `pnpm stack:up:obs`, then Langfuse at http://localhost:3100 (`dev@finsight.local` / `finsight-dev-password`).

## Commands

| Command                                        | What it does                                                        |
| ---------------------------------------------- | ------------------------------------------------------------------- |
| `pnpm check`                                   | Everything CI runs: lint → format check → typecheck → build → tests |
| `pnpm test` / `test:unit` / `test:int`         | All tests / unit only / integration only (needs Docker)             |
| `pnpm lint` / `lint:fix`                       | Type-aware oxlint                                                   |
| `pnpm format` / `format:check`                 | Prettier                                                            |
| `pnpm build` / `typecheck`                     | Turborepo-cached, dependency-ordered                                |
| `pnpm stack:up` / `stack:down` / `stack:reset` | Start / stop / stop and delete all local data                       |

## Layout

```
apps/api          Fastify API (health endpoints, graceful shutdown)
packages/config   zod-validated environment config
packages/fin      deterministic finance functions
infra/docker      container init scripts
docs/             roadmap, progress log, ADRs
```
