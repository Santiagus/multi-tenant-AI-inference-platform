# ADR-0010: Encapsulate Cloud and Local Execution Behind Provider Adapters

- **Status**: Accepted
- **Date**: 2026-10-09
- **Deciders**: Architecture Team

---

## Context & Problem Statement

Modern AI inference workloads vary widely in execution characteristics. Some workloads are best served on local hardware (e.g. low-latency token generation on an RTX 5070 Ti or dedicated on-premise nodes), while bursty or proprietary model workloads require cloud platforms (AWS Bedrock, AWS SageMaker, or RunPod Serverless). Coupling application logic or API handlers to specific cloud provider SDKs creates vendor lock-in, complicates testing, and breaks local offline reproducibility.

## Decision Drivers

- Rule from `AGENTS.md`: "Provider-agnostic core. Business logic depends on provider interfaces (local, RunPod, Bedrock, SageMaker, …), never on a concrete provider."
- Local execution and cloud execution must share identical business contracts and telemetry schemas.
- Need for dynamic routing policies (cost-optimized, latency-optimized, privacy-constrained).
- Testability: ability to mock or record/replay cloud providers in offline development and CI.

## Considered Options

1. **Hexagonal Architecture: Uniform `InferenceProvider` port with concrete adapters (`LocalPyTorchAdapter`, `RunPodAdapter`, `BedrockAdapter`, `SageMakerAdapter`)**
2. **Direct vendor SDK calls in API route handlers**
3. **External proxy gateway (e.g., LiteLLM / Portkey) as a mandatory dependency**

## Decision Outcome

**Chosen option: Uniform `InferenceProvider` port with concrete adapters**.

### Rationale

- **Loose Coupling**: The core platform (API, queue consumers, state machine, billing ledger) operates solely in terms of `InferenceRequest` and `InferenceResult`.
- **Interchangeable Execution**: Switching from local PyTorch to RunPod or Bedrock requires only a routing policy change, with zero changes to client contracts or data schemas.
- **Offline Parity**: Mock adapters allow complete end-to-end testing and performance pipeline validation in CI without AWS credentials or cloud API spend.
- **Extensibility**: Adding new backends (e.g., vLLM, TensorRT-LLM, Cloudflare Workers AI) requires writing a single isolated adapter class without touching core business logic.

## Consequences

- **Positive**:
  - Freedom from cloud provider lock-in.
  - High unit and contract test coverage with reproducible mock adapters.
  - Unified per-tenant cost attribution and OpenTelemetry instrumentation across all backends.
- **Negative / Trade-offs**:
  - Minor translation overhead when mapping provider-specific response formats into the platform standard `InferenceResult`.

