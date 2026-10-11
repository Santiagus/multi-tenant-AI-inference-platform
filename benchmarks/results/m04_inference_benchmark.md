# M04 Inference Benchmark & Concurrency Report

This report is generated automatically by [`benchmarks/run_inference_benchmark.py`](../run_inference_benchmark.py) in compliance with `.agents/skills/benchmarking/SKILL.md` and `AGENTS.md` (**Evidence over claims**).

## 1. Environment & Software Metadata (`Measured`)

| Field | Value | Evidence Mode |
|---|---|---|
| **Execution Device** | `Intel(R) Pentium(R) Gold G7400` (`cpu`) | `Measured` |
| **Active Tensor Backend** | `numpy_cpu_fallback` | `Measured` |
| **Logical CPU Cores** | `4` | `Measured` |
| **CUDA Hardware Available** | `False` | `Measured` |
| **Python / NumPy / PyTorch** | Python `3.11.2` · NumPy `1.24.2` · PyTorch `not_installed (numpy_cpu_fallback active)` | `Measured` |
| **Model Identifier** | `meta-llama/Llama-3-8B-Instruct` (`layers=4`, `dim=128`) | `Measured` |
| **Active Tensor Footprint** | `0.5 MiB` | `Measured` |

## 2. Workload & Metric Definitions

- **Prompt**: `Explain the Raft consensus protocol leader election and log replication in multi-tenant distributed AI inference clusters.` (122 chars)
- **Target Output Length**: `32` tokens per request (`temperature=0.7`)
- **Concurrency Sweep**: `[1, 2, 4, 8]` concurrent requests (`8` samples per level)
- **Metrics**:
  - **Latency (`p50`, `p95`, `p99`)**: End-to-end wall-clock execution duration per request in milliseconds (`Measured`).
  - **TTFT (`Mean`)**: Time-To-First-Token across autoregressive forward step 1 in milliseconds (`Measured`).
  - **Aggregate Throughput (`tok/s`)**: Total completion tokens generated across all concurrent workers divided by batch wall-clock time (`Measured`).

## 3. Latency, Throughput & Concurrency Results (`Measured`)

| Scenario | State | Concurrency | Samples | Mean Latency (ms) | p50 (ms) | p95 (ms) | p99 (ms) | Mean TTFT (ms) | Stream (tok/s) | Aggregate Throughput (tok/s) | RAM RSS (MiB) | Mode |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `cold_c1` | `cold` | 1 | 4 | 18.58 | 9.25 | 43.13 | 47.63 | 1.70 | 5104.1 | **1718.9** | 39.1 | `measured` |
| `warm_c1` | `warm` | 1 | 8 | 4.20 | 3.94 | 6.13 | 6.35 | 0.20 | 9707.2 | **7593.6** | 39.1 | `measured` |
| `warm_c2` | `warm` | 2 | 8 | 13.00 | 13.02 | 16.22 | 16.32 | 0.53 | 4850.8 | **4703.4** | 39.4 | `measured` |
| `warm_c4` | `warm` | 4 | 8 | 28.51 | 28.80 | 43.40 | 46.52 | 0.51 | 1977.7 | **4055.5** | 39.6 | `measured` |
| `warm_c8` | `warm` | 8 | 8 | 43.21 | 43.56 | 53.73 | 54.56 | 2.21 | 1794.7 | **3719.6** | 40.0 | `measured` |

## 4. Reference GPU Hardware Targets (`Estimated`)

When executed on CPU-only development hosts, GPU sizing and throughput numbers for full-weight models are explicitly separated and labeled as `Estimated`:

| Target Hardware | Quantization / Model | VRAM Footprint | Single-Stream Throughput | Batch (c=8) Throughput | TTFT (p50) | Evidence Mode |
|---|---|---|---|---|---|---|
| `NVIDIA GeForce RTX 5070 Ti (16 GB GDDR7)` | `meta-llama/Llama-3-8B-Instruct` (4-bit AWQ) | `6.4 GiB` | `95.0 tok/s` | `340.0 tok/s` | `18.5 ms` | `Estimated` |

## 5. Reproducibility Command

```bash
python3 benchmarks/run_inference_benchmark.py --output-dir benchmarks/results
```
