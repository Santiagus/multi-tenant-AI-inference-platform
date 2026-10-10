# Architecture Overview

This document provides the high-level system context, container architecture, and foundational principles for the **Multi-Tenant AI Inference Platform**. It serves as the primary entry point to the architecture documentation.

---

## 1. System Context

The platform provides a unified, multi-tenant control plane and distributed execution environment for asynchronous AI inference workloads. Clients submit inference requests specifying target models, inputs, and routing constraints. The platform guarantees strict tenant isolation, asynchronous job scheduling, provider-agnostic dispatch (local GPU, RunPod, AWS Bedrock, AWS SageMaker), deterministic state transitions, artifact persistence, and end-to-end observability with per-tenant cost attribution.

```mermaid
%%{init: {'theme': 'dark', 'themeVariables': { 'darkMode': true }}}%%
flowchart TD
    Client["Tenant Client / Applications"]
    Engineer["Platform Engineer / Operator"]
    
    subgraph Platform["Multi-Tenant AI Inference Platform"]
        ControlPlane["Platform API & Control Plane"]
        Workers["Distributed Inference Engine"]
        Dash["Product Dashboard & Observability UI"]
    end
    
    subgraph External["External Compute & Infrastructure"]
        S3Bucket[("Object Storage (S3 / MinIO)")]
        CloudProviders["Cloud AI Providers (Bedrock / SageMaker / RunPod)"]
    end

    Client -->|"Submit Jobs, Fetch Results (HTTPS/REST)"| ControlPlane
    Engineer -->|"Inspect Workloads, Monitor Health"| Dash
    ControlPlane -->|"Enqueue Workload Tasks"| Workers
    Workers -->|"Read/Write Artifacts"| S3Bucket
    Workers -->|"Dispatch External Inference"| CloudProviders
    Workers -->|"Report Execution Telemetry"| ControlPlane
    Dash -->|"Query Metrics & Job States"| ControlPlane
```

---

## 2. Container Architecture

The system is decomposed into decoupled services interacting via standardized contracts:

```mermaid
%%{init: {'theme': 'dark', 'themeVariables': { 'darkMode': true }}}%%
flowchart TD
    subgraph Ingress["Edge & Ingress Layer"]
        CF["CloudFront / CDN"]
        ALB["Application Load Balancer (ALB)"]
        UI["React Dashboard (SPA)"]
    end

    subgraph ControlPlaneLayer["Control Plane (TypeScript / Fastify)"]
        API["Fastify HTTP Server"]
        AuthModule["AuthN & Tenant ABAC Guard"]
        RouterEngine["Provider Routing Engine"]
        JobManager["Job Lifecycle Manager"]
    end

    subgraph StateStorage["Operational State & Queuing"]
        PG[("PostgreSQL (Job State & Tenant Metadata)")]
        RedisCache[("Redis (Rate Limiting & Lease Coordination)")]
        SQSQueue["SQS / Message Broker (Async Job Queue)"]
        DLQ["Dead Letter Queue (DLQ)"]
    end

    subgraph ExecutionLayer["Execution & Inference (Python / PyTorch)"]
        WorkerPool["Worker Host / Pods"]
        LocalAdapter["Local GPU / CPU PyTorch Worker"]
        RunPodAdapter["RunPod Serverless Adapter"]
        BedrockAdapter["AWS Bedrock Adapter"]
        SageMakerAdapter["AWS SageMaker Adapter"]
    end

    subgraph ArtifactLayer["Artifact & Blob Store"]
        S3[("S3-Compatible Storage (MinIO / AWS S3)")]
    end

    subgraph TelemetryLayer["Telemetry & Accounting"]
        OTel["OpenTelemetry Collector"]
        Prom["Prometheus"]
        Grafana["Grafana Dashboards"]
    end

    UI --> CF
    CF --> ALB
    ALB --> API
    API --> AuthModule
    AuthModule --> JobManager
    JobManager --> PG
    JobManager --> RedisCache
    JobManager --> SQSQueue
    SQSQueue -.->|"Max Retries Exceeded"| DLQ

    SQSQueue --> WorkerPool
    WorkerPool --> RouterEngine
    WorkerPool --> LocalAdapter
    WorkerPool --> RunPodAdapter
    WorkerPool --> BedrockAdapter
    WorkerPool --> SageMakerAdapter

    WorkerPool --> S3
    API --> S3
    WorkerPool --> PG
    WorkerPool --> OTel
    API --> OTel
    OTel --> Prom
    Prom --> Grafana
```

---

## 3. Core Architectural Principles

1. **Evidence Over Claims**: Every claimed capability (concurrency, cold start latencies, VRAM efficiency, isolation boundaries) must be verified through reproducible automated benchmarks, integration suites, and failure injection. No synthetic or assumed performance figures are accepted.
2. **Provider-Agnostic Core**: Workload orchestration, job state machines, billing accounting, and client contracts depend strictly on provider-agnostic port interfaces (`InferenceProvider`). Backend adapters (Local PyTorch, RunPod, Bedrock, SageMaker) implement identical lifecycle contracts.
3. **Local-First, Cloud-Verifiable**: Development, testing, and debugging run entirely offline using Docker Compose, PyTorch CPU/RTX fallback, MinIO, and queue mocks. Cloud deployment on Kubernetes and AWS validates the exact same contracts without introducing architectural divergence.
4. **Strict Multi-Tenant Isolation**: Tenancy boundaries are non-negotiable. Every database record carries tenant context enforced via Row-Level Security (RLS) or tenant predicate boundaries. S3 artifacts are strictly partitioned by tenant ID (`tenants/<tenant_id>/...`). Queues and logs preserve cryptographic tenant segregation.
5. **Decoupled Asynchronous Lifecycle**: Heavy computational tasks never execute synchronously in HTTP request loops. Fastify handles fast admission, payload ingestion, authentication, and enqueues jobs to SQS-compatible queues with durable delivery, idempotency tracking, exponential backoff, and DLQ handling.

---

## 4. Documentation Index

The architecture documentation is structured into the following focused specifications:

| Topic | Document | Focus |
|---|---|---|
| **Component Architecture** | [components.md](components.md) | Component responsibilities, internal interfaces, and boundaries. |
| **Deployment Topology** | [deployment-topology.md](deployment-topology.md) | Local Compose runtime vs. AWS EKS / Hybrid cloud staging and production. |
| **Data Ownership Model** | [data-ownership.md](data-ownership.md) | Storage categorization, retention policies, and single-writer boundaries. |
| **API & Job Contract** | [job-lifecycle-contract.md](job-lifecycle-contract.md) | REST endpoints, JSON schemas, job state machine, idempotency, and retries. |
| **Provider Abstraction** | [provider-abstraction.md](provider-abstraction.md) | Standard worker interface and provider adapter contracts. |
| **Tenancy & Security** | [tenancy-security.md](tenancy-security.md) | ABAC authentication, resource isolation, storage policies, and audit trails. |
| **Observability Model** | [observability.md](observability.md) | Distributed tracing, correlation IDs, metrics taxonomy, and GPU telemetry. |
| **Local-vs-Cloud Boundary** | [local-cloud-boundary.md](local-cloud-boundary.md) | Environment parity, mock behaviors, and hardware fallback paths. |
| **Architecture Decision Records** | [docs/adr/](../adr/README.md) | Durable architectural choices and evaluated alternatives. |

