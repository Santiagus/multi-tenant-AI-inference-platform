# M03 — Async Inference

Depends on: M02 | Read: `.agents/skills/async-workloads/SKILL.md`, `.agents/skills/typescript-fastify/SKILL.md`, `.agents/skills/postgresql/SKILL.md`

## Objective

Implement a reliable asynchronous job lifecycle.

## Deliverables

- POST job;
- queued/running/succeeded/failed/cancelled states;
- worker;
- retries with bounded backoff;
- idempotency;
- DLQ;
- cancellation semantics;
- artifact persistence;
- failure recovery tests.

## Acceptance criteria

Duplicate submission cannot create unintended duplicate work. Worker failure and retry behavior are tested. Job state remains consistent.

## Out of scope

Kubernetes scaling, external provider routing.

## Outcome

- Entry points: `POST /v1/jobs`, `GET /v1/jobs/:id`, `POST /v1/jobs/:id/cancel`, `GET /v1/jobs/dlq`, `POST /v1/worker/process-next`, `WORKER_ENABLED=true`.
- Monotonic state machine & idempotency: Enforced transitions (`QUEUED` -> `PROCESSING` -> `RETRYING`/`SUCCEEDED`/`FAILED`/`CANCELLED`) and SHA-256 request payload hash verification (`409 Conflict` on mismatched replay).
- Worker & bounded retries: `JobWorker` (`apps/api/src/application/job-worker.ts`) with `IInferenceExecutor`, exponential backoff (`calculateBackoffSeconds`), transient vs permanent error classification, and mid-flight cancellation checks.
- DLQ & artifact persistence: Exhausted/permanent failures quarantine to `inference-jobs-dlq`; worker resolves offloaded inputs and persists output artifacts to S3-compatible storage.
- Schema migration: `002_async_lifecycle.sql` adds `request_hash` and `max_retries` to `jobs`.
- Verification: 26 Python tests, 43 TypeScript unit/integration failure-recovery tests (100% line coverage across `domain/` and `application/`), verified via `make ci`.
- Deviations: none.
- Stubs left: real PyTorch GPU model execution in M04 (`IInferenceExecutor` currently defaults to `DefaultLocalInferenceExecutor`).

