---
name: observability
description: OpenTelemetry tracing, Prometheus metrics, Grafana dashboards, execution profiling and correlation IDs across the job path.
---

# Observability

All platform components are built to be **modular, auditable, scalable, and profiled**:

- **OpenTelemetry & Async Context (`AsyncLocalStorage`):** Use OpenTelemetry for distributed traces and standardized application telemetry across HTTP and async queue boundaries without polluting domain signatures.
- **End-to-End Correlation & Auditability:** Every request and async job propagates correlation identifiers (`x-correlation-id` → `job_id` → queue message → worker → provider adapter → S3 artifact) and attaches `correlation_id` to RFC 7807 Problem Details.
- **Layered Profiling:** Profile transport latency via Fastify lifecycle hooks (`x-response-time-ms`) and profile worker/provider execution via Russian Doll (Decorator) wrappers around domain ports (`profiled_wall_ms`, `tokens_per_sec`).
- **Operational Metrics & Visualization:** Expose Prometheus metrics for queue depth, retry rates, DLQ volume, and token throughput; visualize in Grafana.

