# ADR-0006: Restrict Redis Exclusively to Ephemeral Coordination and Rate Limiting

- **Status**: Accepted
- **Date**: 2026-10-09
- **Deciders**: Architecture Team

---

## Context & Problem Statement

Distributed systems often adopt in-memory datastores like Redis for caching, state coordination, and session management. However, over-reliance on Redis for mission-critical durable state often leads to data loss upon node failover, split-brain race conditions, and architectural ambiguity regarding the source of truth. The platform must establish a strict boundary defining when Redis is justified and when it is forbidden.

## Decision Drivers

- Absolute clarity on the authoritative persistence layer (PostgreSQL).
- Low-latency operations for rate limiting, concurrency quotas, and ephemeral lease coordination.
- Resilience against Redis restarts: the platform must remain fully functional or recover deterministically if Redis loses state.

## Considered Options

1. **Redis strictly scoped to ephemeral coordination, token buckets, and short-lived caching**
2. **Redis as primary job state store and message broker (e.g. BullMQ / Celery)**
3. **No Redis at all (handle rate limiting and caching purely in PostgreSQL and Node.js memory)**

## Decision Outcome

**Chosen option: Redis strictly scoped to ephemeral coordination, token buckets, and short-lived caching**.

### Allowed Use Cases for Redis

1. **Token Bucket Rate Limiting**: Tracking request rates per tenant/API key per sliding window (`INCR` with `EXPIRE`).
2. **Fast-path Idempotency Deduplication**: Checking recently submitted idempotency keys before querying PostgreSQL (backed durably by PostgreSQL unique constraints).
3. **Worker Heartbeat Leases**: Ephemeral worker liveness keys (`worker:{id}:heartbeat` with short TTL).
4. **Model Metadata Caching**: Caching model catalog schemas and availability flags.

### Explicitly Forbidden Use Cases

- **Job Lifecycle Persistence**: Job states must never reside solely in Redis.
- **Tenant Billing & Financial Ledgers**: Financial data must be committed directly to PostgreSQL.
- **Primary Message Queuing**: Job queues must use the SQS abstraction, not Redis lists or streams.

## Consequences

- **Positive**:
  - Redis can be restarted, flushed, or replaced without risking data loss or state corruption.
  - Zero ambiguity: PostgreSQL is always the authoritative source of truth.
  - High performance on the hot HTTP request path for rate limiting.
- **Negative / Trade-offs**:
  - Requires maintaining Redis in local Compose and AWS ElastiCache for deployment.

