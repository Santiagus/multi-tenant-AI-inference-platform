# ADR-0011: Enforce Multi-Tenant Pod Security, Resource Bounds, and Kueue Admission via Kyverno ClusterPolicies

- **Status**: Accepted
- **Date**: 2026-10-12
- **Deciders**: Architecture Team

---

## Context & Problem Statement

In a multi-tenant Kubernetes AI inference cluster, unvalidated workload manifests pose three severe operational and security risks:
1. **Container Privilege Escalation**: Workloads running as root (`UID 0`) or retaining Linux kernel capabilities increase the blast radius of model deserialization or dependency vulnerabilities.
2. **Noisy-Neighbor Resource Starvation**: Pods deployed without explicit CPU and memory requests/limits or GPU batch `Job` workloads bypassing Kueue (`suspend: false` or missing `kueue.x-k8s.io/queue-name`) can bypass quota admission and trigger node-level out-of-memory (OOM) faults.
3. **Unattributed Compute Spend**: Workloads missing `platform.ai/tenant` or `app.kubernetes.io/part-of` labels break per-tenant cost accounting and observability filtering.

The platform requires a declarative Kubernetes admission policy engine that enforces these invariants both in-cluster (via ValidatingAdmissionWebhook) and offline in CI (`make validate-k8s`).

## Decision Drivers

- Kubernetes-native policy definitions (YAML rather than a separate domain-specific language) so platform engineers can audit rules alongside Helm templates.
- Enforceable in CI without requiring a live Kubernetes API server, as well as in-cluster via admission webhooks.
- Coverage for pod security, container resource bounds, Kueue batch GPU queue binding, and multi-tenant labels.

## Considered Options

1. **Kyverno (`ClusterPolicy` with `validationFailureAction: Enforce`)**
2. **OPA Gatekeeper (Rego `ConstraintTemplate` + `Constraint`)**
3. **Built-in Kubernetes Pod Security Admission (PSA) + `LimitRange` only**
4. **Custom Go/TypeScript ValidatingAdmissionWebhook**

## Decision Outcome

**Chosen option: Kyverno (`kyverno.io/v1` `ClusterPolicy`)**.

### Enforced Policy Suite ([`templates/kyverno-policies.yaml`](../../deploy/helm/inference-platform/templates/kyverno-policies.yaml))

1. **`require-non-root-and-drop-capabilities`**:
   - Requires `spec.securityContext.runAsNonRoot: true`, container `runAsNonRoot: true`, `allowPrivilegeEscalation: false`, and `capabilities.drop: ["ALL"]` across `inference-platform` and `inference-workers` namespaces.
2. **`require-workload-resource-bounds`**:
   - Requires every container to declare explicit `resources.requests` (`cpu`, `memory`) and `resources.limits` (`cpu`, `memory`).
   - Requires `batch/v1` `Job` workloads in `inference-workers` to set `spec.suspend: true` and carry a non-empty `kueue.x-k8s.io/queue-name` label so no batch GPU workload can bypass Kueue quota admission.
3. **`require-tenant-isolation-labels`**:
   - Requires `platform.ai/tenant` and `app.kubernetes.io/part-of: multi-tenant-ai-inference-platform` labels on all `Deployment` and `Job` resources.

## Consequences

- **Positive**:
  - Policies are written as standard Kubernetes YAML patterns in [`deploy/helm/inference-platform/templates/kyverno-policies.yaml`](../../deploy/helm/inference-platform/templates/kyverno-policies.yaml), eliminating Rego maintenance overhead.
  - Built-in PSA + `LimitRange` cannot enforce Kueue queue labels or `spec.suspend: true` on batch GPU `Job` objects; Kyverno enforces all three concerns uniformly.
  - Verified offline on every commit via [`scripts/validate_kubernetes.py`](../../scripts/validate_kubernetes.py) (`make validate-k8s`) and at runtime via [`evaluateKyvernoPolicies`](../../apps/api/src/domain/kubernetes-scheduler.ts) (`kyverno_policy_evaluations_total`).
- **Negative / Trade-offs**:
  - Requires running the Kyverno admission controller in target Kubernetes clusters alongside KEDA and Kueue.

