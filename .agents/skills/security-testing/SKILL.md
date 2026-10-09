---
name: security-testing
description: Tenant isolation, authorization tests at resource boundaries and security evidence.
---

# Security Testing

Test authorization at the resource boundary. Minimum multi-tenant evidence:
- cross-tenant job access denied;
- cross-tenant artifact access denied;
- cross-tenant billing/usage access denied;
- unauthorized model/provider configuration denied.

Also test secret scanning and container/dependency security where relevant.
