# M10 — GitOps / CI-CD

Depends on: M00, M06, M07 | Read: `.agents/skills/ci-security/SKILL.md`, `.agents/skills/gitops/SKILL.md`

## Objective

Create a credible software supply chain and deployment promotion model.

## Deliverables

- CI stages: fast validation, integration, image build, security, Terraform validation, benchmark workflow;
- GitHub Actions builds and publishes; GitHub OIDC authenticates to AWS;
- versioned deployment configuration reconciled by Argo CD;
- explicit approval for production.

## Acceptance criteria

GitHub Actions never bypasses GitOps by directly applying production Kubernetes state.

## Out of scope

Multi-region/multi-account promotion beyond what the demo environment needs.

## Outcome

- Entry points: `make validate-gitops` (`scripts/validate_gitops.py`), `GET /v1/gitops/status`, `GET /v1/gitops/environments`, `POST /v1/gitops/promote`, `POST /v1/gitops/sync/:environment` (`apps/api/src/routes/gitops.ts`).
- CI/CD stages & OIDC: `.github/workflows/ci.yml` (validate, test, security/SBOM, terraform, image build), `.github/workflows/benchmark.yml` (manual on-demand only), `.github/workflows/deploy.yml` with AWS OIDC federation (`token.actions.githubusercontent.com`).
- Argo CD GitOps reconciler: `deploy/argocd/` (`argocd-project.yaml`, `application-staging.yaml`, `application-production.yaml`, `root-app-of-apps.yaml`) and overlays `deploy/environments/{staging,production}/values.yaml` per [ADR-0009](../../docs/adr/0009-argo-cd-gitops-reconciliation.md).
- Promotion governance & non-bypass invariant: Staging automated sync (`prune: true`, `selfHeal: true`), production manual gate requiring explicit approver and token, zero imperative `kubectl apply` in CI (enforced via static scanner and API 403 `GITOPS_BYPASS_PROHIBITED`).
- Cost guardrails & mock inference: CI/CD runs with mock inference (`INFERENCE_MOCK_MODE=true`), zero weight downloads, and manual-only benchmarks to avoid additional cloud compute costs.
- Architecture & verification: `docs/architecture/gitops-ci-cd.md`, 8 Python unit tests and 19 TypeScript unit/integration tests with 100% coverage, verified via `make ci`.
- Deviations & stubs: None; multi-region and multi-account promotion out of scope per milestone spec.
