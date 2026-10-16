# ADR-0008: Delineate Responsibilities: KEDA for Queue Autoscaling vs Kueue for Batch Admission

- **Status**: Accepted
- **Date**: 2026-10-09
- **Deciders**: Architecture Team

---

## Context & Problem Statement

In Kubernetes-based AI workload environments, managing expensive GPU resources requires two distinct capabilities:
1. Scaling worker pods dynamically in response to incoming job backlog to minimize idle cloud spend while handling burst traffic.
2. Governing fair admission of heavy, batch-oriented GPU workloads to prevent cluster saturation, GPU out-of-memory (OOM) faults, and unfair tenant starvation.

Tools like KEDA (Kubernetes Event-driven Autoscaling) and Kueue (Kubernetes batch queuing and quota admission) both address workload scheduling, but operating them together without distinct boundaries risks conflicting lifecycle actions.

## Decision Drivers

- Avoid conflicts between pod scaling controllers and batch admission controllers.
- Support scale-to-zero when no inference jobs are queued.
- Prevent multi-tenant resource starvation on shared GPU clusters.
- Maintain clarity on pod lifecycle management.

## Considered Options

1. **Explicit separation: KEDA owns horizontal pod autoscaling based on queue depth; Kueue owns batch admission and tenant quota queueing**
2. **KEDA only (no Kueue)**
3. **Kueue only (no KEDA)**
4. **Custom in-house controller**

## Decision Outcome

**Chosen option: Explicit separation of responsibilities between KEDA and Kueue**.

### Division of Responsibilities

```mermaid
%%{init: {'theme': 'dark', 'themeVariables': { 'darkMode': true }}}%%
flowchart TD
    Queue["Amazon SQS Queue"] -->|"Queue Backlog Metric"| KEDA["KEDA Autoscaler"]
    KEDA -->|"Scales Deployment/Job Replicas (0 -> N)"| Pods["Worker Pod Replicas"]
    
    subgraph Cluster["Kubernetes Admission Control"]
        Pods -->|"Batch Job Admission Request"| Kueue["Kueue Admission Controller"]
        Kueue -->|"Checks Cohort Quota & Fair Sharing"| Admit{"Admit to GPU Node?"}
        Admit -->|"Yes"| GPU["NVIDIA GPU Node (Allocated)"]
        Admit -->|"No (Quota full)"| Pending["Queue in Kueue ClusterQueue"]
    end
```

1. **KEDA's Responsibility**:
   - Observes external SQS metrics (`ApproximateNumberOfMessagesVisible`).
   - Dynamically scales worker Deployment or Job replicas from 0 up to configured maximums based on queue backlog.
   - Triggers rapid scale-down to 0 when queues empty out, ensuring zero waste on idle GPU instances.

2. **Kueue's Responsibility**:
   - Manages cluster-level admission and tenant GPU resource quotas.
   - Intercepts batch jobs before they schedule onto GPU nodes to prevent thrashing or OOM errors.
   - Enforces fair sharing and priority borrowing between tenants sharing a single GPU pool.

## Consequences

- **Positive**:
  - Clean separation of concerns: KEDA bridges external cloud queues to Kubernetes pod counts; Kueue governs physical GPU allocation and fairness inside Kubernetes.
  - Workers scale to zero cleanly during lulls while large burst batches queue predictably without crashing nodes.
- **Negative / Trade-offs**:
  - Two Kubernetes operators to maintain and monitor in cloud clusters (implemented and verified in Milestone M06).

## Implementation & Verification (M06–M07)

- **Two-Path Orchestration (SQS + KEDA vs. Flyte + Kueue + Kyverno)**:
  - **Path A (Low-Latency Single-Hop Inference)**: `SQS` + `KEDA` (`keda-scaledobject.yaml`) scales warm Python worker pods (`0 -> N -> 0`) for sub-second queue pickup.
  - **Path B (Multi-Stage Media & Batch DAGs)**: [`apps/worker/flyte_workflow.py`](../../apps/worker/flyte_workflow.py) defines typed `@task` and `@workflow` stages (`CPU preprocess` $\rightarrow$ `GPU PyTorch/TorchScript inference` $\rightarrow$ `CPU S3/CloudFront/Kinesis packaging`), where only Stage 2 requests `nvidia.com/gpu: 1` and is admitted via **Kueue** (`kueue.x-k8s.io/queue-name`) and validated by **Kyverno** (`ClusterPolicy`).
  - **Empirical Decoupling Evidence ([`docs/benchmarks/engine-comparison.md`](../benchmarks/engine-comparison.md))**: Scenario D benchmarks demonstrate that binary asset inspection (JPEG/MP4 headers, dimensions, and SHA-256 digests) completes in $<0.035\text{ ms}$ on CPU, verifying that Stage 1 CPU preprocessing decouples cleanly from Stage 2 GPU tensor execution in the Flyte pipeline.
- **Helm Templates**:
  - KEDA `TriggerAuthentication` & `ScaledObject`: [`deploy/helm/inference-platform/templates/keda-scaledobject.yaml`](../../deploy/helm/inference-platform/templates/keda-scaledobject.yaml) (dual SQS `ApproximateNumberOfMessagesVisible` + Prometheus `queue_messages_visible` triggers, `minReplicaCount: 0`).
  - Kueue `WorkloadPriorityClass`, `ResourceFlavor`, `ClusterQueue`, `LocalQueue`, and suspended batch GPU `Job`: [`deploy/helm/inference-platform/templates/kueue-admission.yaml`](../../deploy/helm/inference-platform/templates/kueue-admission.yaml).
- **Control-Plane Evaluator & Telemetry**:
  - [`apps/api/src/domain/kubernetes-scheduler.ts`](../../apps/api/src/domain/kubernetes-scheduler.ts) and [`apps/api/src/routes/kubernetes.ts`](../../apps/api/src/routes/kubernetes.ts) expose `GET /v1/k8s/autoscaling/status`, `POST /v1/k8s/kueue/workloads`, and `POST /v1/k8s/kueue/workloads/:id/release`, tracked in Grafana via [`kubernetes-scheduling.json`](../../deploy/observability/grafana/provisioning/dashboards/json/kubernetes-scheduling.json).



