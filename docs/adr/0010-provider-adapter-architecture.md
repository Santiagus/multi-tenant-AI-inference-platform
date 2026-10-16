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

## Evidence & Routing Validation

In compliance with `AGENTS.md` (**Evidence over claims**), the adapter separation and dynamic policy routing are backed by empirical benchmark findings in [`benchmarks/results/index.md`](../../benchmarks/results/index.md):

1. **Prompt-Tier Routing Matrix**:
   - **Short Prompts ($\le 64$ tokens)**: Decode-bound workloads routed to `local_pytorch` (RTX 5070 Ti) achieve lowest TTFT ($0.44\text{--}0.73\text{ ms}$) and eliminate cloud API round-trip latency.
   - **Medium Prompts ($65\text{--}256$ tokens)**: Balanced workloads remain on `local_pytorch` up to concurrency $c=4$, maintaining $<15\text{ ms}$ latency and near-zero marginal electricity cost ($\$0.003\text{--}\$0.005$ per 1M tokens).
   - **Long Prompts ($257+$ tokens)**: Prefill- and KV-cache-bound RAG workloads rapidly saturate 16 GB local VRAM. The routing policy overflows these requests to 80 GB cloud GPUs (`runpod` or `sagemaker`), preventing local CUDA out-of-memory faults while maintaining SLA compliance.
2. **Provider Contract Parity**:
   - Both local workers (`apps/worker/providers/local.py`) and cloud adapters implement the exact `InferenceProvider` interface ([`apps/worker/providers/base.py`](../../apps/worker/providers/base.py)), ensuring identical OpenTelemetry trace attributes and billing metrics across all backends.

