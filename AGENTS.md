# AGENTS.md

Operating rules for AI coding agents in this repository.
This file is loaded into every agent session — keep it short. Put topic detail in skills, milestone detail in milestone files, and durable decisions in ADRs.

## Project

Multi-tenant AI inference platform. Reference implementation of the full workload lifecycle:

API → authN/authZ → async job → routing → inference → artifact storage → observability → cost accounting → Kubernetes/AWS deployment.

Optimize for architectural coherence, measurable behavior and reproducibility — not for the number of technologies.

## Context loading (mandatory)

Each task runs in a fresh session scoped to one milestone. Load, in order:

1. this file;
2. the milestone file assigned by the user (`.agents/milestones/MXX-*.md`);
3. only the files listed in that milestone's `Read` line, plus the `## Outcome` section of each milestone listed in `Depends on`.

Do not read other milestone files, all skills, or the whole `docs/` tree.
For tasks outside a milestone, discover skills with `grep -H '^description:' .agents/skills/*/SKILL.md` and load only the matching ones.
Consult a specific ADR in `docs/adr/` only when the task depends on that decision.

## Scope discipline

- Execute only the assigned milestone. Do not build later milestones "because they will be needed".
- If a later dependency is unavoidable, add the smallest interface/stub and record it in the milestone `Outcome`.
- Decide routine implementation details autonomously. Stop and ask when a decision materially changes scope, architecture, cost, security, data handling or repository visibility.
- Prefer small, reviewable changes. Preserve existing behavior unless the milestone changes it.

## Engineering rules

- **Evidence over claims.** Every documented capability is backed by code, tests, benchmarks, ADRs, manifests or reproducible experiments. Never fabricate metrics. Label every number as measured, estimated, simulated, mocked or provider-reported.
- **Decide before building.** Non-trivial change: problem → constraints → alternatives → simplest justified design → ADR if durable → implement → test.
- **Provider-agnostic core.** Business logic depends on provider interfaces (local, RunPod, Bedrock, SageMaker, …), never on a concrete provider. Local and cloud share business contracts; local infrastructure is not presented as an AWS emulator.
- **Local-first, cloud-verifiable.** The default dev path runs without a GPU (mocks, CPU/small models). GPU work must have a path on a local RTX 5070 Ti or temporary cloud compute. Nothing depends on always-on paid infrastructure.
- **No technology without a requirement.** Do not add Ray, Kubeflow, Flyte, Istio, Spark, Databricks or similar unless a milestone demonstrates the need.

## Security and repository boundary

Never commit credentials, tokens, keys, `.env` files, customer data, PII, account-specific infrastructure, real production configuration or private endpoints. Use placeholders and documented secret injection.

This is a public repository: architecture, interfaces, representative implementations, local deployment, tests, benchmark harnesses and sanitized examples. Tenant-specific configuration, operational secrets and proprietary extensions stay out of it.

## Stack

| Concern | Choice |
|---|---|
| Control plane | TypeScript + Fastify (`pnpm`) |
| Inference | Python + PyTorch (`uv`) |
| Dashboard | React + TypeScript |
| State · artifacts · queue | PostgreSQL · S3-compatible storage · SQS-compatible queue abstraction |
| Cache / coordination | Redis, only where justified |
| Telemetry | OpenTelemetry · Prometheus · Grafana |
| Runtime | Docker Compose (local) → Kubernetes + Helm |
| Cloud · delivery | AWS via Terraform · GitHub Actions · Argo CD |

Deferred until justified: ClickHouse (analytics), pgvector/RAG (outside core scope).
Target architecture: `docs/architecture/` once M01 is done.

## Validation and commits

Before declaring work done or proposing a commit: format → lint → typecheck → relevant tests → secret/PII scan → inspect the diff for junk and credentials. Use the repository's local CI command once it exists.

Tests verify behavior: unit for domain logic, integration at component boundaries, contract tests for providers, security tests for tenant isolation, load/failure/benchmark tests for capacity and performance claims.

Commit only when the user or the milestone explicitly authorizes it. Never push unless asked.
Commits must be atomic, self-contained, and focused on related changes. Prefer a short series of reduced file updates over monolithic commits. Use Conventional Commits format with the milestone as scope and concise single-line messages, e.g. `feat(m03): async job lifecycle`. Follow `.gitmessage`.
Always propose commits as explicit `git add` and `git commit` commands that the user can copy and paste directly into the terminal.

## Milestone protocol

**Start**
1. Check `git status`. If the tree has uncommitted changes from another milestone, stop and ask the user to commit or discard them.
2. If the milestone status is `in-progress`, this is a resume: read its `## Progress` section and the diff, then continue from there.
3. Otherwise set status to `in-progress` in `.agents/README.md` and add a `## Progress` checklist (≤10 items) above `## Outcome`.
4. State the milestone, files/areas expected to change, acceptance criteria and any genuine blocker. Then implement.

**During** — tick `## Progress` items as they complete, so an interrupted session can be resumed. Keep it a checklist, not a log.

**Done** — acceptance criteria met, checks green, docs/evidence updated, no later milestone implemented, diff understandable.

**Finish**
1. Report: implemented · checks run · evidence produced · known limitations · deferred items.
2. Delete `## Progress`. Replace `## Outcome` with ≤10 lines: entry points/commands, deviations from the spec, stubs left for later milestones, links to new ADRs. Do not restate ADR content.
3. Set status to `done` in `.agents/README.md`.
4. Run the local CI command (it includes the handoff check), then propose the atomic commit series as copy-pasteable `git add` and `git commit` commands with single-line messages.

**Blocked** — record the blocker as an unticked `## Progress` item, then report what is blocked, why, what was attempted and the smallest input needed.
