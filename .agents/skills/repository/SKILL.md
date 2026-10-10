---
name: repository
description: Monorepo structure, Git hygiene and local development workflow.
---

# Repository Engineering

- Preserve monorepo boundaries.
- Keep generated artifacts out of source control.
- Use deterministic tooling.
- Inspect diffs before commit; never commit secrets/PII.
- Maintain developer scratchpads (e.g. `request.rest`) organized in sequential, self-contained Use Case Cycles with captured response variables.
- Prefer small changes; create atomic, self-contained commits covering related changes.
- Propose commits as ready-to-run, copy-pasteable `git add` and `git commit` commands with single-line messages.

Verification includes the repository's local CI command.
