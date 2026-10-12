# Multi-Tenant AI Inference Platform

A production-oriented reference platform demonstrating the complete lifecycle of asynchronous, multi-tenant AI inference workloads:

```mermaid
%%{init: {'theme': 'dark', 'themeVariables': { 'darkMode': true }}}%%
flowchart LR
    API["API"] --> AUTH["AuthN / AuthZ"]
    AUTH --> QUEUE["Async Queue"]
    QUEUE --> ROUTE["Policy Routing"]
    ROUTE --> WORKERS["Inference Workers"]
    WORKERS --> ARTIFACTS["Artifact Store"]
    ARTIFACTS --> TELEMETRY["Telemetry & Cost Accounting"]
```

Engineered for architectural coherence, measurable performance, strict tenant boundary enforcement, and reproducible local/cloud deployment.

---

## Architecture Overview

```mermaid
%%{init: {'theme': 'dark', 'themeVariables': { 'darkMode': true }}}%%
flowchart TD
    DASH["React Product Dashboard"]
    API["Fastify Control Plane<br/>(AuthN/Z, Jobs, Cost)"]
    DB[("PostgreSQL<br/>(Job State)")]
    QUEUE["SQS / Event Queue Bus"]
    LOCAL["Local Workers (PyTorch)<br/>(RTX 5070 Ti / CPU)"]
    CLOUD["External Cloud Router<br/>(RunPod, Bedrock, …)"]
    S3[("S3-Compatible Artifacts")]

    DASH --> API
    API --> DB
    API --> QUEUE
    QUEUE --> LOCAL
    QUEUE --> CLOUD
    LOCAL --> S3
    CLOUD --> S3
```

### Core Tenets

1. **Evidence Over Claims**: Every claimed capability is verified via reproducible benchmarks, load tests, or automated isolation tests. No fabricated metrics.
2. **Provider-Agnostic Core**: Business logic and contracts depend on port abstractions, not specific vendor SDKs. Cloud and local share identical contracts.
3. **Local-First, Cloud-Verifiable**: Complete functional stack runs locally without requiring paid cloud infrastructure or proprietary emulators. GPU tasks have local acceleration fallback.
4. **Strict Multi-Tenancy**: Tenant boundary enforcement at the database, queue, storage, and telemetry layers.

---

## Technology Stack

| Domain | Technology | Rationale |
|---|---|---|
| **Control Plane** | TypeScript / Fastify (`pnpm`) | High throughput, strict schema validation, deterministic error handling |
| **Inference Engine** | Python / PyTorch (`uv`) | Ecosystem standard for model lifecycle and hardware acceleration |
| **Product UI** | React + TypeScript + React Flow | Job inspector, tenant economics, and routing explanation |
| **Operational Storage** | PostgreSQL | Transactional state transitions, tenant-scoped schemas/indexes |
| **Artifact Storage** | S3-compatible (MinIO / AWS S3) | Standardized payload & model artifact isolation |
| **Queue / Scheduling** | SQS-compatible abstraction / KEDA | Decoupled asynchronous job lifecycle with DLQ & backoff |
| **Telemetry** | OpenTelemetry · Prometheus · Grafana | End-to-end tracing (`request → job → worker → artifact`) |
| **Container & Cloud** | Docker Compose · Kubernetes (Helm) · Terraform | Local parity transitioning to reproducible AWS infrastructure |

---

## Repository Structure

This repository is organized as an incremental monorepo:

```text
├── .agents/                 # AI agent operating rules, skills, and milestone specs
│   ├── milestones/          # Sequential milestones (M00 to M12)
│   └── skills/              # Specialized domain instructions (OTel, PyTorch, K8s, etc.)
├── apps/                    # Control plane API, inference worker, dashboard (M02+)
├── packages/                # Shared contracts, types, and provider adapters (M02+)
├── infrastructure/          # Terraform modules & AWS configuration (M07+)
├── deploy/                  # Docker Compose, Helm charts, and Argo CD manifests (M02, M06, M10)
├── benchmarks/              # Reproducible performance harnesses (M04, M12)
├── tests/                   # End-to-end and tenant isolation test suites (M02+)
├── docs/                    # Architecture diagrams and Architecture Decision Records (ADRs) (M01+)
├── AGENTS.md                # Top-level operating manual for automated pair-programming
├── LICENSE                  # Apache 2.0 License
└── README.md
```

---

## Development Roadmap

Implementation proceeds in disciplined, incremental milestones. Each milestone is validated against explicit acceptance criteria and automated checks before merging:

| Milestone | Title | Focus | Status |
|---|---|---|---|
| **M00** | GitHub Foundation | Monorepo layout, pre-commit validation, secret scanning, and CI gate | **Done** |
| **M01** | Architecture & ADRs | Formal contracts, tenancy model, and durable technical decisions | **Done** |
| **M02** | Local Platform Skeleton | Containerized local runtime (Fastify, PostgreSQL, S3 mock, Queue) | **Done** |
| **M03** | Async Inference Lifecycle | Idempotent job handling, exponential backoff, DLQ, and cancellation | **Done** |
| **M04** | GPU Inference & Benchmarks | PyTorch worker, GPU telemetry, and reproducible performance harness | **Done** |
| **M05** | Observability | OpenTelemetry distributed tracing and Grafana operational dashboards | **Done** |
| **M06** | Kubernetes Scheduling | Helm packaging, KEDA queue autoscaling, Kueue admission, and Kyverno policies | **Done** |
| **M07** | AWS Cloud Platform | Terraform infrastructure, least-privilege IAM, and cost guardrails | _Planned_ |
| **M08** | Provider Policy Routing | Dynamic routing between local compute, RunPod, Bedrock, and SageMaker | _Planned_ |
| **M09** | Multi-Tenant Security | ABAC, tenant isolation test suites, and supply chain controls | _Planned_ |
| **M10** | GitOps & Continuous Delivery | Argo CD synchronization, environment promotion, and OIDC pipelines | _Planned_ |
| **M11** | Product Dashboard | Workload path visualization, tenant margins, and routing inspectability | _Planned_ |
| **M12** | Production Readiness | Comprehensive failure injection, load verification, and final evidence | _Planned_ |

---

## AI-Assisted Engineering Process

This project is built using disciplined agentic pair-programming governed by:
- **[AGENTS.md](AGENTS.md)**: Session-scoped execution constraints, non-fabrication rules, and boundary safety.
- **[Milestone Protocol](.agents/README.md)**: Strict context boundaries preventing cross-milestone scope creep and ensuring traceable, incremental development.
- **Durable Decisions (ADRs)**: Technical choices are justified with constraints and alternatives before implementation (see [`docs/adr/`](docs/adr/README.md)).

---

## Getting Started

### Prerequisites

- **Make**: Standard build automation tool
- **Node.js 22+ & pnpm 12+**: Fastify control plane API runtime and workspace package manager
- **Python 3.11+**: Base runtime for inference worker, validation scripts, and tests (`numpy`, `psutil`, `pyyaml`)
- **Docker & Docker Compose**: Local platform runtime (PostgreSQL 16, MinIO, ElasticMQ, OTel Collector, Prometheus, Grafana)
- **Gitleaks**: Fast credential detection tool ([Installation guide](https://github.com/gitleaks/gitleaks))

### First Steps & Local Development

1. **Install workspace dependencies (Node.js & Python worker)**:
   ```bash
   pnpm install
   pnpm build
   pip install -e ./apps/worker   # or: uv pip install --system -e ./apps/worker
   ```

2. **Option A: Start full platform & observability stack via Docker Compose**:
   ```bash
   # Starts PostgreSQL, MinIO (S3), ElasticMQ (SQS), Fastify API, OTel Collector, Prometheus (:9090), and Grafana (:3001)
   docker compose up -d --build

   # Verify all services are healthy
   docker compose ps
   ```

3. **Option B: Local development loop (API on host with hot-reload)**:
   ```bash
   # Start only backing infrastructure
   docker compose up -d postgres minio elasticmq

   # Start Fastify API with hot-reload
   cd apps/api
   pnpm dev
   ```

4. **Execute end-to-end workload cycles & populate Grafana dashboards**:
   - **Interactive REST Client**: Open [`request.rest`](request.rest) in VS Code with the REST Client extension (`humao.rest-client`) to execute Use Cases 1–9 (health probes, job lifecycle, idempotency, cancellation, retries/DLQ, PyTorch inference, W3C distributed tracing, and Kubernetes KEDA/Kueue/Kyverno scheduling).
   - **Automated Workload Simulator**:
     ```bash
     make simulate-observability
     ```
     Then open the provisioned Grafana dashboards (anonymous admin login enabled):
     - **Inference Operations (M05)**: `http://localhost:3001/d/platform-inference-operations`
     - **Kubernetes Scheduling & Autoscaling (M06)**: `http://localhost:3001/d/platform-kubernetes-scheduling`

5. **Kubernetes Helm Packaging & Validation (M06)**:
   - Render and validate the Helm chart ([`deploy/helm/inference-platform/`](deploy/helm/inference-platform/Chart.yaml)) across local CPU ([`values-local.yaml`](deploy/helm/inference-platform/values-local.yaml)) and GPU ([`values-gpu.yaml`](deploy/helm/inference-platform/values-gpu.yaml)) profiles, KEDA scaler, Kueue batch admission, and Kyverno policies:
     ```bash
     make validate-k8s
     ```

### Local Validation Gate

Run the full local CI gate before submitting pull requests or committing code:

```bash
# Run all checks: formatting, linting, types, unit tests, secrets/PII, and milestone handoff
make ci
```

Individual validation targets:
```bash
make format-check           # Check line endings, trailing whitespace, and EOF newlines
make lint                   # Check Python, JSON, and Mermaid diagram syntax
make typecheck              # Validate Python (mypy) and TypeScript (tsc) types
make test                   # Run Python and TypeScript unit & integration test suites
make validate-k8s           # Render Helm chart profiles and validate KEDA, Kueue, and Kyverno policies
make simulate-observability # Run live workload simulator to populate Prometheus & Grafana
make scan                   # Run Gitleaks and PII pattern scanning
make handoff-check          # Validate milestone protocol compliance (.agents/README.md)
make install-hooks          # Configure local Git repository to run pre-commit hook
```

### Pre-Commit Secret Scanning

This repository strictly enforces secret prevention:
```bash
# Verify Gitleaks installation
gitleaks version

# Run standalone detection against repository
gitleaks detect --source=. --config=.gitleaks.toml --no-git --verbose
```

---

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) for details.

