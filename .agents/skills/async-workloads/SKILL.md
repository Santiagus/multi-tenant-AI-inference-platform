---
name: async-workloads
description: Queues, job lifecycle states, idempotency, retries, DLQ and cancellation for asynchronous inference jobs.
---

# Async Workloads

Job processing must be idempotent, observable, retry-safe, bounded and recoverable.

- Model explicit job states.
- Retries distinguish transient from permanent failures where practical.
- Use a DLQ for exhausted/unrecoverable work.
