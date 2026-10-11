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

- Entry points: `python3 -m apps.worker.consumer` (`--payload`, `--healthcheck`), `PythonWorkerInferenceExecutor` (`apps/api/src/application/job-worker.ts`), and `python3 benchmarks/run_inference_benchmark.py`.
- Worker & model abstraction: Separated contracts (`apps/worker/contracts.py`), model loading (`apps/worker/models.py`), `InferenceProvider` / `LocalPyTorchAdapter` (`apps/worker/providers/local.py`), artifact handling (`apps/worker/artifacts.py`), and telemetry (`apps/worker/telemetry.py`).
- Execution backends: Supports `PyTorchModelBackend` (`pytorch_cuda` / `pytorch_cpu`) when `torch` is installed and deterministic `NumpyCpuModelBackend` (`numpy_cpu_fallback`) on CPU-only hosts.
- Telemetry & benchmarks: Captures CUDA VRAM (allocated, reserved, peak, total), `nvidia-smi` GPU utilization, and process RSS RAM; generates reproducible cold/warm and concurrency ($c \in \{1,2,4,8\}$) reports (`benchmarks/results/m04_inference_benchmark.{json,md}`) strictly separating `Measured` host results from `Estimated` RTX 5070 Ti targets.
- Verification: 33 Python tests and 44 TypeScript tests (100% line coverage across `domain/` and `application/`), verified via `make ci`.
- Deviations: none.
- Stubs left: external cloud provider adapters (`runpod`, `bedrock`, `sagemaker`) deferred to M08.
