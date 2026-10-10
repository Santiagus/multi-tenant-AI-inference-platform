# M02 — Local Platform Skeleton

Depends on: M01 | Read: `.agents/skills/repository/SKILL.md`, `.agents/skills/typescript-fastify/SKILL.md`, `.agents/skills/postgresql/SKILL.md`, `.agents/skills/docker/SKILL.md`

## Objective

Create the smallest executable local platform.

## Deliverables

- Fastify API;
- PostgreSQL;
- local object storage;
- queue abstraction;
- basic job model;
- Docker Compose;
- configuration management;
- health/readiness endpoints;
- automated tests.

## Acceptance criteria

A local developer can start the stack, submit a job through the API, persist its state and inspect the resulting lifecycle.

## Out of scope

Real GPU inference, Kubernetes, AWS, RAG, provider routing.

## Outcome

- Entry points: `docker compose up -d`, `apps/api` (`pnpm test`), `POST /v1/jobs`, `GET /v1/jobs/:id`, `GET /healthz`, `GET /readyz`.
- Control plane API: Fastify server in `apps/api` with Zod validation, RFC 7807 problem details, and tenant context propagation.
- Storage & Queue abstractions: `IStorageClient` (MinIO/S3 + in-memory) and `IQueueClient` (ElasticMQ/SQS + in-memory).
- State & Persistence: PostgreSQL 16 migration (`001_initial_schema.sql`), connection pool, and tenant-scoped `PostgresJobRepository`.
- Lifecycle & Idempotency: Monotonic state machine (`QUEUED` -> `PROCESSING` -> `SUCCEEDED`/`FAILED`/`CANCELLED`) and deduplication.
- Verification: 26 Python unit tests, 28 TypeScript unit/integration tests, live Compose stack verified via `make ci`.
- Deviations: none.
- Stubs left: background inference worker daemon consuming queue in M03.
