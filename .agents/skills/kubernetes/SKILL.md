---
name: kubernetes
description: Kubernetes deployment, Helm charts, autoscaling (KEDA/HPA), batch/GPU admission (Kueue), policy (Kyverno) and GPU telemetry.
---

# Kubernetes

One tool per responsibility — do not overlap without a reason:

| Tool | Responsibility |
|---|---|
| Helm | packaging |
| Argo CD | GitOps reconciliation, deployment state, rollback |
| KEDA | event-driven scaling, especially queue depth |
| HPA | conventional API/control-plane resource scaling |
| Kueue | admission, queueing, priority and quotas for batch/GPU workloads |
| Kyverno | admission/security policy enforcement |
| DCGM exporter | NVIDIA GPU telemetry |
| Prometheus / Grafana | metrics collection / operational visualization |

Do not introduce a service mesh or orchestration frameworks (Ray, Kubeflow, Flyte, …) without a demonstrated requirement.
