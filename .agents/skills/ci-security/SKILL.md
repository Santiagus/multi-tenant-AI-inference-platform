---
name: ci-security
description: Local CI command, GitHub Actions, linting/type/test gates, secret/PII detection, dependency and container scanning.
---

# CI and Security Gates

Required categories where applicable:
- formatter, linter, type checker;
- static code complexity analysis (cyclomatic and cognitive complexity);
- unit/integration tests with 100% coverage enforcement;
- secret scanning and PII detection;
- dependency and container scanning;
- Terraform validation;
- milestone handoff & test-matrix synchronization (`docs/testing/test-matrix.md` and `request.rest` updated for every completed milestone).

CI fails closed on detected credentials, prohibited sensitive artifacts, complexity violations, test coverage deficits below 100%, or milestone handoff / `docs/testing/test-matrix.md` desynchronization.

## Test Generation & Typing Standards

- **Python Tests**: Always import `mock` explicitly via `from unittest import mock`. Bare `import unittest` with `unittest.mock.*` triggers mypy failures in clean CI runner environments (`Module has no attribute "mock"`).
- **TypeScript Tests**: Use `node:test` and `node:assert/strict` directly for testing and mocking (`mock.fn()`, `mock.method()`). Do not import undeclared external mock packages or untyped globals.

