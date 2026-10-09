# Security Policy

## Reporting a Vulnerability

We take the security and integrity of this platform seriously. If you discover a security vulnerability or potential threat affecting the platform or tenant isolation boundaries, please report it responsibly.

**Do not open a public GitHub issue for security vulnerabilities.**

Instead, please report vulnerabilities privately via:
- **GitHub Security Advisories (Preferred)**: [Open a Private Advisory](https://github.com/Santiagus/multi-tenant-AI-inference-platform/security/advisories/new)
- **Direct Email Contact**: `santiagoabad@gmail.com`

Please include:
1. Description of the vulnerability and its potential impact.
2. Steps to reproduce or proof-of-concept demonstration.
3. Affected components, endpoints, or infrastructure modules.
4. Any proposed remediations or mitigations.

We will acknowledge receipt within 48 hours and provide regular updates until a fix is published.

---

## Secrets and Credential Handling

This repository strictly enforces zero-credential exposure in public source code:
- **No Hardcoded Secrets**: API keys, JWT signing keys, private certificates, cloud access keys, and passwords must never be committed.
- **Local Pre-Commit Gates**: Local CI (`make scan`) runs [Gitleaks](https://github.com/gitleaks/gitleaks) and regex scans to catch potential credentials and PII prior to commit.
- **Continuous Integration Gates**: Every pull request and push runs automated secret and sensitive pattern detection in GitHub Actions. Pull requests with detected secrets will fail closed.
- **Configuration Injection**: Sensitive values are supplied via environment variables, secret managers, or Kubernetes Secrets at deployment time. Example configuration templates use non-functional dummy placeholders.

---

## Multi-Tenant Isolation Assurance

As a multi-tenant AI inference platform, the system is architected around Defense-in-Depth isolation:
- Workload jobs, database schemas, message queues, and object storage partitions must be tenant-scoped and authorization-checked.
- Automated security and isolation test suites are maintained to verify that no tenant can inspect, tamper with, or consume another tenant's compute or artifacts.

