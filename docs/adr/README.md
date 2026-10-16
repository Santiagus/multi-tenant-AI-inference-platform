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
| [ADR-0011](0011-kyverno-admission-policy-enforcement.md) | Enforce Multi-Tenant Pod Security, Resource Bounds, and Kueue Admission via Kyverno ClusterPolicies | Accepted | 2026-10-12 |
| [ADR-0012](0012-ephemeral-aws-terraform-and-cost-guardrails.md) | Ephemeral-First AWS Terraform Architecture, OIDC/IRSA Least-Privilege IAM, and Cost Guardrails | Accepted | 2026-10-12 |

---

## Empirical Benchmark Evidence Backing ADRs

In accordance with `AGENTS.md` (**Evidence over claims**), decisions are grounded in reproducible empirical metrics:
- **[ADR-0002](0002-python-pytorch-inference.md)**: Validated by live RTX 5070 Ti vs. Ryzen 9 7900 scaling ledgers in [`benchmarks/results/index.md`](../../benchmarks/results/index.md) ($11.5\times\text{--}19.1\times$ speedup) and engine comparisons across 40 runs in [`docs/benchmarks/engine-comparison.md`](../benchmarks/engine-comparison.md).
- **[ADR-0008](0008-keda-and-kueue-workload-responsibilities.md)**: Supported by Flyte media preprocessing benchmarks ($<0.035\text{ ms}$ Stage 1 CPU overhead) in [`docs/benchmarks/engine-comparison.md`](../benchmarks/engine-comparison.md).
- **[ADR-0010](0010-provider-adapter-architecture.md)**: Supported by prompt-tier routing matrix and marginal electricity cost curves ($\$0.003\text{--}\$0.005$ per 1M tokens) in [`benchmarks/results/index.md`](../../benchmarks/results/index.md).


