# Cross-Provider Same-Job Comparison

- Run ID: `2026-11-11T14-43-33Z_provider_comparison_simulate`
- Mode: `simulate`
- Model: `meta-llama/Llama-3-8B-Instruct`
- Prompt tokens (est.): `21` · max_new_tokens: `64`
- Workload: identical canonical prompt across all providers

## Recommendations

| Pick | Provider | Hardware | Warm p50 (ms) | Cold penalty (ms) | Cost $/job | Evidence |
|---|---|---|---:|---:|---:|---|
| cheapest | `local_pytorch` | RTX 5070 Ti | 103.0 | 320.0 | 0.0 | simulated |
| fastest | `local_pytorch` | RTX 5070 Ti | 103.0 | 320.0 | 0.0 | simulated |
| balanced | `local_pytorch` | RTX 5070 Ti | 103.0 | 320.0 | 0.0 | simulated |
| recommended | `local_pytorch` | RTX 5070 Ti | 103.0 | 320.0 | 0.0 | simulated |

_Picks use warm p50 E2E latency and per-job cost from the identical canonical workload. Cold-start penalty and load p95 are reported for capacity planning. Every figure is labeled measured, estimated, simulated, or provider-reported._

## Provider rollup

| Provider | Cold p50 | Warm p50 | Cold start | Load p95 | tok/s | $/job | $/1M tok | Evidence |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| `local_pytorch` | 445.0 | 103.0 | 320.0 | 161.2 | 105.0 | 0.0 | 0.0 | simulated |
| `runpod` | 2425.0 | 388.0 | 1800.0 | 548.8 | 110.0 | 3.589e-05 | 0.422235 | simulated |
| `bedrock` | 545.0 | 418.0 | 40.0 | 589.6 | 85.0 | 0.0001023 | 1.203529 | simulated |
| `vast_ai` | 2825.0 | 328.0 | 2200.0 | 467.2 | 135.0 | 2.133e-05 | 0.250941 | simulated |
| `baseten` | 1925.0 | 748.0 | 1100.0 | 1038.4 | 32.0 | 0.00017472 | 2.055529 | simulated |

## Methodology

1. Submit the same prompt + max_new_tokens to each provider.
2. Capture a cold sample, then a warm sample (concurrency=1).
3. Optionally fan-out concurrent warm jobs for load p95.
4. Rank cheapest (min $/job), fastest (min warm p50), balanced (0.5·norm cost + 0.5·norm latency).
5. Label every number as measured, estimated, simulated, or provider-reported.

