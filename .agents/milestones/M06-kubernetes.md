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

- Entry points: `make validate-k8s` (`scripts/validate_kubernetes.py`), `GET /v1/k8s/autoscaling/status`, `POST /v1/k8s/kueue/workloads`, and `POST /v1/k8s/kueue/workloads/:id/release` (`apps/api/src/routes/kubernetes.ts`).
- Helm packaging & local Kubernetes topology: `deploy/helm/inference-platform/` (`Chart.yaml`, `values.yaml`, `values-local.yaml`, `values-gpu.yaml`), `deploy/kubernetes/kind-cluster.yaml`, and non-root `apps/worker/Dockerfile`.
- Queue-driven scaling & HPA: KEDA `ScaledObject` & `TriggerAuthentication` (`templates/keda-scaledobject.yaml`) scale workers `0 -> N -> 0` on SQS/Prometheus queue depth alongside API HPA (`templates/api-hpa.yaml`) per [ADR-0008](../../docs/adr/0008-keda-and-kueue-workload-responsibilities.md).
- Batch GPU admission (Kueue): `ResourceFlavor`, `ClusterQueue`, `LocalQueue`, `WorkloadPriorityClass`, and suspended batch GPU `Job` templates (`templates/kueue-admission.yaml`) plus `KueueAdmissionController` (`apps/api/src/domain/kubernetes-scheduler.ts`).
- Policy, Grafana & GPU telemetry: Kyverno `ClusterPolicy` (`templates/kyverno-policies.yaml`, [ADR-0011](../../docs/adr/0011-kyverno-admission-policy-enforcement.md)), Prometheus `ServiceMonitor` (`templates/observability.yaml`), Grafana dashboard `deploy/observability/grafana/provisioning/dashboards/json/kubernetes-scheduling.json`, and conditional `dcgm-exporter` `DaemonSet` (`templates/dcgm-exporter.yaml`).
- Verification: 42 Python tests and 55 TypeScript tests (100% line/branch/function coverage on `kubernetes-scheduler.ts` and `kubernetes.ts`), verified via `make ci`.
- Deviations & stubs: None; multi-cluster infrastructure and service mesh remain out of scope per milestone spec.
