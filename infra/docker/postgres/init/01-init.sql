-- Runs ONLY when the postgres data volume is first created.
-- Changing this file later has no effect until `pnpm stack:reset`.

-- FinSight app database (POSTGRES_DB) gets pgvector.
CREATE EXTENSION IF NOT EXISTS vector;

-- Langfuse gets its own database on the same server: logical isolation
-- without running a second Postgres container locally.
CREATE DATABASE langfuse;
