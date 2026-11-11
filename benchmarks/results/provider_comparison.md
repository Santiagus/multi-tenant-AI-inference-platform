# Cross-Provider Same-Job Comparison

- Run ID: `2026-11-11T14-43-39Z_provider_comparison_api`
- Mode: `api`
- Model: `meta-llama/Llama-3-8B-Instruct`
- Prompt tokens (est.): `21` · max_new_tokens: `64`
- Workload: identical canonical prompt across all providers

## Recommendations

| Pick | Provider | Hardware | Warm p50 (ms) | Cold penalty (ms) | Cost $/job | Evidence |
|---|---|---|---:|---:|---:|---|
| cheapest | `local_pytorch` | RTX 5070 Ti | 40.591 | 1.2 | 0.0 | measured |
| fastest | `runpod` | RTX 4090 / H100 | 32.441 | 1.2 | 0.0 | measured |
| balanced | `runpod` | RTX 4090 / H100 | 32.441 | 1.2 | 0.0 | measured |
| recommended | `local_pytorch` | RTX 5070 Ti | 40.591 | 1.2 | 0.0 | measured |

_Picks use warm p50 E2E latency and per-job cost from the identical canonical workload. Cold-start penalty and load p95 are reported for capacity planning. Every figure is labeled measured, estimated, simulated, or provider-reported._

## Provider rollup

| Provider | Cold p50 | Warm p50 | Cold start | Load p95 | tok/s | $/job | $/1M tok | Evidence |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| `local_pytorch` | 164.497 | 40.591 | 1.2 | 51.932 | 500.0 | 0.0 | 0.0 | measured |
| `runpod` | 33.01 | 32.441 | 1.2 | 36.164 | 500.0 | 0.0 | 0.0 | measured |

## Methodology

1. Submit the same prompt + max_new_tokens to each provider.
2. Capture a cold sample, then a warm sample (concurrency=1).
3. Optionally fan-out concurrent warm jobs for load p95.
4. Rank cheapest (min $/job), fastest (min warm p50), balanced (0.5·norm cost + 0.5·norm latency).
5. Label every number as measured, estimated, simulated, or provider-reported.

