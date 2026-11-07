# FinSight AI — Scope Analysis, Architecture, Stack & Learning Roadmap

## Context

[AboutProject.txt](../AboutProject.txt) describes a learning-first AI Engineering project: a financial research platform covering LLMs, RAG, agents, ML, data engineering and MLOps. The only constraint is TypeScript, with no Python. The repo has nothing else in it yet. This is the living roadmap. Progress is tracked in [PROGRESS.md](PROGRESS.md).

Assumed time budget: about 15–20 hrs/week, which puts the core roadmap at **~9–11 months**. Phases are sized in weeks so you can rescale them.

---

## 1. Scope Analysis

### 1.1 Missing features (add these; each one is interview-relevant)

| Missing                                                                                                                                    | Why it matters                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Authoritative data sources layer** (SEC EDGAR submissions + XBRL `companyfacts` API, a market-price API such as Alpha Vantage/FMP/Stooq) | Without real data, everything else is a toy. XBRL gives _structured_ numbers, so you don't have to rely on PDF table parsing for the key financials. |
| **Entity resolution** (ticker ↔ CIK ↔ company name ↔ fiscal calendar)                                                                      | Questions like "Apple's FY24 revenue" fail if "FY24" and the company aren't normalised.                                                              |
| **Deterministic calculation tools**                                                                                                        | LLMs are unreliable at arithmetic. Ratios, CAGR, DCF and risk metrics must be code the LLM _calls_, not text it generates.                           |
| **Structured-vs-unstructured routing**                                                                                                     | Numeric questions → SQL/XBRL; narrative questions ("risk factors") → RAG. This is one of the most important design decisions in the project.         |
| **Citation verification** (not just citation generation)                                                                                   | Checks that each claim is actually supported by the cited chunk. This is the core of "evidence-backed".                                              |
| **Evaluation datasets (golden set) built early**                                                                                           | You can't improve RAG or agents without a baseline. Most portfolio projects skip this.                                                               |
| **Prompt & model versioning, cost/token budgets per request**                                                                              | Production readiness, and cost is a common interview question.                                                                                       |
| **Auth, multi-tenancy, document-level access control**                                                                                     | Uploaded documents must not leak across users. Retrieval has to filter by tenant.                                                                    |
| **Indirect prompt-injection defence**                                                                                                      | Uploaded PDFs are untrusted input that goes straight into the prompt.                                                                                |
| **Compliance disclaimer / "not investment advice" policy guardrail**                                                                       | A realistic domain constraint. Refuse personalised buy/sell advice.                                                                                  |
| **Async job UX** (progress, cancellation, resumability)                                                                                    | Ingestion and multi-step agent runs take minutes, not milliseconds.                                                                                  |
| **Caching** (embedding cache, LLM response cache, semantic cache)                                                                          | Cost and latency optimisation you can measure.                                                                                                       |

### 1.2 Unnecessary or to be reframed

| Item                                                          | Recommendation                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **"Predictive analytics" as stock-price prediction**          | **Reframe.** Price prediction from public data barely beats a random walk and invites indefensible claims. Use problems where ML is defensible instead: peer clustering, accounting anomaly/red-flag detection, volatility forecasting, and a direction classifier evaluated _honestly_ against naive baselines. Leakage and walk-forward validation are the lessons. |
| **Both Qdrant and Pinecone**                                  | Pick one. Start with **pgvector** (one database, SQL hybrid search, transactional with metadata). Run Qdrant as a _comparison experiment_ in Phase 5, not as a dependency.                                                                                                                                                                                            |
| **Both GitHub Actions and Jenkins**                           | Drop Jenkins. GitHub Actions alone teaches the same CI/CD concepts.                                                                                                                                                                                                                                                                                                   |
| **True real-time streaming** (Kafka, websockets market feeds) | De-scope to **near-real-time** polling (BullMQ repeatable jobs every N minutes). Explain why Kafka isn't justified at this scale. That explanation is itself a good interview answer.                                                                                                                                                                                 |
| **Full lakehouse (Spark/Delta/Iceberg)**                      | Not realistic in JS. Learn the _concepts_ with S3 + Parquet + DuckDB (medallion layers). Be explicit that this is not a distributed engine.                                                                                                                                                                                                                           |
| **Too many agents**                                           | Cap it at a supervisor plus 4 specialists. More agents add cost and failure modes without adding learning.                                                                                                                                                                                                                                                            |
| **Full-blown LangChain.js chains**                            | Skip most of the chain abstractions. Use the raw SDK, then the Vercel AI SDK, and use **LangGraph.js** only for orchestration.                                                                                                                                                                                                                                        |

### 1.3 Honest JS/TS limitations (no false claims)

- **Classic ML**: there is no scikit-learn/XGBoost equivalent. `ml.js` packages and TensorFlow.js are much less mature. Mitigation: implement the algorithms from scratch (great for learning), and use `ml-matrix`/`ml.js` for verification. Datasets stay small (thousands to hundreds of thousands of rows), which is fine.
- **Dataframes**: Danfo.js is weakly maintained. Use **DuckDB (`@duckdb/node-api`) SQL** plus **Arquero** instead. This is actually closer to how real data teams work.
- **PDF table extraction**: JS parsers (`pdfjs-dist`/`unpdf`) extract text, not reliable table structure. Mitigation: prefer EDGAR HTML/XBRL; for uploaded PDFs, use page-image extraction with a vision LLM (or a managed parser) as a documented trade-off.
- **Experiment tracking**: MLflow is a Python server. Options: (a) your own minimal tracker in Postgres (recommended, for learning), or (b) MLflow run in Docker and called via its REST API. That is infrastructure, not Python code you write.
- **RAG eval libraries** (Ragas, DeepEval) are Python. Implement the metrics yourself. **Promptfoo** (Node) covers prompt regression testing.
- **Local model inference**: `@huggingface/transformers` (transformers.js, ONNX) runs embedding and cross-encoder reranker models in Node. That's enough for learning, but it's CPU-bound and slower than Python/GPU serving.

---

## 2. Technical Architecture

```
                         ┌──────────────────────────────┐
  Browser ──HTTPS──▶     │ apps/web  (Next.js, React)   │  UI, auth session, streaming chat,
                         │  - SSE consumer, citation UI │  citation viewer, report viewer
                         └──────────────┬───────────────┘
                                        │ REST + SSE
                         ┌──────────────▼───────────────┐
                         │ apps/api  (Fastify, Node)    │  authz, rate limit, request validation (zod)
                         │  ├ Query Router (struct vs   │
                         │  │   narrative vs agentic)   │
                         │  ├ RAG service               │──┐
                         │  ├ Agent runtime (LangGraph) │  │  enqueue long jobs
                         │  └ LLM Gateway (providers,   │  │
                         │     retries, fallback, cost, │  │
                         │     cache, guardrails)       │  │
                         └───┬────────┬────────┬────────┘  │
                             │        │        │           ▼
             ┌───────────────▼┐  ┌────▼────┐ ┌─▼──────────────────────┐
             │ PostgreSQL     │  │ Redis   │ │ apps/worker (BullMQ)   │
             │ + pgvector     │  │ cache,  │ │ - ingestion pipeline   │
             │ + tsvector FTS │  │ queues, │ │ - EDGAR/market ETL     │
             │ app data, chunks│ │ rate lim│ │ - embedding batches    │
             │ financial facts│  └─────────┘ │ - ML training/inference│
             │ evals, runs    │              │ - long agent runs      │
             └───────▲────────┘              └──────────┬─────────────┘
                     │ load gold layer                   │
             ┌───────┴──────────────────────────────────▼───┐
             │ S3 "lake": bronze (raw JSON/PDF/HTML) →       │
             │ silver (clean Parquet) → gold (features/marts)│
             │ queried by DuckDB                             │
             └───────────────────────────────────────────────┘
   Cross-cutting: Langfuse (LLM traces, prompts, eval datasets), OpenTelemetry + pino logs,
   CloudWatch metrics/alarms, GitHub Actions CI (tests + eval gate), AWS CDK (TypeScript IaC)
```

**Monorepo layout** (pnpm workspaces + Turborepo):

```
apps/web        Next.js UI
apps/api        Fastify HTTP API + SSE
apps/worker     BullMQ consumers + schedulers
packages/db     schema, migrations, query helpers
packages/llm    LLM gateway: providers, retries, fallback, cost, cache, tracing
packages/rag    parsing, chunking, embedding, retrieval, rerank, citations
packages/agents graphs, tools, memory, guardrails
packages/fin    deterministic finance: ratios, DCF, portfolio & risk math
packages/ml     from-scratch models, training, eval, registry client
packages/data   ETL connectors, validation, lake (DuckDB/Parquet), lineage
packages/evals  datasets, metrics, runners, CI gate
infra/          AWS CDK app, docker-compose
docs/           ROADMAP, PROGRESS, ADRs
```

**Key request flows**

1. **Q&A**: query → guardrail (input) → router classifies _structured / narrative / multi-step_ → (SQL over XBRL facts) | (hybrid retrieve → rerank → grounded answer with citations → citation verifier) | (agent) → guardrail (output) → SSE stream → trace in Langfuse.
2. **Ingestion**: upload → S3 bronze → job queued → parse → clean → chunk → embed (batched, cached by content hash) → upsert chunks + metadata + lineage → status events.
3. **Research task**: user goal → planner → supervisor dispatches specialists (Filings/RAG, Fundamentals/SQL, Quant/Risk, Market) → critic checks evidence → **human approval checkpoint** → writer produces report sections → stored and exported.

---

## 3. Final Technology Stack

| Concern                        | Choice                                                                                                                                    | Trade-off / why not the alternative                                                                                                                                                                                                                  |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Language/runtime               | TypeScript (strict), Node 22 LTS                                                                                                          | —                                                                                                                                                                                                                                                    |
| Monorepo                       | pnpm + Turborepo                                                                                                                          | Nx is heavier. A single package gets messy quickly.                                                                                                                                                                                                  |
| Frontend                       | Next.js (App Router) + Tailwind + shadcn/ui                                                                                               | Kept as UI/BFF only. Long agent runs are not suited to serverless route handlers.                                                                                                                                                                    |
| API                            | **Fastify**                                                                                                                               | Fast, schema-first, great with zod. Express is older and has no built-in validation. Hono is fine too.                                                                                                                                               |
| Validation / structured output | **zod**                                                                                                                                   | Shared across API, LLM structured outputs and tool schemas.                                                                                                                                                                                          |
| Database                       | PostgreSQL 17 + **pgvector** + built-in FTS                                                                                               | One store for relational data, vectors and BM25-style search. Fewer moving parts than a separate vector DB.                                                                                                                                          |
| ORM                            | **Drizzle** (changed from Prisma)                                                                                                         | Prisma has no first-class pgvector/tsvector types, so you end up writing raw SQL for exactly the queries you need to learn. Drizzle is SQL-first and supports pgvector. If you strongly prefer Prisma, it works with `$queryRaw` for vector queries. |
| Vector DB comparison           | Qdrant (Docker), Phase 5 experiment only                                                                                                  | Pinecone is managed and teaches less. Qdrant is good for an HNSW-tuning comparison.                                                                                                                                                                  |
| LLM access                     | Official OpenAI + Gemini SDKs first, then **Vercel AI SDK** (`ai`) as the provider abstraction                                            | The AI SDK is lighter than LangChain, with good streaming, tool calling and zod structured outputs.                                                                                                                                                  |
| Model strategy                 | One strong model + one cheap/fast model per provider, chosen by _your eval results_                                                       | Learn model selection empirically, not from leaderboards.                                                                                                                                                                                            |
| Agent orchestration            | **LangGraph.js** (after a from-scratch loop)                                                                                              | Explicit state graph, checkpointing, interrupts for human-in-the-loop. Mastra is a credible TS alternative. Skip LangChain chains.                                                                                                                   |
| Embeddings                     | Provider API embeddings + **transformers.js** local model for comparison                                                                  | Lets you compare quality, cost and latency yourself.                                                                                                                                                                                                 |
| Reranking                      | transformers.js cross-encoder (bge-reranker class), optional Cohere Rerank API                                                            | —                                                                                                                                                                                                                                                    |
| Data lake                      | S3 (RustFS locally) + Parquet + **DuckDB** (`@duckdb/node-api`)                                                                           | Teaches medallion/lakehouse _concepts_. Not a distributed engine (stated honestly).                                                                                                                                                                  |
| Dataframes                     | DuckDB SQL + Arquero                                                                                                                      | Danfo.js is under-maintained.                                                                                                                                                                                                                        |
| ML                             | From-scratch TS + `ml-matrix` + `ml.js` (verification) + **TensorFlow.js (`tfjs-node`)** for neural nets                                  | See §1.3 limitations.                                                                                                                                                                                                                                |
| Queue / jobs                   | **BullMQ** on Redis                                                                                                                       | Retries, backoff, repeatable jobs, flows (parent/child jobs) suit ingestion pipelines.                                                                                                                                                               |
| Cache / rate limit             | Redis                                                                                                                                     | —                                                                                                                                                                                                                                                    |
| Auth                           | Better Auth (or Auth.js) + Postgres **row-level security** for tenant isolation                                                           | RLS gives you a defensible "how do you prevent data leakage" answer.                                                                                                                                                                                 |
| LLM observability              | **Langfuse** (self-host in Docker)                                                                                                        | Traces, prompt management/versioning, datasets and experiments.                                                                                                                                                                                      |
| General observability          | pino logs + OpenTelemetry → CloudWatch (prod)                                                                                             | —                                                                                                                                                                                                                                                    |
| Testing                        | **Vitest** (unit/integration), Testcontainers (real Postgres/Redis), Playwright (E2E), Promptfoo (prompt regressions), k6 (load)          | Vitest is faster and ESM-native, which is why it's preferred over Jest.                                                                                                                                                                              |
| Experiment tracking            | Own minimal tracker in Postgres (runs, params, metrics, artifacts in S3) + Langfuse experiments for LLM                                   | MLflow-via-REST is optional.                                                                                                                                                                                                                         |
| Containers                     | Docker + docker-compose (local)                                                                                                           | —                                                                                                                                                                                                                                                    |
| CI/CD                          | **GitHub Actions**                                                                                                                        | Jenkins dropped.                                                                                                                                                                                                                                     |
| Cloud / IaC                    | AWS: ECS Fargate, RDS Postgres (pgvector), ElastiCache or self-run Redis, S3, Secrets Manager, CloudWatch, ALB. **AWS CDK in TypeScript** | CDK keeps IaC in TS. Budget tier: a single EC2 with docker-compose, about $15–30/mo. Full tier costs more; tear it down when not in use.                                                                                                             |

---

## 4. Phased Roadmap

Legend: **[F]** foundational, **[A]** advanced. Every phase follows _concept → architecture → from-scratch version → library, and what it abstracts_. Every phase also ends with an **explain-back checkpoint**: you explain the core concepts to me without notes before we move on.

### Dependency graph

```
P0 ─▶ P1 (data) ─┬──────────────▶ P6 (fin tools) ─▶ P7 (ML)
     │           │                     │              │
     └▶ P2 (LLM) ─▶ P3 (RAG) ─▶ P4 (evals) ─▶ P5 (adv RAG)
                                   │              │
                                   └──────▶ P8 (agents) ◀── P6, P5
                                                 │
                                   P9 (product/reports) ─▶ P10 (security) ─▶ P11 (prod) ─▶ P12
```

P1 and P2 can be interleaved. P7 can run in parallel with P8 once P6 is done.

---

### Phase 0 — Engineering Foundations [F] (1–2 wks)

- **Concepts**: monorepo structure, strict TS, env/config management, ADRs (architecture decision records), testing pyramid, Docker basics, 12-factor apps.
- **Build**: workspace skeleton, docker-compose (Postgres+pgvector, Redis, S3-compatible store, Langfuse), Fastify health endpoint, Vitest + Testcontainers, lint/format, a first GitHub Actions workflow (typecheck + test).
- **Deliverables**: running local stack, `docs/adr/0001-tech-stack.md`, `PROGRESS.md`.
- **Exit criteria**: `pnpm test` runs green in CI. `docker compose up` brings up all services. Config is validated by zod at boot and fails fast on missing env vars.

### Phase 1 — Financial Data Engineering [F] (3 wks)

- **Concepts**: ETL vs ELT, batch vs near-real-time, idempotency, incremental loads/watermarks, schema-on-read vs schema-on-write, medallion layers, Parquet/columnar storage, data quality dimensions, lineage, SQL window functions, rate-limited API clients, financial statement basics (IS/BS/CF, fiscal periods, XBRL tags).
- **From scratch**: rate-limited, retrying HTTP client. Idempotent loader keyed by (CIK, tag, period, filing accession).
- **Build**: EDGAR connectors (submissions, companyfacts), a daily price connector; bronze → silver → gold via DuckDB; a `financial_facts` table in Postgres; entity resolution (ticker↔CIK); validation rules (balance sheet balances, no future dates, unit consistency); a lineage table (source → job run → output); BullMQ repeatable jobs.
- **Library introduced**: DuckDB, BullMQ. What each abstracts: columnar execution, job state machine.
- **Deliverables**: ~50 companies' 5-year fundamentals + daily prices loaded; data-quality report; SQL notebook of 10 analytical queries (YoY growth with `LAG`, rolling averages).
- **Exit criteria**: re-running any job produces no duplicates. A validation failure quarantines the record and doesn't crash the job. Any gold row can be traced back to its source file.

### Phase 2 — LLM Engineering Core [F] (3 wks)

- **Concepts**: transformer architecture (tokens, embeddings, self-attention, positional encoding, decoding, temperature/top-p), tokenisation (BPE), context windows and "lost in the middle", prompt engineering patterns, structured outputs/JSON schema, function/tool calling protocol, streaming (SSE), async concurrency, retries with exponential backoff + jitter, circuit breakers, provider fallback, cost accounting.
- **From scratch**: toy BPE tokenizer; scaled dot-product attention on small matrices in TS; a raw `fetch` call to each provider (no SDK) including manual SSE stream parsing; a manual tool-calling loop.
- **Build**: `packages/llm` gateway: provider interface, retries/fallback, timeouts, token & cost logging, Langfuse tracing, zod-validated structured outputs with a repair-retry. Then swap the internals to the Vercel AI SDK and diff what it abstracts.
- **Deliverables**: CLI that answers "What was MSFT's revenue growth?" by calling a SQL tool over Phase 1 data. Model comparison table (quality on 20 hand-made prompts, latency p50/p95, cost).
- **Exit criteria**: gateway survives simulated 429/500/timeouts (tested). Invalid JSON output is repaired or fails cleanly. Every call has a trace with tokens and cost. You can explain attention and BPE on a whiteboard.

### Phase 3 — Document Ingestion & Baseline RAG [F] (3–4 wks)

- **Concepts**: why RAG vs fine-tuning vs long context; parsing (HTML/PDF), cleaning, chunking strategies (fixed, recursive, structure-aware by section/Item 1A/7), chunk overlap; embeddings and vector geometry (cosine vs dot vs L2, normalisation); exact kNN vs ANN; **HNSW** and IVF; metadata design; grounding and citation prompting.
- **From scratch**: brute-force cosine kNN in TS, benchmarked against pgvector HNSW (recall vs latency). Recursive chunker.
- **Build**: upload → S3 → BullMQ ingestion flow; 10-K section-aware chunker; embedding batches with a content-hash cache; `chunks` table (tenant, company, doc type, fiscal year, section, page) + HNSW index; grounded answer endpoint that streams answers with `[n]` citations linking to chunk and page.
- **Deliverables**: ingest 20+ 10-K filings; Q&A with clickable citations.
- **Exit criteria**: ingestion is resumable after a worker crash. Duplicate uploads are deduped. The model says "not found in documents" when retrieval is empty. You've measured the ANN-vs-exact recall gap.

### Phase 4 — Evaluation Foundations [F → A] (2 wks) — _before optimising_

- **Concepts**: offline vs online eval; golden datasets and how to build them (synthetic generation + human review); retrieval metrics (Recall@k, Precision@k, MRR, nDCG); generation metrics (faithfulness/groundedness, answer relevance, correctness, citation precision/recall); LLM-as-judge and its biases (position, verbosity, self-preference); judge calibration against human labels (agreement, Cohen's κ); statistical significance on small eval sets (bootstrap CIs).
- **From scratch**: all metrics implemented in `packages/evals`; LLM judge with a rubric and structured verdicts.
- **Build**: golden set of ~150 Q/A/evidence triples (numeric, narrative, multi-hop, unanswerable); eval runner; results stored per run (prompt version, model, retriever config); Langfuse datasets; **CI eval gate** (fail the PR if faithfulness or recall drops by more than X).
- **Deliverables**: baseline eval report for the Phase 3 system.
- **Exit criteria**: judge agrees with your manual labels at least 80% on 40 samples. The eval is reproducible (fixed seeds, versioned dataset). The CI gate demonstrably blocks a deliberately degraded prompt.

### Phase 5 — Advanced RAG [A] (3–4 wks)

Each technique is an **experiment measured against the Phase 4 baseline**. Keep only what wins.

- **Concepts**: lexical retrieval (TF-IDF, **BM25** math), hybrid search and **Reciprocal Rank Fusion**, metadata filtering (pre- vs post-filter pitfalls with ANN), cross-encoder vs bi-encoder reranking, query rewriting/multi-query/HyDE, parent-child and contextual chunk enrichment, table-aware chunking, the query router (structured vs narrative), self-check/corrective RAG, citation verification via NLI-style entailment checks, context compression.
- **From scratch**: BM25 scorer in TS (then Postgres FTS); RRF; a claim-level citation verifier.
- **Build**: hybrid retriever, reranker (transformers.js), router (XBRL/SQL vs RAG), verifier that strips or flags unsupported claims; Qdrant comparison benchmark.
- **Deliverables**: ablation table (technique → Δ recall@5, Δ faithfulness, Δ latency, Δ cost).
- **Exit criteria**: measured improvement over baseline on at least 2 metrics. Numeric questions answered from structured data with 95%+ exact-match on the numeric subset. Unsupported-claim rate is reported.

### Phase 6 — Deterministic Financial Analytics as Tools [F] (2–3 wks)

- **Concepts**: financial ratios (profitability, liquidity, leverage, efficiency), CAGR, DCF and WACC, returns (simple vs log), volatility, covariance/correlation, beta, Sharpe/Sortino, max drawdown, VaR/CVaR (historical and parametric), mean-variance portfolio theory and the efficient frontier, floating-point and decimal precision.
- **From scratch**: everything in `packages/fin` (matrix ops via `ml-matrix`); mean-variance optimisation (closed form + projected gradient with constraints).
- **Build**: tool wrappers with zod schemas so the LLM/agents can call them; portfolio analysis endpoint.
- **Deliverables**: tested finance library; portfolio risk report for a sample portfolio.
- **Exit criteria**: property-based and fixture tests (e.g. weights sum to 1, VaR is monotonic in confidence). Results cross-checked against a spreadsheet on 3 cases.

### Phase 7 — Machine Learning [F → A] (4–5 wks)

- **Concepts**: probability and statistics refresher (distributions, expectation, variance, MLE, hypothesis testing, bias-variance); preprocessing (scaling, imputation, winsorising fat tails); feature engineering from fundamentals and prices; **look-ahead bias and leakage** (point-in-time data: use filing date, not period end); time-series cross-validation (walk-forward); linear/logistic regression with gradient descent and regularisation (L1/L2); decision trees; k-means and PCA; anomaly detection (z-score, Mahalanobis, isolation forest); evaluation (RMSE/MAE, ROC-AUC, PR-AUC, calibration, confusion matrix); baselines; neural nets/backprop (TF.js MLP); model versioning, registry, inference.
- **From scratch**: linear and logistic regression (GD), k-means, PCA (via covariance eigen-decomposition), isolation forest, a 2-layer MLP with manual backprop. Then TF.js and `ml.js` versions to compare.
- **ML experiments (the "meaningful" ones)**:
  1. **Peer clustering**: k-means + PCA on ratio vectors → "find comparable companies" tool.
  2. **Accounting red-flag detection**: anomaly scores on fundamentals (accruals, sudden margin shifts) → feeds the risk agent.
  3. **Volatility forecasting**: EWMA baseline vs regression/MLP → feeds VaR.
  4. **Direction classifier** (e.g. post-earnings 20-day excess return > 0): walk-forward validated, compared with a majority-class baseline, including an honest write-up if it doesn't beat the baseline.
- **Build**: minimal experiment tracker (runs, params, metrics, artifact in S3), model registry table (version, stage, metrics), batch inference job, model-as-tool for agents.
- **Exit criteria**: every experiment has a baseline and a walk-forward eval. There is a leakage checklist. The from-scratch and library implementations agree within tolerance. Models are reproducible from the run ID.

### Phase 8 — Agentic AI [A] (4–5 wks)

- **Concepts**: agent = LLM + tools + loop + state; ReAct; plan-and-execute; task decomposition; supervisor vs swarm multi-agent patterns (and when _not_ to use multi-agent); state graphs and checkpointing; short-term (thread) vs long-term (user/semantic) memory; context management for long runs (summarisation, scratchpads); human-in-the-loop interrupts; guardrails (tool allow-lists, budgets: max steps/tokens/cost, timeouts); error recovery (tool retry, re-plan, graceful degradation); agent evaluation (task success, tool-call accuracy, trajectory eval, cost per task).
- **From scratch**: a ReAct loop with step budget and tool registry (about 150 lines), then a hand-rolled state machine. _Then_ re-implement it in LangGraph.js and document what it gives you (checkpointer, interrupts, streaming of node events).
- **Build**: supervisor + specialists: **Filings Analyst** (RAG), **Fundamentals Analyst** (SQL/XBRL + fin tools), **Quant/Risk Analyst** (fin + ML tools), **Critic** (evidence check). Planner output is a zod-typed plan. Postgres checkpointer for resumable runs. HITL approval before report finalisation. Long runs execute in the worker with progress streamed over SSE.
- **Deliverables**: "Compare NVDA vs AMD on profitability, risk and key risk factors" research run, end to end, with a trace.
- **Exit criteria**: agent eval set of 30 tasks with success rate, average steps, average cost and tool-error recovery rate reported. A killed worker resumes from its checkpoint. Budgets are enforced (tested).

### Phase 9 — Product UI & Report Generation [F] (2–3 wks)

- **Concepts**: streaming UX, optimistic UI, long-running job UX, report generation as structured outline → section drafting → assembly; long-document consistency.
- **Build**: Next.js chat with token streaming; citation side panel showing the source page; document library; portfolio page with charts; agent-run timeline viewer (steps, tools, approvals); report export (Markdown → PDF).
- **Exit criteria**: Playwright E2E for upload → ask → cite → report. Every report claim links to evidence or a calculation.

### Phase 10 — Security & Guardrails Hardening [A] (1–2 wks)

- **Concepts**: OWASP Top 10 for LLM apps; direct vs indirect prompt injection; data exfiltration via tools/markdown links; least-privilege tools; tenant isolation (RLS); PII handling; rate limiting and abuse; secrets management; audit logs; domain policy (no personalised investment advice).
- **Build**: auth + RLS; input/output guardrail layer (injection heuristics + classifier prompt, policy check, output schema validation); content from documents wrapped and marked as untrusted data; per-user rate and cost limits; audit log.
- **Exit criteria**: red-team suite (~30 adversarial prompts and poisoned documents) runs in CI with pass rate tracked. A cross-tenant retrieval test proves isolation.

### Phase 11 — Production: Deploy, Monitor, Optimise [A] (3 wks)

- **Concepts**: container best practices (multi-stage builds), CI/CD stages (lint → test → eval gate → build → deploy), environment promotion, IaC, blue/green or rolling deploys, SLOs (latency, error rate), LLM-specific monitoring (cost/request, token usage, faithfulness sampled online, user feedback), data/model drift monitoring, caching strategies (exact + semantic cache), load testing, horizontal scaling of workers.
- **Build**: Dockerfiles; GitHub Actions pipeline; AWS CDK stacks (budget tier first); CloudWatch dashboards and alarms; Langfuse in prod; online eval sampling (judge on 5% of traffic); semantic cache; k6 load test; drift job on ML features.
- **Exit criteria**: deploy from merge to main with zero manual steps. A dashboard shows p95 latency, cost/day and error rate. A load test reports the capacity limit and the bottleneck. A runbook exists for 3 failure scenarios (provider outage, queue backlog, DB saturation).

### Phase 12 — Capstone & Interview Readiness (1–2 wks)

- **Deliverables**: README with architecture diagram, ADRs, eval report (RAG ablations, agent metrics, ML results including negative results), cost analysis, a 5-minute demo video, and a "lessons and trade-offs" doc.
- **Exit criteria**: mock interview. You defend each major decision and answer the questions in §6.

**Total: ~32–40 weeks.** Stretch goals, only after Phase 12: fine-tune a small model via a provider API for extraction and compare it with prompting; earnings-call transcript ingestion; an MCP server exposing FinSight tools; GraphRAG over company relationships.

---

## 5. Per-phase Working Rules (from your brief)

- One milestone at a time. Inside a phase: concept lesson → small task for you → you implement → I review → tests → explain-back → update `PROGRESS.md`.
- No moving on until the exit criteria pass and the explain-back is satisfactory.
- Every phase adds edge cases and failure-injection tests. "Debugging techniques" covers traces, structured logs and reproducible eval runs.

---

## 6. Top AI Engineering Concepts to Explain in Interviews

1. **Transformer basics**: tokens, attention, context windows, decoding parameters, and why LLMs hallucinate.
2. **RAG vs fine-tuning vs long context**: when to use each.
3. **Chunking trade-offs**, and structure-aware chunking for financial filings.
4. **Embeddings & ANN**: cosine similarity, HNSW parameters, and the recall/latency trade-off you measured.
5. **Hybrid search**: BM25 math, RRF, and why lexical retrieval matters for tickers and numbers.
6. **Reranking**: bi-encoder vs cross-encoder and its cost.
7. **Structured vs unstructured routing**: why numbers come from XBRL/SQL, not from RAG.
8. **Grounding & citation verification**: measuring and reducing hallucination.
9. **Evaluation methodology**: golden sets, retrieval and generation metrics, LLM-as-judge bias and calibration, CI eval gates.
10. **Structured outputs & tool calling**: schema design, validation, repair loops.
11. **Agent design**: ReAct vs plan-and-execute, when multi-agent is (not) worth it, state/checkpointing, HITL, budgets.
12. **Agent evaluation**: task success, trajectory and tool accuracy, cost per task.
13. **Reliability**: retries/backoff, fallbacks, circuit breakers, idempotent jobs, resumability.
14. **Prompt injection** (especially indirect via documents) and defence-in-depth guardrails.
15. **Multi-tenant data isolation** in retrieval (RLS, metadata filters).
16. **Cost & latency optimisation**: model tiering, caching (exact and semantic), batching, streaming.
17. **LLM observability**: tracing, prompt versioning, online eval, feedback loops.
18. **ML rigour**: leakage, look-ahead bias, walk-forward validation, baselines, calibration, and reporting negative results.
19. **Data engineering**: idempotent incremental ETL, medallion layers, data quality, lineage.
20. **Honest stack limits**: what JS can and can't do vs Python/Spark, and how you'd scale the system beyond it.

---
