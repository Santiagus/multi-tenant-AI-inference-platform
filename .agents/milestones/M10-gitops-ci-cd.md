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

_Pending._
