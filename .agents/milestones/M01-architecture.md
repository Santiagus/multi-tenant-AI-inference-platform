# M01 — Architecture

Depends on: M00 | Read: `.agents/skills/repository/SKILL.md`

## Objective

Turn the concept into explicit architecture and stable contracts before substantial implementation.

## Input — target architecture

```text
React dashboard → CloudFront → ALB → Fastify control plane
  (authentication · tenancy · routing · billing)
  → SQS → scheduler/workers → local GPU | RunPod | SageMaker | Bedrock → S3
```

Supporting: PostgreSQL, Redis (where justified), ClickHouse (deferred), OpenTelemetry, Prometheus, Grafana, Kubernetes, Helm, KEDA, Kueue, DCGM exporter, Argo CD, Kyverno, Terraform, GitHub Actions.
This is a target, not a V1 mandate.

## Deliverables

In `docs/architecture/` (entry point `overview.md`) and `docs/adr/`:

- system context and container/component diagrams;
- deployment topology;
- data ownership model;
- API/job lifecycle contract;
- provider abstraction;
- tenancy/security boundaries;
- observability model;
- local-vs-cloud boundary;
- ADRs for major technology choices.

## Required decisions (ADRs)

Why: Fastify is the control plane · Python/PyTorch owns inference · PostgreSQL owns operational state · S3 owns artifacts · SQS represents async work · Redis only where justified · ClickHouse deferred until analytical scale · KEDA vs Kueue responsibilities · Argo CD owns reconciliation · Bedrock/SageMaker/RunPod/local are provider adapters.

## Acceptance criteria

A new engineer understands the architecture and major boundaries without reading implementation code.

## Out of scope

Production services. This milestone produces architecture and contracts only.

## Outcome

_Pending._
