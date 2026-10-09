# M06 — Kubernetes

Depends on: M05 | Read: `.agents/skills/kubernetes/SKILL.md`

## Objective

Move the workload to Kubernetes and demonstrate correct scheduling and scaling.

## Deliverables

- Helm charts;
- local Kubernetes deployment (API and worker);
- KEDA queue-driven scaling;
- Kueue workload admission where justified;
- Kyverno policies;
- Prometheus/Grafana integration;
- DCGM exporter when GPU nodes are available.

## Acceptance criteria

Queue depth drives worker scaling; GPU/batch workloads have explicit resource and admission behavior.

## Out of scope

Multi-cluster infrastructure, service mesh, unnecessary platform components.

## Outcome

_Pending._
