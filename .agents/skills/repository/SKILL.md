---
name: repository
description: Monorepo structure, Git hygiene and local development workflow.
---

# Repository Engineering

- Preserve monorepo boundaries.
- Keep generated artifacts out of source control.
- Use deterministic tooling.
- Inspect diffs before commit; never commit secrets/PII.
- Prefer small changes; create atomic, self-contained commits covering related changes.

Verification includes the repository's local CI command.
