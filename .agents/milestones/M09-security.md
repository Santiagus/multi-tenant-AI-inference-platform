# M09 — Security

Depends on: M03 | Read: `.agents/skills/security-testing/SKILL.md`

## Objective

Enforce tenant isolation and software supply-chain controls.

## Deliverables

- authentication boundary;
- tenant isolation and ABAC/scoped authorization;
- API key lifecycle;
- S3 object isolation;
- audit events;
- rate limiting;
- Kyverno policies;
- dependency/container scanning;
- SBOM;
- image signing where justified.

## Acceptance criteria

Automated tests prove tenant A cannot access tenant B resources, jobs, artifacts or billing data.

## Out of scope

Compliance certification claims. Document controls and evidence only.

## Outcome

- Entry points: `POST /v1/auth/api-keys`, `GET /v1/auth/api-keys`, `DELETE /v1/auth/api-keys/:id`, `GET /v1/security/audit-events`, `GET /v1/security/rate-limits`, `python3 scripts/security_scan.py`, `python3 scripts/generate_sbom.py`.
- Authentication & API key lifecycle: SHA-256 hashed keys (`ak_live_...`) with constant-time comparison, secret masking, scoped permissions, model restrictions, and instant revocation.
- Tenant isolation: Multi-tenant boundary checks on queries, S3 object keys (`tenants/{tenantId}/`), header spoofing prevention, and cross-tenant job access denial.
- Scoped ABAC & rate limiting: Granular scopes (`jobs:read`, `jobs:write`, `models:execute`, `admin`), sliding window per-tenant rate limiter with standard rate headers (`429 Too Many Requests`).
- Audit logging: Structured security audit log records authentication failures, authorization denials, key operations, and rate limit exhaustion.
- Kyverno admission policies: 5 declarative ClusterPolicies in `deploy/k8s/kyverno/` enforcing non-root execution, dropping ALL capabilities, read-only rootfs, and tenant namespace isolation.
- Supply chain controls: CycloneDX 1.5 JSON SBOM generation (`docs/security/sbom.json`), container/manifest security scanner (`scripts/security_scan.py`), and Cosign OIDC signing documentation (`docs/security/supply-chain.md`).
- Verification: 106 automated tests (unit, integration, and security suites with 100% domain coverage) verified via `make ci`.
- Deviations from spec: None.
- Stubs left: None.

