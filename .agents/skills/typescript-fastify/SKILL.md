---
name: typescript-fastify
description: Fastify control-plane API conventions — validation, layering, errors, logging and contract tests.
---

# TypeScript/Fastify

Prefer:
- schema validation;
- explicit domain/application/infrastructure boundaries;
- structured logging;
- typed request/response contracts;
- deterministic error handling;
- dependency injection at boundaries;
- tests for API contracts;
- REST client scratchpad (`request.rest`) organized in sequential, self-contained Use Case Cycles with captured response variables.

No business logic inside route handlers.
