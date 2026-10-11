---
name: async-workloads
description: Queues, job lifecycle states, idempotency, retries, DLQ, cancellation and Russian Doll decorator pipelines for asynchronous inference jobs.
---

# Async Workloads

We pursue enterprise-grade asynchronous workload execution that is **modular, auditable, scalable, and profiled**.
Job processing must be idempotent, observable, retry-safe, bounded and recoverable.

- **Explicit Monotonic State Machine:** Model explicit job states (`QUEUED`, `PROCESSING`, `RETRYING`, `SUCCEEDED`, `FAILED`, `CANCELLED`) with atomic/optimistic transition guards so terminal states cannot be overwritten.
- **Russian Doll (Decorator) Composition on Ports & Consumers:** Wrap domain ports, queue consumers, and provider adapters (`IInferenceExecutor`, storage/queue adapters) using composable Russian Doll decorators (e.g. `Tracing` → `Profiling` → `CoreExecutor`) to centralize wall-clock/throughput profiling, audit metadata, and error normalization without polluting state-machine orchestration.
- **Bounded Retries & Error Classification:** Distinguish transient from permanent failures; apply bounded exponential backoff on transient failures.
- **Dead-Letter Queue (DLQ):** Quarantine exhausted or unrecoverable work in a DLQ with structured failure metadata (`error_code`, `failure_reason`, `retry_count`, `failed_at`) for auditability and redrive inspection.

