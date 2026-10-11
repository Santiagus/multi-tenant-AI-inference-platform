#!/usr/bin/env python3
"""Reproducible latency, throughput, and concurrency benchmark harness for M04.

Follows .agents/skills/benchmarking/SKILL.md:
Every benchmark records:
- hardware/environment
- software/model version
- workload
- concurrency
- duration/sample count
- metric definition
- warm/cold state
- result (explicitly labeled as measured vs estimated)
"""

from __future__ import annotations

import argparse
import asyncio
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import platform
import sys
import time
from typing import Any

import numpy as np  # type: ignore[import-not-found]

try:
    from apps.worker.contracts import InferenceRequest
    from apps.worker.models import ModelLoader
    from apps.worker.providers.local import LocalPyTorchAdapter
    from apps.worker.telemetry import TelemetryCollector
except ModuleNotFoundError:
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    from apps.worker.contracts import InferenceRequest
    from apps.worker.models import ModelLoader
    from apps.worker.providers.local import LocalPyTorchAdapter
    from apps.worker.telemetry import TelemetryCollector


@dataclass(frozen=True)
class ConcurrencyScenarioResult:
    """Recorded metrics for a single concurrency and warm/cold benchmark scenario."""

    scenario_name: str
    warm_state: str  # "cold" | "warm"
    concurrency: int
    sample_count: int
    total_wall_duration_ms: float
    latency_mean_ms: float
    latency_p50_ms: float
    latency_p95_ms: float
    latency_p99_ms: float
    ttft_mean_ms: float
    aggregate_throughput_tokens_per_sec: float
    mean_single_stream_tokens_per_sec: float
    vram_allocated_mb: float
    vram_peak_mb: float
    ram_rss_mb: float
    measurement_type: str  # "measured"

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def compute_percentile(values: list[float], percentile: float) -> float:
    """Compute a percentile from a non-empty list of floats."""
    if not values:
        return 0.0
    arr = np.array(values, dtype=np.float64)
    return round(float(np.percentile(arr, percentile)), 3)


def _execute_single_sync(
    adapter: LocalPyTorchAdapter,
    model_id: str,
    prompt: str,
    max_new_tokens: int,
    idx: int,
) -> tuple[float, float, int, float, float, float]:
    """Run one inference request synchronously inside a worker thread."""
    req = InferenceRequest(
        job_id=f"bench-job-{idx:04d}",
        tenant_id="tenant-benchmark",
        model_id=model_id,
        prompt=prompt,
        parameters={"max_new_tokens": max_new_tokens, "temperature": 0.7},
    )
    t0 = time.perf_counter_ns()
    res = asyncio.run(adapter.predict(req))
    wall_ms = max((time.perf_counter_ns() - t0) / 1_000_000.0, res.usage.compute_duration_ms)
    return (
        round(wall_ms, 3),
        res.usage.time_to_first_token_ms,
        res.usage.completion_tokens,
        res.usage.tokens_per_sec,
        res.telemetry.vram_allocated_mb,
        res.telemetry.vram_peak_mb,
    )


def run_scenario(
    adapter: LocalPyTorchAdapter,
    loader: ModelLoader,
    telemetry: TelemetryCollector,
    model_id: str,
    prompt: str,
    max_new_tokens: int,
    concurrency: int,
    sample_count: int,
    warm_state: str,
) -> ConcurrencyScenarioResult:
    """Execute a benchmark scenario at the specified concurrency level and warm/cold state."""
    if warm_state == "cold":
        loader.clear_cache()
    else:
        loader.load(model_id)

    latencies_ms: list[float] = []
    ttfts_ms: list[float] = []
    stream_tps: list[float] = []
    total_tokens_out = 0
    max_vram_alloc = 0.0
    max_vram_peak = 0.0

    start_wall_ns = time.perf_counter_ns()

    if concurrency <= 1:
        for i in range(sample_count):
            if warm_state == "cold":
                loader.clear_cache()
            wall_ms, ttft_ms, tok_out, tps, v_alloc, v_peak = _execute_single_sync(
                adapter, model_id, prompt, max_new_tokens, i
            )
            latencies_ms.append(wall_ms)
            ttfts_ms.append(ttft_ms)
            stream_tps.append(tps)
            total_tokens_out += tok_out
            max_vram_alloc = max(max_vram_alloc, v_alloc)
            max_vram_peak = max(max_vram_peak, v_peak)
    else:
        with ThreadPoolExecutor(max_workers=concurrency) as pool:
            futures = [
                pool.submit(_execute_single_sync, adapter, model_id, prompt, max_new_tokens, i)
                for i in range(sample_count)
            ]
            for fut in futures:
                wall_ms, ttft_ms, tok_out, tps, v_alloc, v_peak = fut.result()
                latencies_ms.append(wall_ms)
                ttfts_ms.append(ttft_ms)
                stream_tps.append(tps)
                total_tokens_out += tok_out
                max_vram_alloc = max(max_vram_alloc, v_alloc)
                max_vram_peak = max(max_vram_peak, v_peak)

    total_wall_ms = max((time.perf_counter_ns() - start_wall_ns) / 1_000_000.0, 0.1)
    agg_tps = round((total_tokens_out / total_wall_ms) * 1000.0, 2)

    return ConcurrencyScenarioResult(
        scenario_name=f"{warm_state}_c{concurrency}",
        warm_state=warm_state,
        concurrency=concurrency,
        sample_count=sample_count,
        total_wall_duration_ms=round(total_wall_ms, 3),
        latency_mean_ms=round(float(np.mean(latencies_ms)), 3),
        latency_p50_ms=compute_percentile(latencies_ms, 50),
        latency_p95_ms=compute_percentile(latencies_ms, 95),
        latency_p99_ms=compute_percentile(latencies_ms, 99),
        ttft_mean_ms=round(float(np.mean(ttfts_ms)), 3),
        aggregate_throughput_tokens_per_sec=agg_tps,
        mean_single_stream_tokens_per_sec=round(float(np.mean(stream_tps)), 2),
        vram_allocated_mb=round(max_vram_alloc, 2),
        vram_peak_mb=round(max_vram_peak, 2),
        ram_rss_mb=telemetry.get_process_rss_mb(),
        measurement_type="measured",
    )


def run_benchmark_suite(
    model_id: str = "meta-llama/Llama-3-8B-Instruct",
    max_new_tokens: int = 32,
    samples_per_level: int = 8,
    concurrency_levels: list[int] | None = None,
) -> dict[str, Any]:
    """Run the complete cold/warm latency, throughput, and concurrency benchmark suite."""
    levels = concurrency_levels if concurrency_levels is not None else [1, 2, 4, 8]
    telemetry = TelemetryCollector()
    loader = ModelLoader()
    adapter = LocalPyTorchAdapter(model_loader=loader, telemetry_collector=telemetry)

    prompt = (
        "Explain the Raft consensus protocol leader election and log replication "
        "in multi-tenant distributed AI inference clusters."
    )

    loaded, _ = loader.load(model_id)
    initial_hw = telemetry.capture_snapshot(
        active_backend=loaded.backend.backend_name,
        model_footprint_mb=loaded.backend.footprint_mb,
    )

    scenarios: list[ConcurrencyScenarioResult] = []
    # 1. Cold start baseline (concurrency = 1)
    cold_res = run_scenario(
        adapter=adapter,
        loader=loader,
        telemetry=telemetry,
        model_id=model_id,
        prompt=prompt,
        max_new_tokens=max_new_tokens,
        concurrency=1,
        sample_count=max(2, samples_per_level // 2),
        warm_state="cold",
    )
    scenarios.append(cold_res)

    # 2. Warm concurrency sweep (c = 1, 2, 4, 8)
    for c_level in levels:
        warm_res = run_scenario(
            adapter=adapter,
            loader=loader,
            telemetry=telemetry,
            model_id=model_id,
            prompt=prompt,
            max_new_tokens=max_new_tokens,
            concurrency=c_level,
            sample_count=max(c_level, samples_per_level),
            warm_state="warm",
        )
        scenarios.append(warm_res)

    torch_version = "not_installed (numpy_cpu_fallback active)"
    if telemetry.is_torch_available() and telemetry._torch is not None:
        torch_version = str(getattr(telemetry._torch, "__version__", "installed"))

    return {
        "benchmark_id": "m04-inference-benchmark",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "hardware_environment": {
            "device_type": initial_hw.device_type,
            "device_name": initial_hw.device_name,
            "backend": initial_hw.backend,
            "cpu_count_logical": os.cpu_count() or 1,
            "platform": f"{platform.system()} {platform.release()} ({platform.machine()})",
            "cuda_available": telemetry.is_cuda_available(),
            "vram_total_mb": initial_hw.vram_total_mb,
            "measurement_mode": "measured",
        },
        "software_and_model": {
            "python_version": platform.python_version(),
            "numpy_version": str(np.__version__),
            "pytorch_version": torch_version,
            "model_id": model_id,
            "model_spec": {
                "hidden_dim": loaded.spec.hidden_dim,
                "num_layers": loaded.spec.num_layers,
                "vocab_size": loaded.spec.vocab_size,
                "max_context_length": loaded.spec.max_context_length,
                "active_tensor_footprint_mb_measured": loaded.backend.footprint_mb,
                "full_fp16_weights_vram_gb_estimated": loaded.spec.estimated_vram_mb,
            },
        },
        "workload": {
            "prompt": prompt,
            "prompt_length_chars": len(prompt),
            "max_new_tokens": max_new_tokens,
            "temperature": 0.7,
            "concurrency_levels": levels,
            "samples_per_level": samples_per_level,
        },
        "metric_definitions": {
            "latency_p50_ms": "Measured 50th percentile end-to-end request execution latency in milliseconds.",
            "latency_p95_ms": "Measured 95th percentile end-to-end request execution latency in milliseconds.",
            "latency_p99_ms": "Measured 99th percentile end-to-end request execution latency in milliseconds.",
            "ttft_mean_ms": "Measured mean Time-To-First-Token (first autoregressive step) in milliseconds.",
            "aggregate_throughput_tokens_per_sec": "Measured total completion tokens generated divided by total wall-clock batch duration.",
            "reference_gpu_projections": "Estimated reference projections for NVIDIA RTX 5070 Ti (16 GB GDDR7) when running on CPU-only development hosts.",
        },
        "measured_results": [s.to_dict() for s in scenarios],
        "reference_projections_estimated": {
            "target_hardware": "NVIDIA GeForce RTX 5070 Ti (16 GB GDDR7)",
            "measurement_type": "estimated",
            "note": (
                "Estimated reference targets for full 4-bit quantized Llama-3-8B-Instruct "
                "on RTX 5070 Ti CUDA hardware; strictly separated from live measured host results above."
            ),
            "vram_footprint_gb_estimated": 6.4,
            "single_stream_tokens_per_sec_estimated": 95.0,
            "batch_c8_aggregate_tokens_per_sec_estimated": 340.0,
            "ttft_p50_ms_estimated": 18.5,
        },
    }


def render_markdown_report(report: dict[str, Any]) -> str:
    """Format the benchmark dictionary into a reproducible Markdown evidence report."""
    hw = report["hardware_environment"]
    sw = report["software_and_model"]
    wl = report["workload"]
    est = report["reference_projections_estimated"]

    lines = [
        "# M04 Inference Benchmark & Concurrency Report",
        "",
        "This report is generated automatically by [`benchmarks/run_inference_benchmark.py`](../run_inference_benchmark.py) in compliance with `.agents/skills/benchmarking/SKILL.md` and `AGENTS.md` (**Evidence over claims**).",
        "",
        "## 1. Environment & Software Metadata (`Measured`)",
        "",
        "| Field | Value | Evidence Mode |",
        "|---|---|---|",
        f"| **Execution Device** | `{hw['device_name']}` (`{hw['device_type']}`) | `Measured` |",
        f"| **Active Tensor Backend** | `{hw['backend']}` | `Measured` |",
        f"| **Logical CPU Cores** | `{hw['cpu_count_logical']}` | `Measured` |",
        f"| **CUDA Hardware Available** | `{hw['cuda_available']}` | `Measured` |",
        f"| **Python / NumPy / PyTorch** | Python `{sw['python_version']}` · NumPy `{sw['numpy_version']}` · PyTorch `{sw['pytorch_version']}` | `Measured` |",
        f"| **Model Identifier** | `{sw['model_id']}` (`layers={sw['model_spec']['num_layers']}`, `dim={sw['model_spec']['hidden_dim']}`) | `Measured` |",
        f"| **Active Tensor Footprint** | `{sw['model_spec']['active_tensor_footprint_mb_measured']} MiB` | `Measured` |",
        "",
        "## 2. Workload & Metric Definitions",
        "",
        f"- **Prompt**: `{wl['prompt']}` ({wl['prompt_length_chars']} chars)",
        f"- **Target Output Length**: `{wl['max_new_tokens']}` tokens per request (`temperature={wl['temperature']}`)",
        f"- **Concurrency Sweep**: `{wl['concurrency_levels']}` concurrent requests (`{wl['samples_per_level']}` samples per level)",
        "- **Metrics**:",
        "  - **Latency (`p50`, `p95`, `p99`)**: End-to-end wall-clock execution duration per request in milliseconds (`Measured`).",
        "  - **TTFT (`Mean`)**: Time-To-First-Token across autoregressive forward step 1 in milliseconds (`Measured`).",
        "  - **Aggregate Throughput (`tok/s`)**: Total completion tokens generated across all concurrent workers divided by batch wall-clock time (`Measured`).",
        "",
        "## 3. Latency, Throughput & Concurrency Results (`Measured`)",
        "",
        "| Scenario | State | Concurrency | Samples | Mean Latency (ms) | p50 (ms) | p95 (ms) | p99 (ms) | Mean TTFT (ms) | Stream (tok/s) | Aggregate Throughput (tok/s) | RAM RSS (MiB) | Mode |",
        "|---|---|---|---|---|---|---|---|---|---|---|---|---|",
    ]

    for row in report["measured_results"]:
        lines.append(
            f"| `{row['scenario_name']}` | `{row['warm_state']}` | {row['concurrency']} | {row['sample_count']} "
            f"| {row['latency_mean_ms']:.2f} | {row['latency_p50_ms']:.2f} | {row['latency_p95_ms']:.2f} "
            f"| {row['latency_p99_ms']:.2f} | {row['ttft_mean_ms']:.2f} | {row['mean_single_stream_tokens_per_sec']:.1f} "
            f"| **{row['aggregate_throughput_tokens_per_sec']:.1f}** | {row['ram_rss_mb']:.1f} | `{row['measurement_type']}` |"
        )

    lines.extend(
        [
            "",
            "## 4. Reference GPU Hardware Targets (`Estimated`)",
            "",
            "When executed on CPU-only development hosts, GPU sizing and throughput numbers for full-weight models are explicitly separated and labeled as `Estimated`:",
            "",
            "| Target Hardware | Quantization / Model | VRAM Footprint | Single-Stream Throughput | Batch (c=8) Throughput | TTFT (p50) | Evidence Mode |",
            "|---|---|---|---|---|---|---|",
            f"| `{est['target_hardware']}` | `{sw['model_id']}` (4-bit AWQ) | `{est['vram_footprint_gb_estimated']} GiB` | `{est['single_stream_tokens_per_sec_estimated']} tok/s` | `{est['batch_c8_aggregate_tokens_per_sec_estimated']} tok/s` | `{est['ttft_p50_ms_estimated']} ms` | `Estimated` |",
            "",
            "## 5. Reproducibility Command",
            "",
            "```bash",
            "python3 benchmarks/run_inference_benchmark.py --output-dir benchmarks/results",
            "```",
            "",
        ]
    )
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run reproducible M04 inference benchmark suite.")
    parser.add_argument(
        "--model-id",
        type=str,
        default="meta-llama/Llama-3-8B-Instruct",
        help="Model identifier to benchmark.",
    )
    parser.add_argument(
        "--max-new-tokens",
        type=int,
        default=32,
        help="Number of tokens to generate per request.",
    )
    parser.add_argument(
        "--samples",
        type=int,
        default=8,
        help="Number of samples per concurrency level.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("benchmarks/results"),
        help="Directory to write JSON and Markdown benchmark artifacts.",
    )
    args = parser.parse_args(argv)

    report = run_benchmark_suite(
        model_id=args.model_id,
        max_new_tokens=args.max_new_tokens,
        samples_per_level=args.samples,
    )

    args.output_dir.mkdir(parents=True, exist_ok=True)
    json_path = args.output_dir / "m04_inference_benchmark.json"
    md_path = args.output_dir / "m04_inference_benchmark.md"

    json_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    md_path.write_text(render_markdown_report(report), encoding="utf-8")

    print(f"Benchmark complete. Wrote {json_path} and {md_path}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
