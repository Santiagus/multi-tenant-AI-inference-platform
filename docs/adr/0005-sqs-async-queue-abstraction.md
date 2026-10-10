# ADR-0005: Use SQS-Compatible Message Broker for Asynchronous Workload Queue

- **Status**: Accepted
- **Date**: 2026-10-09
- **Deciders**: Architecture Team

---

## Context & Problem Statement

Machine learning inference tasks are long-running (ranging from hundreds of milliseconds to several minutes) and resource-intensive. Executing them synchronously in the HTTP request loop risks connection timeouts, thread pool starvation, and unmitigated traffic spikes crashing compute pods. The platform needs an asynchronous message broker to buffer jobs, decouple ingestion from execution, and support retries with Dead-Letter Queues (DLQ).

## Decision Drivers

- Decoupled buffering between Fastify API and variable worker compute capacity.
- Native visibility timeout semantics, enabling workers to lease messages and extend heartbeats during execution.
- Dead-Letter Queue (DLQ) support for poison pill quarantine.
- Compatibility with Kubernetes Event-driven Autoscaling (KEDA) for queue-length based worker pod autoscaling.
- Zero-maintenance managed service in AWS with lightweight local mocking.

## Considered Options

1. **Amazon SQS / ElasticMQ (SQS-compatible abstraction)**
2. **RabbitMQ (AMQP)**
3. **Apache Kafka**
4. **Redis Streams / Celery / BullMQ**

## Decision Outcome

**Chosen option: SQS-compatible message broker (Amazon SQS in AWS, ElasticMQ in Docker Compose)**.

### Rationale

- **Visibility Timeout Model**: SQS's visibility timeout is purpose-built for job queues: when a worker receives a message, it becomes invisible to other workers. If the worker crashes or fails to heartbeat, the message automatically reappears in the queue for retry.
- **DLQ & Redrive**: Built-in maximum receive count redrives failing messages to a dead-letter queue without custom application retry engines.
- **KEDA Scaler**: KEDA features an official, production-grade SQS scaler that scales worker deployments from 0 to N based on queue depth.
- **Serverless & Zero-Ops**: Fully managed in AWS with virtually unlimited scaling and pay-per-request pricing; runs locally in Compose using ElasticMQ (a lightweight, in-memory Scala container implementing the SQS query API).

## Consequences

- **Positive**:
  - No broker cluster management, partition rebalancing, or disk management overhead.
  - Predictable failure semantics and retry loops.
  - Workers scale to zero when queues are empty, saving expensive GPU costs.
- **Negative / Trade-offs**:
  - Message size ceiling of 256 KB (resolved by storing larger payloads in S3 and passing object URIs in the message envelope).
  - Standard SQS does not guarantee strict FIFO ordering across tenants, though per-message deduplication and tenant fair-sharing address this at the application layer.

