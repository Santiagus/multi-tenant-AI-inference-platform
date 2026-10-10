# ADR-0007: Defer ClickHouse until Proven Analytical Query Scale

- **Status**: Accepted
- **Date**: 2026-10-09
- **Deciders**: Architecture Team

---

## Context & Problem Statement

Multi-tenant inference platforms generate high volumes of telemetry events: per-token latencies, GPU performance metrics, model routing logs, and per-tenant cost attribution records. Columnar databases like ClickHouse are popular for massive analytical queries and real-time aggregation across billions of rows. We must decide whether to include ClickHouse in the initial platform architecture or defer it.

## Decision Drivers

- Engineering rule from `AGENTS.md`: "No technology without a requirement. Optimize for architectural coherence, measurable behavior and reproducibility — not for the number of technologies."
- Keep operational footprint lightweight and accessible for local development on single-node developer workstations.
- Sufficient query capability in existing stack (PostgreSQL + Prometheus) for expected initial volumes.

## Considered Options

1. **Defer ClickHouse: Use PostgreSQL for operational aggregations and Prometheus/Grafana for time-series metrics**
2. **Introduce ClickHouse immediately in Milestone 01 / 02**
3. **Use Elasticsearch / OpenSearch**

## Decision Outcome

**Chosen option: Defer ClickHouse until analytical scale is demonstrated by concrete performance benchmarks or volume requirements**.

### Rationale

- **Premature Complexity**: Adding ClickHouse introduces an additional stateful database, separate ingestion pipelines (e.g. Kafka or vector connectors), schema migration overhead, and substantial memory consumption (~4GB+ RAM), harming local development ergonomics.
- **Adequate Existing Telemetry**:
  - Prometheus handles real-time operational time-series metrics (latencies, GPU utilization, error counts).
  - PostgreSQL with proper indexing (B-tree on `(tenant_id, created_at)` and partial indexes) comfortably handles millions of job records with sub-10ms aggregation times for dashboard economics and billing queries.
- **Clear Upgrade Trigger**: ClickHouse adoption will be evaluated when job volume exceeds 10,000,000 monthly executions and PostgreSQL billing aggregation queries exceed 500ms p95 latency.

## Consequences

- **Positive**:
  - Simpler architecture and fewer points of operational failure.
  - Faster test runs and lower resource utilization in local Docker Compose.
  - Adheres strictly to the repository's scope discipline.
- **Negative / Trade-offs**:
  - Ad-hoc multi-dimensional analytics across historical execution logs beyond 90 days will be constrained to indexed queries in PostgreSQL.

