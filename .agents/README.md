# .agents — Agent workspace

Human-facing index for the agent setup. Agents read this file only to update the milestone status.

## Layout

```text
AGENTS.md                      always-loaded rules (repo root)
.agents/milestones/MXX-*.md    one bounded unit of work each
.agents/skills/<name>/SKILL.md topic conventions, loaded on demand
docs/adr/                      durable decisions (from M01)
```

## Starting a milestone

Open a fresh agent session and prompt:

> Execute `.agents/milestones/M03-async-inference.md` only.

`AGENTS.md` defines what else gets loaded (the milestone's `Read` line and the `Outcome` of its dependencies).
The same prompt resumes an interrupted milestone: an `in-progress` status makes the agent continue from its `## Progress` checklist.
Commit (`<type>(mXX): …`, see `.gitmessage`) before starting the next milestone — agents refuse to start on a tree dirty from another milestone.

## Milestones

| ID | Milestone | Primary outcome | Status |
|---|---|---|---|
| M00 | GitHub Foundation | Monorepo layout, local CI and security gate | done |
| M01 | Architecture | Target architecture, boundaries, ADRs, contracts | done |
| M02 | Local Platform Skeleton | Compose, API, DB, storage, queue abstractions | todo |
| M03 | Async Inference | Job lifecycle, retries, idempotency, DLQ | todo |
| M04 | GPU Inference | PyTorch worker, benchmark, GPU telemetry | todo |
| M05 | Observability | OTel traces, metrics, dashboards, correlation | todo |
| M06 | Kubernetes | Helm, KEDA, Kueue, GPU scheduling, policies | todo |
| M07 | AWS Platform | Terraform, S3/SQS/EKS, ephemeral cloud deployment | todo |
| M08 | Provider Routing | Local/RunPod/Bedrock/SageMaker adapters and routing | todo |
| M09 | Security | Multi-tenancy, ABAC, isolation, supply chain | todo |
| M10 | GitOps / CI-CD | Argo CD, environments, OIDC, promotion | todo |
| M11 | Product Dashboard | Jobs, routing, usage and economics UI | todo |
| M12 | Production Readiness | Load/failure/security/benchmark evidence, demo path | todo |

Status values: `todo` · `in-progress` · `done`.

Milestones are sequential. If a later milestone needs a small interface from an earlier one, implement only that interface.

Priority when trading off depth: distributed workload execution → GPU inference performance → provider/capacity routing → Kubernetes/cloud → tenant isolation → observability → economics → CI/CD.

RAG/pgvector is outside the core roadmap.

## Authoring rules

**Milestone files** use this template and stay under ~60 lines:

```markdown
# MXX — Title
Depends on: MYY | Read: `.agents/skills/<name>/SKILL.md`, …
## Objective
## Deliverables
## Acceptance criteria
## Out of scope
## Progress        ← only while in-progress: ≤10-item checklist, deleted at finish
## Outcome
_Pending._        ← replaced at finish with ≤10 lines
```

**Skills** live in `.agents/skills/<name>/SKILL.md` with YAML frontmatter (`name`, `description`). The description states when the skill applies. The body covers standards, preferred tools, anti-patterns, verification commands and expected evidence. Keep skills narrowly scoped — never a project history. Add verification commands once the tooling exists; add new skills (e.g. ClickHouse, model evaluation, FinOps) only when a milestone requires them.
