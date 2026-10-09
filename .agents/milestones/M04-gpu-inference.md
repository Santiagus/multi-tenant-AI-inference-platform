# M04 — GPU Inference

Depends on: M03 | Read: `.agents/skills/python-inference/SKILL.md`, `.agents/skills/benchmarking/SKILL.md`

## Objective

Introduce a real inference workload and establish reproducible performance evidence.

## Deliverables

- Python/PyTorch inference worker;
- model abstraction;
- CPU-compatible fallback and GPU execution path;
- latency/throughput benchmark;
- concurrency experiment;
- VRAM/utilization telemetry where hardware permits.

Hardware: never block on GPU availability. Use CPU/small/free compute for functional work; run GPU benchmarks when suitable hardware is available.

## Acceptance criteria

Benchmark methodology is reproducible and clearly labels measured versus estimated results.

## Out of scope

Kubernetes GPU scheduling, provider escalation.

## Outcome

_Pending._
