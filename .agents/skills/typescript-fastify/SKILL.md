---
name: typescript-fastify
description: Fastify control-plane API conventions — validation, layering, modular lifecycle hooks, Russian Doll decorators, errors, logging and contract tests.
---

# TypeScript/Fastify

We build enterprise-grade control-plane and application services that are **modular, auditable, scalable, and profiled**.

## Architectural & Cross-Cutting Standards

- **Transport Layer — Modular Fastify Lifecycle Hooks (Not `await next()`):**
  - Keep `app.ts` declarative. Extract cross-cutting HTTP concerns into dedicated modules under `src/plugins/` (e.g. `request-context.ts`, `error-handler.ts`).
  - Use Fastify's native phased hooks (`onRequest` → `preHandler` → `onSend` / `onResponse`) + a single centralized `setErrorHandler` boundary (producing RFC 7807 Problem Details with `correlation_id`) instead of Express/Koa-style nested `await next()` closures, avoiding per-request promise allocation and GC pressure under high concurrency.
  - Bracket every request with correlation ID propagation (`x-correlation-id`) and high-resolution wall-clock profiling (`process.hrtime.bigint()` → `x-response-time-ms`).
- **Domain Ports, Queue Consumers & Provider Adapters — Russian Doll (Decorator) Pattern:**
  - Use the **Russian Doll (Decorator) pattern** around domain ports, queue consumers, and provider adapters (e.g. `ProfilingInferenceExecutor` wrapping `IInferenceExecutor`).
  - Compose single-responsibility decorators (`Tracing` → `Profiling` → `Resilience/Retry` → `ConcreteAdapter`) so core business logic and state transitions remain pure while every execution is automatically profiled, audited, and observable across both HTTP and background worker paths.

## Core Conventions

- Schema validation (Zod) at route boundaries; no business logic inside route handlers.
- Explicit domain / application / infrastructure / plugin boundaries with dependency injection at boundaries.
- Structured logging and deterministic RFC 7807 error handling.
- Contract and integration tests for API routes and decorator pipelines.
- REST client scratchpad (`request.rest`) organized in sequential, self-contained Use Case Cycles with captured response variables.

