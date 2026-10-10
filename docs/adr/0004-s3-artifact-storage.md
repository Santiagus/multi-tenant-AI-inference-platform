# ADR-0004: Use S3-Compatible Object Storage for Large Payloads and Artifacts

- **Status**: Accepted
- **Date**: 2026-10-09
- **Deciders**: Architecture Team

---

## Context & Problem Statement

AI inference workloads regularly involve large payloads: input prompts, multimodal image/audio inputs, raw tensor outputs, generated media, and model weight checkpoints. Storing these megabyte- or gigabyte-sized binary assets directly inside relational databases or message queues degrades query performance, inflates memory footprints, and breaches message size constraints (e.g., SQS 256 KB limit).

## Decision Drivers

- Scalable, cost-effective storage for immutable blobs ranging from tens of kilobytes to tens of gigabytes.
- Native support for client direct upload and download via presigned URLs to offload data transfer from API pods.
- Strict prefix partitioning for multi-tenant security (`tenants/<tenant_id>/...`).
- Exact protocol compatibility between local development (MinIO) and production (Amazon S3).

## Considered Options

1. **S3-Compatible Object Storage (Amazon S3 / MinIO)**
2. **Database Large Objects (PostgreSQL `BYTEA` / `pg_largeobject`)**
3. **Shared File System (NFS / Amazon EFS)**

## Decision Outcome

**Chosen option: S3-Compatible Object Storage (Amazon S3 in production, MinIO locally)**.

### Rationale

- **Storage De-coupling**: Separates operational metadata in PostgreSQL from bulk binary artifacts in object storage.
- **Presigned Transfer**: Allows tenants to upload large input assets directly to S3 and download outputs without funneling gigabytes through the Fastify API memory space.
- **Tenant Path Isolation**: Enforces tenant security by prefixing object paths with tenant IDs (`tenants/{tenant_id}/jobs/{job_id}/*`).
- **Standard Protocol**: MinIO runs seamlessly in local Docker Compose, exposing an identical S3 API consumed by standard AWS SDKs (`@aws-sdk/client-s3`, `boto3`).

## Consequences

- **Positive**:
  - Unbounded storage scalability at commodity pricing.
  - API pods remain lightweight and stateless.
  - Zero code differences between local MinIO and cloud AWS S3.
- **Negative / Trade-offs**:
  - Eventual consistency considerations (mitigated by modern S3 strong read-after-write consistency).
  - Lifecycle policies must be managed to expire obsolete temporary inputs and outputs.

