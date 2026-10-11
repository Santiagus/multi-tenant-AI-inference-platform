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
- Terraform validation.

CI fails closed on detected credentials, prohibited sensitive artifacts, complexity violations, or test coverage deficits below 100%.
