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
| **M05** | Observability & Telemetry | Local OTel Collector + Prometheus | Trace context propagation, metric counters, Grafana dashboards | **Passed** |
| **M06** | Kubernetes Scheduling | Kind / k3d + Helm | KEDA autoscaler, Kueue batch admission, Kyverno policies | **Passed** |
| **M07** | AWS Ephemeral Platform | AWS S3, SQS, EKS (Terraform) | Ephemeral cloud integration, least-privilege IAM, cost budget | **Passed** |
| **M08** | Provider Routing | Local / RunPod / Bedrock / SageMaker | Provider contract tests, fallback routing, cost optimization | **Passed** |
| **M09** | Multi-Tenant Security | Isolated DB + S3 Prefixes | Tenant cross-boundary isolation, ABAC authorization tests | _Planned_ |
| **M10** | GitOps & Continuous Delivery | Argo CD + GitHub Actions | Argo CD sync, environment promotion, OIDC deployment gates | _Planned_ |
| **M11** | Product Dashboard | React + Fastify API | Unit SDK tests, FinOps calculations, API contract integration, React Flow visualization | **Passed** |
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
| **TC-29** | **Multi-Run Dated Benchmark, Web Chart Series & Prompt-Tier Routing Matrix** | Benchmark / Unit | Measured (Live CPU) + Estimated GPU/Cloud | `benchmarks/run_inference_benchmark.py` | Evaluates `short`/`medium`/`long` prompt tiers and concurrency ($c \in \{1,2,4,8\}$), records `TTFT`, `ITL` (ms/tok), `p50`/`p95`/`p99`, unit cost (`$/1M tok`), `chart_series`, and prompt-size provider routing matrix across dated `runs/<run_id>/`, `manifest.json`, `history.jsonl`, and `index.md`. | `tests/unit/test_inference_worker.py`<br>`benchmarks/results/index.md`<br>`benchmarks/results/manifest.json` |

---

## 5. M05 Verification Matrix (Observability, Tracing & Dashboards)

| ID | Use Case & Description | Level | Execution Mode | Target Component | Expected Behavior & Invariants | Automated Test / Scratchpad |
|---|---|---|---|---|---|---|
| **TC-30** | **W3C TraceContext & AsyncLocalStorage Propagation** | Unit | Simulated | `tracer.ts`, `request-context.ts` | Parses and validates `traceparent`, propagates `traceId`, `spanId`, and `correlationId` across nested async boundaries, and enforces tenant isolation on span queries. | `apps/api/tests/unit/observability.test.ts` |
| **TC-31** | **End-to-End Job Trace Across All 6 Lifecycle Stages** | Integration | Simulated | `GET /v1/jobs/:id/trace`, `GET /v1/traces/by-correlation/:correlationId` | Follows a single job across `authorization` → `queue_enqueue` → `http_request` → `job_processing` → `inference_execution` → `artifact_storage` with shared `trace_id` and `correlation_id`. | `apps/api/tests/integration/observability-routes.test.ts`<br>`request.rest` (Cycle 8.1–8.4) |
| **TC-32** | **Python Worker & S3 Artifact Trace Context Propagation** | Unit / Integration | Measured (Live Subprocess) | `WorkerRuntime`, `ArtifactHandler`, `PythonWorkerInferenceExecutor` | Propagates `correlation_id` and `traceparent` into Python worker subprocess payload, response metadata, and serialized `result.json` S3 artifact. | `tests/unit/test_observability.py`<br>`apps/api/tests/unit/job-worker.test.ts` |
| **TC-33** | **Prometheus Metrics Exposition & P50/P95/P99 Quantiles** | Unit / Integration | Simulated | `metrics.ts`, `GET /metrics` | Exposes request rate, queue depth, queue wait, inference latency histograms + P50/P95/P99 quantiles, token/cost counters, error/retry/DLQ counters, worker utilization, and DCGM GPU gauges. | `apps/api/tests/unit/observability.test.ts`<br>`apps/api/tests/integration/observability-routes.test.ts`<br>`request.rest` (Cycle 8.5) |
| **TC-34** | **OTel Collector, Prometheus & Grafana Operational Dashboard** | Unit | Local File Validator | `deploy/observability/`, `docker-compose.yml` | Validates OTel Collector pipeline, Prometheus scrape targets, Grafana datasource/dashboard provisioning, and operational panels covering all required metrics. | `tests/unit/test_observability.py` |

---

## 6. M06 Verification Matrix (Kubernetes Scheduling, Autoscaling & Policies)

| ID | Use Case & Description | Level | Execution Mode | Target Component | Expected Behavior & Invariants | Automated Test / Scratchpad |
|---|---|---|---|---|---|---|
| **TC-35** | **Helm Chart Packaging: Local CPU vs GPU Node Profiles** | Unit | Local File Validator | `deploy/helm/inference-platform/`, `scripts/validate_kubernetes.py` | Renders 22 resources for `values-local.yaml` (CPU fallback, NodePort, no DCGM exporter) and 24 resources for `values-gpu.yaml` (`nvidia.com/gpu` limits, `runtimeClassName: nvidia`, GPU nodeSelector/tolerations, and `dcgm-exporter` DaemonSet + Service). | `tests/unit/test_kubernetes.py`<br>`scripts/validate_kubernetes.py` |
| **TC-36** | **KEDA Queue-Depth Worker Scaling (`0 -> N -> 0`)** | Unit / Integration | Simulated | `evaluateKedaScaling`, `GET /v1/k8s/autoscaling/status`, `templates/keda-scaledobject.yaml` | Scales worker replicas proportionally to `queue_depth + in_flight_jobs`, caps at `maxReplicaCount`, holds replicas during cooldown window, and scales to zero when idle. | `apps/api/tests/unit/kubernetes-scheduler.test.ts`<br>`apps/api/tests/integration/kubernetes-routes.test.ts`<br>`request.rest` (Cycle 9.1) |
| **TC-37** | **Kueue Batch GPU Quota Admission & Priority Preemption** | Unit / Integration | Simulated | `KueueAdmissionController`, `POST /v1/k8s/kueue/workloads`, `templates/kueue-admission.yaml` | Admits GPU batch workloads within `ClusterQueue` nominal/borrowed quota, suspends excess workloads (`suspend: true`), and admits highest-priority (`inference-realtime-high` > `inference-batch-standard`) pending workload first upon quota release. | `apps/api/tests/unit/kubernetes-scheduler.test.ts`<br>`apps/api/tests/integration/kubernetes-routes.test.ts`<br>`request.rest` (Cycle 9.2–9.5) |
| **TC-38** | **Kyverno Security, Resource Bounds & Tenancy Policy Enforcement** | Unit / Integration | Simulated / Local File Validator | `evaluateKyvernoPolicies`, `validate_manifest_against_kyverno`, `templates/kyverno-policies.yaml` | Enforces `runAsNonRoot: true`, `allowPrivilegeEscalation: false`, `drop: ["ALL"]`, explicit CPU/memory requests & limits, `kueue.x-k8s.io/queue-name` + `suspend: true` on batch GPU jobs, and `platform.ai/tenant` labels. | `tests/unit/test_kubernetes.py`<br>`apps/api/tests/unit/kubernetes-scheduler.test.ts`<br>`request.rest` (Cycle 9.6) |
| **TC-39** | **Prometheus, Grafana K8s Dashboard & Conditional GPU DCGM Exporter Integration** | Unit / Integration | Simulated / Local File Validator | `templates/observability.yaml`, `templates/dcgm-exporter.yaml`, `kubernetes-scheduling.json`, `GET /metrics` | Configures Prometheus scrape targets and `ServiceMonitor`, provisions Grafana dashboard `kubernetes-scheduling.json`, conditionally deploys `dcgm-exporter` DaemonSet on GPU nodes, and exposes `keda_scaler_*`, `kueue_*`, and `kyverno_*` metrics on `/metrics`. | `tests/unit/test_kubernetes.py`<br>`apps/api/tests/integration/kubernetes-routes.test.ts` |

---

## 7. M07 Verification Matrix (AWS Ephemeral Platform, IAM, Two-Path Flyte/SQS & Cost Guardrails)

| ID | Use Case & Description | Level | Execution Mode | Target Component | Expected Behavior & Invariants | Automated Test / Scratchpad |
|---|---|---|---|---|---|---|
| **TC-40** | **Terraform Module & Environment Structural Validation** | Unit | Local File Validator | `infrastructure/terraform/modules/*`, `environments/{ephemeral,production}`, `scripts/validate_terraform.py` | Validates HCL formatting, balanced blocks, required providers, variable/output metadata across all 7 modules (`s3-artifacts`, `sqs-async-queue`, `ecs-fargate-api`, `kinesis-event-stream`, `iam-least-privilege`, `cost-guardrails`, and `eks-cluster`). | `tests/unit/test_aws_terraform.py`<br>`scripts/validate_terraform.py` |
| **TC-41** | **Least-Privilege IAM, ECS Task Role, EKS IRSA & GitHub OIDC Static Analysis** | Unit / Integration | Simulated / Local File Validator | `modules/iam-least-privilege`, `evaluateAwsDeploymentGuardrails`, `POST /v1/cloud/aws/ephemeral/deploy` | Enforces short-lived `sts:AssumeRoleWithWebIdentity` (GitHub OIDC + EKS IRSA), ECS Task execution/task roles, Lambda metering role, prohibits `aws_iam_access_key` and wildcard actions/resources (`*`, `s3:*`, `sqs:*`), and scopes S3 permissions to `${bucket_arn}/tenants/*`. | `tests/unit/test_aws_terraform.py`<br>`apps/api/tests/unit/aws-platform.test.ts`<br>`request.rest` (Cycle 10.4) |
| **TC-42** | **S3 + CloudFront OAC, SQS DLQ, ECS Fargate, Kinesis + Lambda & Two-Path Flyte/TorchScript** | Unit / Integration | Measured CPU / Simulated | `modules/{s3-artifacts,sqs-async-queue,ecs-fargate-api,kinesis-event-stream}`, `POST /v1/cloud/aws/workflows/execute`, `apps/worker/flyte_workflow.py` | Enforces S3 public access blocks, SSE, CloudFront OAC (`PriceClass_100`), SQS DLQ (`maxReceiveCount = 3`), ECS Fargate private task networking, Kinesis `ON_DEMAND` + Lambda metering, `torch.jit.trace` TorchScript backend, and both Path A (`SQS + KEDA`) & Path B (`Flyte + Kueue + Kyverno` 3-stage `CPU -> GPU -> CPU` DAG). | `tests/unit/test_aws_terraform.py`<br>`apps/api/tests/integration/aws-platform-routes.test.ts`<br>`request.rest` (Cycle 10.6–10.7) |
| **TC-43** | **Cost/Budget Guardrails & Zero Permanent GPU/EKS Dependency** | Unit / Integration | Simulated / Local File Validator | `modules/cost-guardrails`, `modules/eks-cluster`, `environments/ephemeral`, `evaluateAwsDeploymentGuardrails` | Defaults `enable_eks = false`, `fargate_desired_count = 0` (`$0.00/hr` fixed cost), and `gpu_min_nodes = 0` (scale-to-zero), configures `aws_budgets_budget` (80% forecasted / 100% actual alerts), and blocks unapproved production apply (`CONFIRM_PRODUCTION_APPLY=yes`). | `tests/unit/test_aws_terraform.py`<br>`apps/api/tests/unit/aws-platform.test.ts`<br>`request.rest` (Cycle 10.1–10.2) |
| **TC-44** | **Ephemeral Deploy/Destroy Workflow & Zero Surviving Resources** | Unit / Integration | Simulated | `ephemeral-lifecycle.sh`, `AwsPlatformController`, `POST /v1/cloud/aws/ephemeral/:runId/destroy`, `GET /metrics` | Provisions ephemeral stack (`18` resources default / `21` with EKS opt-in), transitions to `DESTROYED` on teardown with `surviving_resources = 0` and `post_destroy_hourly_cost_usd = 0.0`, and exposes `aws_ephemeral_*` and `aws_iam_policy_evaluations_total` metrics. | `tests/unit/test_aws_terraform.py`<br>`apps/api/tests/integration/aws-platform-routes.test.ts`<br>`request.rest` (Cycle 10.2–10.5) |
| **TC-45** | **Two-Path Architecture & Media/Text Fixture Verification** | Unit / Integration | Measured CPU / Simulated | `POST /v1/cloud/aws/workflows/execute`, `apps/worker/flyte_workflow.py`, `tests/fixtures/media/*`, `tests/fixtures/text/*` | Exhaustively verifies all 12 media fixtures (PNG/JPEG headers, dimensions, MP4 containers) and text suites (short, multilingual, code/JSON, adversarial, long context), contrasting Path A (single-hop low-latency, fast TorchScript JIT) and Path B (Flyte 3-stage DAG, Kueue GPU admission, Kyverno security context). | `tests/unit/test_two_path_architecture.py`<br>`apps/api/tests/integration/two-path-multi-tenant.test.ts`<br>`request.rest` (Cycle 10.6–10.13) |
| **TC-46** | **Multi-Tenant Capacity, Sandbox Isolation & Quota Arbitration** | Unit / Integration | Measured CPU / Simulated | `apps/worker/flyte_workflow.py`, `POST /v1/cloud/aws/workflows/execute`, `KueueAdmissionController` | Verifies strict tenant artifact sandboxing (`/tenants/{tenant_id}` S3 and CloudFront keys), tenant-partitioned Flyte S3 task memoization caching, independent Kinesis token and microcent billing attribution, and concurrent Kueue GPU quota fair-sharing across tenants. | `tests/unit/test_multi_tenant_capacity.py`<br>`apps/api/tests/integration/two-path-multi-tenant.test.ts`<br>`request.rest` (Cycle 10.6, 10.12–10.13) |
| **TC-47** | **Multi-Engine Inference Benchmark & Transparent Upgrade Verification** | Unit | Measured CPU | `apps/worker/models.py`, `tests/unit/test_engine_benchmarks.py`, `docs/benchmarks/engine-comparison.md` | Benchmarks 2 canonical models (`TinyLlama` and `Llama-3-8B`) under identical conditions across 5 engine targets (NumPy, Eager, TorchScript, PyTorch 2.x compile, Auto-Upgrade). Verifies content SHA-256 fingerprinting, zero-breaking backwards compatibility for legacy TorchScript callers, and automated transparent upgrade to modern compiled execution. | `tests/unit/test_engine_benchmarks.py`<br>`docs/benchmarks/engine-comparison.md` |

---

## 8. M08 Verification Matrix (Provider Routing, Deterministic Policies & Explainability)

| ID | Use Case & Description | Level | Execution Mode | Target Component | Expected Behavior & Invariants | Automated Test / Scratchpad |
|---|---|---|---|---|---|---|
| **TC-48** | **Provider Adapter Parity (Local, RunPod, Bedrock, SageMaker)** | Unit / Contract | Measured CUDA / Mocked Cloud | `LocalPyTorchAdapter`, `RunPodAdapter`, `BedrockAdapter`, `SageMakerAdapter`, `ProviderRegistry` | All 4 adapters implement `InferenceProvider` contracts, produce standard `InferenceResult` with token accounting, TTFT, cost microcents, and `HardwareTelemetry`. Simulates permanent, transient, and capacity errors with structured error codes. | `tests/test_provider_adapters.py`<br>`request.rest` (Cycle 11.1) |
| **TC-49** | **Deterministic Routing Policy: Local Capacity Optimal** | Unit / Integration | Measured Local / Simulated | `evaluateProviderRouting`, `POST /v1/routing/evaluate` | Evaluates local VRAM headroom and queue depth. When queue backlog $< 10$ and VRAM fits, selects `local_pytorch` with explainability trace (`local VRAM available + queue within capacity + margin acceptable -> local GPU worker`). | `tests/test_provider_routing.py`<br>`apps/api/tests/unit/provider-routing.test.ts`<br>`apps/api/tests/integration/provider-routing-routes.test.ts`<br>`request.rest` (Cycle 11.2) |
| **TC-50** | **SLO Risk & VRAM Overflow Spillover to External GPU** | Unit / Integration | Simulated | `evaluateProviderRouting`, `POST /v1/routing/evaluate` | Spills over to external GPU (`runpod` / `sagemaker`) when local queue backlog $\ge 10$ (SLO risk) or model VRAM exceeds local headroom, producing exact explainability: `local queue high + SLO risk + provider available + margin acceptable -> external GPU provider`. | `tests/test_provider_routing.py`<br>`apps/api/tests/unit/provider-routing.test.ts`<br>`apps/api/tests/integration/provider-routing-routes.test.ts`<br>`request.rest` (Cycle 11.3) |
| **TC-51** | **Proprietary Frontier Model (Bedrock) & VPC Enterprise Isolation (SageMaker)** | Unit / Integration | Simulated | `evaluateProviderRouting`, `POST /v1/routing/evaluate` | Proprietary frontier models (`anthropic.claude-3-sonnet`) route exclusively to `bedrock`; workloads requiring customer VPC isolation route to `sagemaker` or `local_pytorch` (filtering out public multi-tenant cloud APIs). | `tests/test_provider_routing.py`<br>`apps/api/tests/unit/provider-routing.test.ts`<br>`apps/api/tests/integration/provider-routing-routes.test.ts`<br>`request.rest` (Cycle 11.4–11.5) |
| **TC-52** | **Target Gross Margin Protection, Simulation Sweep & Chaos Health Toggles** | Unit / Integration | Simulated | `evaluateProviderRouting`, `POST /v1/routing/simulate`, `PATCH /v1/routing/providers/:name/health`, `GET /metrics` | Retains requests on local queue when external cloud providers cannot satisfy target gross margin (e.g. 40%). Simulates queue depth parameter sweeps across $[0, 5, 10, 15, 20]$, supports dynamic provider health toggles, and exposes `provider_routing_*` Prometheus metrics. | `tests/test_provider_routing.py`<br>`apps/api/tests/unit/provider-routing.test.ts`<br>`apps/api/tests/integration/provider-routing-routes.test.ts`<br>`request.rest` (Cycle 11.6–11.7) |

---

## 9. M11 Verification Matrix (Product Dashboard, React Flow & FinOps Economics)

### Detailed Test Matrix

| ID | Use Case & Description | Level | Execution Mode | Target Component | Expected Behavior & Invariants | Automated Test / Scratchpad |
|---|---|---|---|---|---|---|
| **TC-53** | **Job Listing & Status Filter API** | Integration | In-Memory / Simulated | `GET /v1/jobs` | Returns paginated inference jobs for tenant with lifecycle status, progress percentages, latency metrics, and token usage. Filters accurately by status (`SUCCEEDED`, `PROCESSING`, `FAILED`). | `apps/api/tests/integration/analytics-routes.test.ts`<br>`request.rest` (Cycle 14.1–14.2) |
| **TC-54** | **FinOps Usage, Cost & Margin Aggregation** | Integration / Unit | In-Memory / Simulated | `GET /v1/analytics/economics` | Computes token volume, infrastructure compute costs, projected revenue ($0.0004/token), net gross profit, and gross margin percentage. Generates per-provider and per-model financial breakdowns. | `apps/api/tests/integration/analytics-routes.test.ts`<br>`apps/dashboard/tests/economics-calculations.test.ts`<br>`request.rest` (Cycle 14.3) |
| **TC-55** | **Dashboard API Client SDK Parity & Error Boundary** | Unit | Mocked | `PlatformApiClient`, `ApiError` | Formats query parameters, injects tenant headers (`x-tenant-id`), encapsulates HTTP RFC 7807 problem details in `ApiError`, and provides typed wrappers for all control plane endpoints. | `apps/dashboard/tests/api-client.test.ts` |
| **TC-56** | **Deterministic Routing Explainability & Queue Sweep UI** | Unit / Integration | Simulated | `RoutingView`, `POST /v1/routing/evaluate`, `POST /v1/routing/simulate` | Interactive 5-stage explainability ledger rendering passed/rejected criteria (hardware VRAM, VPC isolation, provider health, gross margin). Visualizes queue depth spillover threshold table. | `apps/dashboard/tests/api-client.test.ts`<br>`request.rest` (Cycle 14.6–14.7) |
| **TC-57** | **Interactive Workload Lifecycle Visualization (React Flow)** | Component / Static Check | Vite Build / React Flow | `WorkloadPathView` (`@xyflow/react`) | Renders pannable, zoomable interactive node graph of Two-Path architecture (Path A: SQS+KEDA vs Path B: Flyte+Kueue), displaying component details, protocols, telemetry metrics, and monitored failure modes upon selection. | `apps/dashboard/src/components/flow/WorkloadPathView.tsx`<br>`pnpm --filter @platform/dashboard build` |

---

## 10. Maintenance Rules for Subsequent Milestones

When implementing future milestones (M09–M12):
1. **Update Milestone Status**: Set the milestone status in Section 1 to `In Progress` or `Passed`.
2. **Append Milestone Rows**: Add a new sub-table (`M09 Verification Matrix`, etc.) covering that milestone's test cases.
3. **Strict Execution Labeling**:
   - `Mocked`: In-memory or stubbed responses.
   - `Local Emulated`: Running against local containers (Docker Compose, ElasticMQ, MinIO).
   - `Measured (Live)`: Backed by real hardware execution (e.g. RTX 5070 Ti CUDA tokens/sec or AWS cloud API calls).
4. **CI Requirement**: All automated test cases added to the matrix must execute and pass in `make test` and `make ci`.

