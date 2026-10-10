# ADR-0003: Use PostgreSQL for Primary Operational State

- **Status**: Accepted
- **Date**: 2026-10-09
- **Deciders**: Architecture Team

---

## Context & Problem Statement

The platform requires an authoritative operational datastore to persist tenant definitions, API keys, job metadata, asynchronous execution states, quota limits, and billing ledger events. The datastore must provide strict consistency, ACID guarantees, flexible querying, and row-level tenant isolation.

## Decision Drivers

- Transactional integrity (ACID) for state transitions (`PENDING` -> `QUEUED` -> `PROCESSING` -> `SUCCEEDED`).
- Robust multi-tenancy enforcement mechanisms (indexes, Row-Level Security).
- High reliability, broad ecosystem support, and zero lock-in across local and cloud environments.
- Support for relational joins, JSONB payload attributes, and advisory locks.

## Considered Options

1. **PostgreSQL**
2. **DynamoDB / NoSQL (MongoDB)**
3. **MySQL / MariaDB**

## Decision Outcome

**Chosen option: PostgreSQL (v16+)**.

### Rationale

- **Atomic State Transitions**: Monotonic job state updates require atomic compare-and-swap semantics (`UPDATE jobs SET status = 'PROCESSING' WHERE id = $1 AND status = 'QUEUED' RETURNING *`). PostgreSQL handles these natively with row-level locks without phantom reads.
- **Tenant Isolation**: PostgreSQL offers mature Row-Level Security (RLS) policies, allowing architectural enforcement of tenant boundaries at the database engine level.
- **Relational Integrity**: Foreign keys guarantee that jobs, tokens, and billing records strictly reference valid tenants and API keys.
- **JSONB Flexibility**: Metadata and model parameters can be stored as structured JSONB without sacrificing indexing speed.
- **Universal Availability**: Runs locally as a lightweight container in Docker Compose and deploys to Amazon RDS with Multi-AZ high availability in production.

## Consequences

- **Positive**:
  - Battle-tested operational reliability and deterministic consistency.
  - Transparent migration tooling (Flyway, Knex, or Drizzle).
  - Excellent performance for operational CRUD workloads.
- **Negative / Trade-offs**:
  - Horizontal scaling requires connection pooling (e.g., PgBouncer) and eventual table partitioning for high-volume historical jobs.

