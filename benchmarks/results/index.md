# Inference Benchmark Run Ledger & Multi-Run Comparison Index

This index tracks dated benchmark executions across hardware targets, models, prompt sizes, and provider adapters. Web dashboards (`apps/dashboard`) consume [`manifest.json`](manifest.json) directly to plot comparative latency, throughput, and Pareto cost curves.

## Executed Benchmark Runs (`Measured`)

| Run Date (UTC) | Run ID | Provider | Hardware / Backend | Model (`Precision`) | Prompt Tiers | Warm c=1 p50 (ms) | Warm c=1 TTFT (ms) | Warm c=1 ITL (ms/tok) | Peak Throughput (tok/s) | Unit Cost ($/1M tok) | Artifacts |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `2026-10-11T22:11:44Z` | `2026-10-11T22-11-44Z_local_pytorch_cpu-numpy-cpu-fallback_meta-llama-llama-3-8b-instruct` | `local_pytorch` | `Intel(R) Pentium(R) Gold G7400` (`numpy_cpu_fallback`) | `meta-llama/Llama-3-8B-Instruct` (`fp32`) | `short, medium, long` | 3.38 | 0.14 | 0.103 | **10459.5** | \$5.00 | [Report](runs/2026-10-11T22-11-44Z_local_pytorch_cpu-numpy-cpu-fallback_meta-llama-llama-3-8b-instruct/report.md) · [JSON](runs/2026-10-11T22-11-44Z_local_pytorch_cpu-numpy-cpu-fallback_meta-llama-llama-3-8b-instruct/report.json) |
| `2026-10-11T22:11:43Z` | `2026-10-11T22-11-43Z_local_pytorch_cpu-numpy-cpu-fallback_tinyllama-tinyllama-1-1b-chat-v1-0` | `local_pytorch` | `Intel(R) Pentium(R) Gold G7400` (`numpy_cpu_fallback`) | `TinyLlama/TinyLlama-1.1B-Chat-v1.0` (`fp32`) | `short, medium, long` | 1.58 | 0.10 | 0.047 | **20261.3** | \$2.00 | [Report](runs/2026-10-11T22-11-43Z_local_pytorch_cpu-numpy-cpu-fallback_tinyllama-tinyllama-1-1b-chat-v1-0/report.md) · [JSON](runs/2026-10-11T22-11-43Z_local_pytorch_cpu-numpy-cpu-fallback_tinyllama-tinyllama-1-1b-chat-v1-0/report.json) |

## Web UI & Graph Integration (`manifest.json`)

- **Web Manifest**: [`manifest.json`](manifest.json) exposes `runs[].chart_series.concurrency_scaling_by_prompt_tier` and `runs[].chart_series.prompt_tier_latency_breakdown_c1` for direct charting.
- **JSONL History**: [`history.jsonl`](history.jsonl) provides an append-only stream for CLI/DuckDB analytics.
