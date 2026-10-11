# Platform Test Plan & Verification Matrix

This document tracks the verification matrix, automated test suites, and workload use cases across all engineering milestones. In accordance with `AGENTS.md` (**Evidence Over Claims**), every verification entry explicitly states its execution mode: `Mocked`, `Simulated`, `Local Emulated`, or `Measured (Live)`.

---

## 1. Milestone Test Progression

| Milestone | Scope | Infrastructure Mode | Primary Verification Suites | Status |
|---|---|---|---|---|
| **M00** | Foundation & Repository Hygiene | Local Host | Format, Python lint, Mermaid validator, Gitleaks, Handoff | **Passed** |
| **M01** | Architecture & Durable Contracts | Local Host | AST integrity, Mermaid diagram validation, Handoff rules | **Passed** |
| **M02** | Local Platform Skeleton | Local Compose (PostgreSQL, MinIO, ElasticMQ, API) | Fastify contracts, DB migrations, S3/SQS adapters, lifecycle E2E | **Passed** |
| **M03** | Asynchronous Inference | Local Worker Daemon | Queue consumers, retry backoff, DLQ quarantine, Russian Doll profiling | **Passed** |
| **M04** | GPU Inference & Workers | Local RTX 5070 Ti / CPU Fallback | PyTorch inference, VRAM telemetry, reproducible benchmarks | **Passed** |
| **M05** | Observability & Telemetry | Local OTel Collector + Prometheus | Trace context propagation, metric counters, Grafana dashboards | _Planned_ |
| **M06** | Kubernetes Scheduling | Kind / k3d + Helm | KEDA autoscaler, Kueue batch admission, Kyverno policies | _Planned_ |
| **M07** | AWS Ephemeral Platform | AWS S3, SQS, EKS (Terraform) | Ephemeral cloud integration, least-privilege IAM, cost budget | _Planned_ |
| **M08** | Provider Routing | Local / RunPod / Bedrock / SageMaker | Provider contract tests, fallback routing, cost optimization | _Planned_ |
| **M09** | Multi-Tenant Security | Isolated DB + S3 Prefixes | Tenant cross-boundary isolation, ABAC authorization tests | _Planned_ |
| **M10** | GitOps & Continuous Delivery | Argo CD + GitHub Actions | Argo CD sync, environment promotion, OIDC deployment gates | _Planned_ |
| **M11** | Product Dashboard | React + Fastify API | Component tests, API contract integration, WebSocket feeds | _Planned_ |
| **M12** | Production Readiness | Distributed Load & Chaos | Locust load tests, worker crash injection, partition recovery | _Planned_ |

---

## 2. M02 Verification Matrix (Local Platform Skeleton)

### Execution Mode Definitions
- **Unit (Mocked / In-Memory)**: Runs in-memory with zero external dependencies (fast local feedback in CI).
- **Integration (Simulated)**: Injects simulated HTTP calls via Fastify `inject()` validating RFC 7807 contracts.
- **E2E (Local Emulated)**: Exercises live containers via Docker Compose (`postgres:16-alpine`, `elestio/minio`, `softwaremill/elasticmq`).
- **Interactive**: Manual developer execution via [`request.rest`](../../request.rest) using VS Code REST Client.

### Detailed Test Matrix

| ID | Use Case & Description | Level | Execution Mode | Target Component | Expected Behavior & Invariants | Automated Test / Scratchpad |
|---|---|---|---|---|---|---|
| **TC-01** | **Liveness Probe** | Integration / Interactive | Live / Emulated | `GET /healthz` | Returns `200 OK`, `status: "ok"`, timestamp. | `apps/api/tests/integration/health-routes.test.ts`<br>`request.rest` (Cycle 1.1) |
| **TC-02** | **Readiness Probe (All Healthy)** | Integration / Interactive | Live / Emulated | `GET /readyz` | Queries DB, MinIO S3 bucket, and ElasticMQ queue. Returns `200 OK`, `status: "ready"`. | `apps/api/tests/integration/health-routes.test.ts`<br>`request.rest` (Cycle 1.2) |
| **TC-03** | **Readiness Probe (Dependency Down)** | Integration | Mocked (Fault Injection) | `GET /readyz` | Injects downstream failure. Returns `503 Service Unavailable`, status: `"unhealthy"`. | `apps/api/tests/integration/health-routes.test.ts` |
| **TC-04** | **Job Submission (Happy Path)** | Integration / E2E | Local Emulated | `POST /v1/jobs` | Returns `202 Accepted`, `status: "QUEUED"`, `Location` header set to poll URL. Message published to SQS. | `apps/api/tests/integration/job-routes.test.ts`<br>`request.rest` (Cycle 2.1) |
| **TC-05** | **Idempotent Deduplication** | Integration / E2E | Local Emulated | `POST /v1/jobs` (`Idempotency-Key`) | First request returns `202 Accepted`. Second request with matching key returns `200 OK` with identical `job_id`. No duplicate queue message. | `apps/api/tests/integration/job-routes.test.ts`<br>`request.rest` (Cycle 3.1 & 3.2) |
| **TC-06** | **Large Payload Offloading** | Unit | Mocked Storage | `JobService.submitJob` | Inline inputs >256KB are automatically offloaded to S3 bucket, storing `s3://...` URI in PostgreSQL. | `apps/api/tests/unit/job-service.test.ts` |
| **TC-07** | **Job Status Query** | Integration / E2E | Local Emulated | `GET /v1/jobs/:id` | Returns current state, timestamps, duration, usage, and presigned artifact download URLs if present. | `apps/api/tests/integration/job-routes.test.ts`<br>`request.rest` (Cycle 2.2 & 2.5) |
| **TC-08** | **Lifecycle Transition (Processing)** | Integration / E2E | Local Emulated | `POST /v1/jobs/:id/transition` | Transitions state from `QUEUED` to `PROCESSING`. Sets `started_at` timestamp. | `apps/api/tests/integration/job-routes.test.ts`<br>`request.rest` (Cycle 2.3) |
| **TC-09** | **Lifecycle Transition (Succeeded)** | Integration / E2E | Local Emulated | `POST /v1/jobs/:id/transition` | Transitions to `SUCCEEDED`. Persists output payload, tokens, duration, cost, and sets `completed_at`. | `apps/api/tests/integration/job-routes.test.ts`<br>`request.rest` (Cycle 2.4) |
| **TC-10** | **In-Flight Job Cancellation** | Integration / E2E | Local Emulated | `POST /v1/jobs/:id/cancel` | Cancels queued or processing job. Returns `200 OK`, `status: "CANCELLED"`, sets `completed_at`. | `apps/api/tests/integration/job-routes.test.ts`<br>`request.rest` (Cycle 4.1 & 4.2) |
| **TC-11** | **Terminal State Conflict Guard** | Integration / Interactive | Local Emulated | `POST /v1/jobs/:id/cancel` | Attempting to cancel a job in `SUCCEEDED` or `FAILED` state returns `409 Conflict` (RFC 7807 Problem Details). | `apps/api/tests/unit/job-service.test.ts`<br>`request.rest` (Cycle 4.4) |
| **TC-12** | **Payload Validation Rejection** | Integration / Interactive | Simulated | `POST /v1/jobs` | Invalid or missing required parameters returns `400 Bad Request` with field error map. | `apps/api/tests/integration/job-routes.test.ts`<br>`request.rest` (Cycle 5.1) |
| **TC-13** | **Non-Existent Job Query** | Integration / Interactive | Simulated | `GET /v1/jobs/:id` | Querying missing UUID returns `404 Not Found` RFC 7807 Problem Details. | `apps/api/tests/integration/job-routes.test.ts`<br>`request.rest` (Cycle 5.2) |
| **TC-14** | **Docker Compose Topology** | Unit | Local File Validator | `docker-compose.yml` | Validates Compose structure declares `postgres`, `minio`, `elasticmq`, `api`, and valid port bindings. | `tests/unit/test_platform_skeleton.py` |
| **TC-15** | **Database Migration & Seeding** | Integration / E2E | Local Emulated | `PostgreSQL 16` | Migrator applies `001_initial_schema.sql` idempotently, creating tables, tenant indexes, and seeding default tenant. | `apps/api/src/server.ts`<br>`tests/unit/test_platform_skeleton.py` |

---

## 3. M03 Verification Matrix (Asynchronous Inference Lifecycle)

| ID | Use Case & Description | Level | Execution Mode | Target Component | Expected Behavior & Invariants | Automated Test / Scratchpad |
|---|---|---|---|---|---|---|
| **TC-16** | **Idempotency Payload Hash Conflict** | Unit / Interactive | Mocked / Local Emulated | `JobService.submitJob` | Reusing an `Idempotency-Key` with a mutated request payload throws `409 Conflict` (`IDEMPOTENCY_CONFLICT`). | `apps/api/tests/unit/job-service.test.ts`<br>`request.rest` (Cycle 3.4) |
| **TC-17** | **Monotonic State Machine & Bounded Backoff** | Unit | Mocked | `canTransitionStatus`, `calculateBackoffSeconds` | Blocks backward transitions out of terminal states (`409 INVALID_STATE_TRANSITION`) and bounds exponential retry delay $\min(\text{base} \cdot 2^{n-1}, \text{max})$. | `apps/api/tests/unit/job-worker.test.ts`<br>`apps/api/tests/unit/job-service.test.ts` |
| **TC-18** | **Worker End-to-End Execution & Artifact Storage** | Unit / Integration | Mocked / Simulated | `JobWorker`, `POST /v1/worker/process-next` | Leases queued message, loads offloaded S3 inputs if present, executes inference, writes `result.json` to S3, transitions to `SUCCEEDED`, and deletes queue message. | `apps/api/tests/unit/job-worker.test.ts`<br>`apps/api/tests/integration/job-routes.test.ts` |
| **TC-19** | **Russian Doll Profiling & Modular Hook Headers** | Unit / Integration | Simulated | `ProfilingInferenceExecutor`, `request-context.ts`, `error-handler.ts` | Attaches `x-correlation-id` and `x-response-time-ms` on HTTP responses, `correlation_id` on RFC 7807 errors, and `profiled_wall_ms` + `tokens_per_sec` in job result metadata. | `apps/api/tests/integration/job-routes.test.ts`<br>`request.rest` (Cycles 5 & 6) |
| **TC-20** | **Transient Failure Retry & Recovery** | Unit / Interactive | Mocked / Simulated | `JobWorker` | Transient failure increments `retry_count`, transitions job to `RETRYING`, sets visibility timeout backoff, and succeeds on subsequent delivery without DLQ routing. | `apps/api/tests/unit/job-worker.test.ts`<br>`request.rest` (Cycle 6.1–6.3) |
| **TC-21** | **Max Retries Exhaustion & Permanent Failure to DLQ** | Unit / Integration | Mocked / Simulated | `JobWorker`, `GET /v1/jobs/dlq`, `InMemoryQueueClient` | Exhausted transient retries or permanent errors mark job `FAILED`, quarantine envelope in `inference-jobs-dlq` with failure metadata, and expose via `GET /v1/jobs/dlq`. | `apps/api/tests/unit/job-worker.test.ts`<br>`apps/api/tests/unit/queue.test.ts`<br>`apps/api/tests/integration/job-routes.test.ts`<br>`request.rest` (Cycle 6.4–6.6) |
| **TC-22** | **Pre-Flight & Mid-Flight Cancellation Semantics** | Unit | Mocked | `JobWorker` | Skips queued jobs cancelled prior to pickup (`skipped_terminal`) and aborts mid-execution if cancelled concurrently (`cancelled`), preserving `CANCELLED` state. | `apps/api/tests/unit/job-worker.test.ts` |
| **TC-23** | **Background Polling Daemon Lifecycle** | Unit | Mocked | `JobWorker.start` / `stop` | Starts background polling loop idempotently, processes queued jobs asynchronously, and drains cleanly on shutdown (`SIGINT`/`SIGTERM`). | `apps/api/tests/unit/job-worker.test.ts` |

---

## 4. M04 Verification Matrix (GPU Inference & Benchmarks)

| ID | Use Case & Description | Level | Execution Mode | Target Component | Expected Behavior & Invariants | Automated Test / Scratchpad |
|---|---|---|---|---|---|---|
| **TC-24** | **Provider-Agnostic Inference Request & Contract Validation** | Unit | Measured / Mocked | `apps/worker/contracts.py` | Parses nested and flat job payloads, validates `model_id`, and classifies structured `InferenceError` (`is_transient`). | `tests/unit/test_inference_worker.py` |
| **TC-25** | **CPU-Fallback Tensor Forward Pass & Context Guard** | Unit | Measured (Live CPU) | `NumpyCpuModelBackend`, `ModelLoader` | Executes deterministic multi-layer matrix-multiplication autoregressive token generation on CPU and enforces `max_context_length`. | `tests/unit/test_inference_worker.py` |
| **TC-26** | **PyTorch CUDA / CPU Execution & VRAM Telemetry** | Unit | Mocked CUDA / Measured CPU | `PyTorchModelBackend`, `LocalPyTorchAdapter`, `TelemetryCollector` | Exercises `pytorch_cuda` and `pytorch_cpu` tensor forward passes, model cache warm hits, CUDA stream sync, peak VRAM tracking, and host RSS telemetry. | `tests/unit/test_inference_worker.py` |
| **TC-27** | **Worker Runtime CLI & Tenant Artifact Serialization** | Unit | Measured (Live CPU) | `WorkerRuntime`, `ArtifactHandler`, `apps/worker/consumer.py` | Executes inference via CLI (`--payload`, `--healthcheck`), writes tenant-isolated `result.json` artifacts, and formats usage/telemetry metadata. | `tests/unit/test_inference_worker.py`<br>`request.rest` (Cycle 7.1–7.3) |
| **TC-28** | **Control-Plane to Python Worker Bridge** | Unit / Integration | Measured (Live Subprocess) | `PythonWorkerInferenceExecutor` (`job-worker.ts`) | Invokes `python3 -m apps.worker.consumer`, propagates `local_pytorch` token usage and hardware telemetry, and maps transient/permanent errors. | `apps/api/tests/unit/job-worker.test.ts` |
| **TC-29** | **Reproducible Latency, Throughput & Concurrency Benchmark** | Benchmark / Unit | Measured (Live CPU) + Estimated GPU | `benchmarks/run_inference_benchmark.py` | Runs cold/warm and concurrency sweep ($c \in \{1,2,4,8\}$), records `p50`/`p95`/`p99` latencies, TTFT, and throughput, and strictly separates `Measured` host results from `Estimated` RTX 5070 Ti targets. | `tests/unit/test_inference_worker.py`<br>`benchmarks/results/m04_inference_benchmark.md` |

---

## 5. Maintenance Rules for Subsequent Milestones

When implementing future milestones (M05–M12):
1. **Update Milestone Status**: Set the milestone status in Section 1 to `In Progress` or `Passed`.
2. **Append Milestone Rows**: Add a new sub-table (`M05 Verification Matrix`, etc.) covering that milestone's test cases.
3. **Strict Execution Labeling**:
   - `Mocked`: In-memory or stubbed responses.
   - `Local Emulated`: Running against local containers (Docker Compose, ElasticMQ, MinIO).
   - `Measured (Live)`: Backed by real hardware execution (e.g. RTX 5070 Ti CUDA tokens/sec or AWS cloud API calls).
4. **CI Requirement**: All automated test cases added to the matrix must execute and pass in `make test` and `make ci`.


