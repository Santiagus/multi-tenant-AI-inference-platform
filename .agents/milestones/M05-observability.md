# M05 — Observability

Depends on: M04 | Read: `.agents/skills/observability/SKILL.md`

## Objective

Make the complete job path observable.

## Deliverables

- traces: API → authorization → queue → worker → inference → artifact;
- metrics: request rate, queue depth, queue wait, inference latency (P50/P95/P99), errors/retries, throughput, worker utilization, GPU metrics when available;
- Grafana dashboards for operational debugging.

## Acceptance criteria

A single job can be followed across components using correlation/request/job identifiers.

## Out of scope

Full production alerting, enterprise SIEM.

## Outcome

- Entry points: `GET /metrics` (Prometheus exposition), `GET /v1/jobs/:id/trace`, `GET /v1/traces/by-correlation/:correlationId` (`apps/api/src/routes/observability.ts`), and `make simulate-observability` (`scripts/simulate_observability_workload.py`).
- Distributed tracing & correlation: `DistributedTracer` and `AsyncLocalStorage` W3C `traceparent` + `x-correlation-id` propagation (`apps/api/src/infrastructure/telemetry/tracer.ts`) across `authorization` → `queue_enqueue` → `http_request` → `job_processing` → `inference_execution` → `artifact_storage`.
- Database & worker propagation: Added `003_observability_correlation.sql`, propagated `correlation_id` and `traceparent` through SQS attributes, `JobService`, `JobWorker`, Python `WorkerRuntime` (`apps/worker/consumer.py`), and S3 `result.json` artifacts.
- Metrics taxonomy: `MetricsRegistry` (`apps/api/src/infrastructure/telemetry/metrics.ts`) tracks HTTP request rate/latency, queue depth, queue wait, inference latency P50/P95/P99, TTFT, tokens, microcent cost, errors/retries/DLQ, worker utilization, and DCGM GPU VRAM/utilization gauges.
- Operational stack & dashboards: Added `otel-collector`, `prometheus`, and `grafana` to `docker-compose.yml` with provisioned dashboard `deploy/observability/grafana/provisioning/dashboards/json/inference-operations.json`.
- Verification: 35 Python tests and 50 TypeScript tests (100% coverage on tracer, metrics, domain, and worker), verified via `make ci`.
- Deviations & stubs: None; production alerting and SIEM remain out of scope per milestone spec.


