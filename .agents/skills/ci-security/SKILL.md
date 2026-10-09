---
name: ci-security
description: Local CI command, GitHub Actions, linting/type/test gates, secret/PII detection, dependency and container scanning.
---

# CI and Security Gates

Required categories where applicable:
- formatter, linter, type checker;
- unit/integration tests;
- secret scanning and PII detection;
- dependency and container scanning;
- Terraform validation.

CI fails closed on detected credentials or prohibited sensitive artifacts.
