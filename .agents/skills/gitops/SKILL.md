---
name: gitops
description: Argo CD reconciliation, environment promotion and the split between CI and deployment.
---

# GitOps

- GitHub Actions builds, tests and publishes artifacts.
- Argo CD owns Kubernetes reconciliation, deployment state and rollback.
- CI does not routinely mutate production Kubernetes resources with kubectl.
