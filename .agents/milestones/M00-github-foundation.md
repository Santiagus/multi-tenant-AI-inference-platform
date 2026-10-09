# M00 — GitHub Foundation

Depends on: — | Read: `.agents/skills/repository/SKILL.md`, `.agents/skills/ci-security/SKILL.md`

## Objective

Create a clean, secure public repository with a local validation gate.

## Deliverables

- monorepo skeleton;
- README placeholder;
- `.gitignore` (extend the existing one, preserving `.vscode/extensions.json` while ignoring editor telemetry and runtime state), `.editorconfig`;
- local CI command (Makefile or task runner) with format/lint/type/test structure;
- secret and PII scanning;
- handoff check in the local CI command: fails if a milestone marked `done` in `.agents/README.md` still has `_Pending._`, a `## Progress` section, or an `## Outcome` over 10 lines; fails if an `in-progress` milestone has no `## Progress`;
- GitHub Actions CI;
- dependency update configuration where justified;
- CODEOWNERS if useful;
- contribution and security guidance (`CONTRIBUTING.md` including a "Development Environment / Editor Setup" subsection referencing `.vscode/extensions.json`, `SECURITY.md`).

## Repository direction

Monorepo: API, inference, frontend, infrastructure, tests and benchmarks are tightly coupled. A polyrepo split remains possible later.

```text
apps/  packages/  infrastructure/  deploy/  tests/  benchmarks/  docs/  .github/  .agents/
```

## Acceptance criteria

- A fresh checkout can run the documented local validation command.
- CI runs on pull requests; secret/PII checks run before merge.
- No credentials or personal/private data present.
- Structure supports later milestones without premature implementation.
- No AWS infrastructure is created.

## Out of scope

Application features, Kubernetes, AWS, GPU inference, RAG, billing, production frontend.

## Outcome

_Pending._
