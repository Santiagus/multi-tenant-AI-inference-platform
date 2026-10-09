---
name: postgresql
description: PostgreSQL schema, migrations, transactions, indexing and tenant-aware queries for operational state.
---

# PostgreSQL

PostgreSQL holds operational relational state. Prefer:
- explicit migrations;
- constraints;
- indexes based on access patterns;
- transactions for state transitions;
- tenant-aware query boundaries.

Do not use PostgreSQL as a dumping ground for analytics that belong in a later analytical store.
