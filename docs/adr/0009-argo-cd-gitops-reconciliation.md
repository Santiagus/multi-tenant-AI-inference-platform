# ADR-0009: Use Argo CD for Declarative Kubernetes GitOps Reconciliation

- **Status**: Accepted
- **Date**: 2026-10-09
- **Deciders**: Architecture Team

---

## Context & Problem Statement

Deploying Kubernetes resources directly from developer laptops or imperative CI pipelines (e.g. `kubectl apply` in GitHub Actions) risks configuration drift, insecure cluster credential proliferation, and lack of clear auditing. The platform requires a continuous delivery model that ensures the Kubernetes cluster matches the declared state in Git.

## Decision Drivers

- Declarative, Git-centric infrastructure and application lifecycle (GitOps).
- Zero long-lived cluster administrative credentials exposed to GitHub Actions CI runners.
- Continuous automated drift detection and self-healing.
- Clear multi-environment promotion path (staging to production).

## Considered Options

1. **Argo CD**
2. **Flux CD**
3. **Imperative Helm / kubectl deployments from GitHub Actions**

## Decision Outcome

**Chosen option: Argo CD for GitOps reconciliation**.

### Rationale

- **Declarative Reconciliation**: Argo CD runs inside the EKS cluster, continuously comparing desired manifests in Git (`deploy/helm/`) against live cluster state and automatically reconciling drift.
- **Security Boundary**: GitHub Actions CI builds and scans container images and updates manifest tags in Git, but never possesses direct network access or admin credentials to the Kubernetes API server.
- **Multi-Environment Promotion**: Allows clean separation of environment overlays (`deploy/environments/staging`, `deploy/environments/production`) with automated sync policies.
- **Rich Visual Diagnostics**: Provides real-time health inspection, pod event streams, and sync history in a unified web console.

## Consequences

- **Positive**:
  - The repository's Git history is the single source of truth for all deployed workloads.
  - Reduced security attack surface on CI runners.
  - Transparent rollback mechanics via standard Git reverts.
- **Negative / Trade-offs**:
  - Requires deploying and maintaining the Argo CD controller within the target Kubernetes cluster (scheduled for Milestone M10).

