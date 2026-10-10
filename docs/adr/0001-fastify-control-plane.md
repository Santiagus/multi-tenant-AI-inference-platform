# ADR-0001: Use Fastify (TypeScript) for the Control Plane API

- **Status**: Accepted
- **Date**: 2026-10-09
- **Deciders**: Architecture Team

---

## Context & Problem Statement

The platform requires a high-throughput, low-latency control plane to ingest inference requests, authenticate tenant credentials, validate JSON payloads, manage job lifecycles in PostgreSQL, and publish tasks to message queues. The control plane must provide schema-driven validation, structured logging, high I/O concurrency, and type safety.

## Decision Drivers

- Extreme I/O throughput with minimal per-request overhead for async dispatch.
- Strict schema validation at the HTTP boundary to reject malformed requests immediately.
- Type safety and shared contracts with frontend dashboard packages.
- Mature ecosystem for OpenTelemetry, database pooling, and cloud SDKs.
- Low memory footprint compared to monolithic frameworks.

## Considered Options

1. **Fastify (Node.js / TypeScript)**
2. **Express.js (Node.js / TypeScript)**
3. **Go (Gin / Echo / net/http)**
4. **Python (FastAPI / Starlette)**

## Decision Outcome

**Chosen option: Fastify (Node.js / TypeScript)**.

### Rationale

- **High-Performance Routing & Serialization**: Fastify provides superior throughput and JSON serialization speed compared to Express, utilizing compiled JSON schemas via `fast-json-stringify`.
- **First-Class Schema Validation**: Built-in support for TypeBox / JSON Schema enables automatic compile-time and runtime validation without secondary validation layers.
- **Contract Sharing**: TypeScript enables direct type sharing between the API and the React product dashboard via shared workspace packages (`packages/contracts`).
- **Clean Separation from Inference**: Keeping the control plane in TypeScript prevents compute-heavy Python GIL contention from degrading HTTP ingress latency.

## Consequences

- **Positive**:
  - Predictable sub-millisecond route dispatch overhead.
  - Consistent type safety across the control plane and web dashboard.
  - Extensive plugin architecture (Fastify hooks, rate limiting, helmet, OpenTelemetry).
- **Negative / Trade-offs**:
  - Polyglot repository (TypeScript control plane + Python inference workers). Requires separate linting and dependency toolchains (`pnpm` and `uv`).

