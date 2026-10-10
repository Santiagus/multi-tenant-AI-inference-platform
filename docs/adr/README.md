# Architecture Decision Records (ADRs)

This directory documents the foundational architectural decisions for the **Multi-Tenant AI Inference Platform**. Decisions follow the standard Architecture Decision Record (ADR) format, recording the context, options evaluated, rationale, and consequences.

---

## Index of Decisions

| ADR | Title | Status | Date |
|---|---|---|---|
| [ADR-0001](0001-fastify-control-plane.md) | Use Fastify (TypeScript) for the Control Plane API | Accepted | 2026-10-09 |
| [ADR-0002](0002-python-pytorch-inference.md) | Use Python and PyTorch for Inference Workers | Accepted | 2026-10-09 |
| [ADR-0003](0003-postgresql-operational-state.md) | Use PostgreSQL for Primary Operational State | Accepted | 2026-10-09 |
| [ADR-0004](0004-s3-artifact-storage.md) | Use S3-Compatible Object Storage for Large Payloads and Artifacts | Accepted | 2026-10-09 |
| [ADR-0005](0005-sqs-async-queue-abstraction.md) | Use SQS-Compatible Message Broker for Asynchronous Workload Queue | Accepted | 2026-10-09 |
| [ADR-0006](0006-redis-scoped-coordination.md) | Restrict Redis Exclusively to Ephemeral Coordination and Rate Limiting | Accepted | 2026-10-09 |
| [ADR-0007](0007-defer-clickhouse-analytics.md) | Defer ClickHouse until Proven Analytical Query Scale | Accepted | 2026-10-09 |
| [ADR-0008](0008-keda-and-kueue-workload-responsibilities.md) | Delineate Responsibilities: KEDA for Queue Autoscaling vs Kueue for Batch Admission | Accepted | 2026-10-09 |
| [ADR-0009](0009-argo-cd-gitops-reconciliation.md) | Use Argo CD for Declarative Kubernetes GitOps Reconciliation | Accepted | 2026-10-09 |
| [ADR-0010](0010-provider-adapter-architecture.md) | Encapsulate Cloud and Local Execution Behind Provider Adapters | Accepted | 2026-10-09 |

