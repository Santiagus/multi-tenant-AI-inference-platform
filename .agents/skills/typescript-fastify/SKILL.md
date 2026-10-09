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
- tests for API contracts.

No business logic inside route handlers.
