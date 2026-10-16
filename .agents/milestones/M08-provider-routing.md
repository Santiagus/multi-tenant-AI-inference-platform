# M08 — Provider Routing

Depends on: M04, M05 | Read: `.agents/skills/python-inference/SKILL.md` (if applicable), `.agents/skills/observability/SKILL.md`

## Objective

Route workloads between local and external inference providers using measurable constraints.

## Deliverables

- provider adapters: local, RunPod, Bedrock, SageMaker (mocks where credentials/cost make live testing inappropriate);
- deterministic routing policy over: workload/model requirements, VRAM/capacity, queue depth, latency SLO, provider availability, tenant policy, estimated cost, target gross margin.

## Acceptance criteria

Routing decisions are observable and explainable, e.g.
`local queue high + SLO risk + provider available + margin acceptable → external GPU provider`.

## Outcome

- Entry points: `python3 scripts/setup_providers.py --check`, `python3 -m apps.worker.consumer --healthcheck`, and `POST /v1/routing/evaluate`.
- Provider adapters: Implemented `InferenceProvider` contracts in `apps/worker/providers/` (`LocalPyTorchAdapter`, `RunPodAdapter`, `BedrockAdapter`, `SageMakerAdapter`) and `ProviderRegistry`.
- Deterministic routing engine: `evaluateProviderRouting` in `apps/api/src/domain/provider-routing.ts` and `apps/worker/routing.py` with explainability traces over VRAM, queue depth, SLO, health, tenant policy, and gross margin.
- Telemetry & metrics: Exposed `/v1/routing/providers`, `/v1/routing/evaluate`, `/v1/routing/simulate` with OpenTelemetry spans and Prometheus counters/gauges (`provider_routing_*`).
- Setup & automation: Documented `docs/operations/provider-setup.md` and automated diagnostic/env generator `scripts/setup_providers.py`.
- Verification: 19 TypeScript tests (100% domain coverage), 16 Python tests across adapters and routing, verified via `make ci`.
- Deviations from spec: None.
- Stubs left: Multi-tenant ABAC database policies deferred to M09.

