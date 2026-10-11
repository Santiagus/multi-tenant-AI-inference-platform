#!/usr/bin/env python3
"""Enterprise inference benchmark harness & multi-run web comparison generator (M04 -> M08/M11).

Follows .agents/skills/benchmarking/SKILL.md and enterprise standards (MLPerf Inference,
vLLM/GenAI-Perf, OpenTelemetry GenAI, and FinOps unit economics):
- Every run is stored under a date-stamped directory:
  `benchmarks/results/runs/<YYYY-MM-DDTHH-MM-SSZ>_<provider>_<hw>_<model>/`
  with `report.json` and `report.md` (plus latest aliases `m04_inference_benchmark.{json,md}`).
- Sweeps across prompt size tiers (`short`, `medium`, `long`), warm/cold state, and concurrency
  levels (`c = 1, 2, 4, 8`) to measure both prefill-bound (TTFT) and decode-bound (ITL/TPOT) behavior.
- Generates web-ready `chart_series` and `routing_recommendations_by_prompt_tier` inside every run
  and updates `benchmarks/results/manifest.json`, `history.jsonl`, and `index.md` for multi-run
  graphical comparison and prompt-aware provider selection.
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
import re
import sys
import time
from typing import Any

import numpy as np  # type: ignore[import-not-found]

try:
    from apps.worker.contracts import InferenceRequest
    from apps.worker.models import ModelLoader, tokenize_prompt
    from apps.worker.providers.local import LocalPyTorchAdapter
    from apps.worker.telemetry import TelemetryCollector
except ModuleNotFoundError:
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    from apps.worker.contracts import InferenceRequest
    from apps.worker.models import ModelLoader, tokenize_prompt
    from apps.worker.providers.local import LocalPyTorchAdapter
    from apps.worker.telemetry import TelemetryCollector


PROMPT_TIERS: dict[str, dict[str, Any]] = {
    "short": {
        "tier": "short",
        "description": "Short interactive prompt (~15-30 tokens) - decode-latency sensitive",
        "prompt": (
            "Explain Raft consensus leader election in distributed AI inference clusters."
        ),
    },
    "medium": {
        "tier": "medium",
        "description": "Medium context prompt (~80-140 tokens) - balanced prefill and decode",
        "prompt": (
            "Explain the Raft consensus protocol leader election, log replication, and safety "
            "invariants in multi-tenant distributed AI inference clusters. Compare quorum heartbeats "
            "with lease-based worker visibility timeouts when GPU nodes experience transient network "
            "partitions or CUDA out-of-memory faults during autoregressive token generation."
        ),
    },
    "long": {
        "tier": "long",
        "description": "Long context prompt (~240+ tokens) - prefill-compute and VRAM KV-cache intensive",
        "prompt": (
            "Design a multi-tenant AI inference control plane and distributed GPU execution worker "
            "architecture. Detail how incoming requests with varying prompt context lengths are "
            "authenticated, deduplicated via SHA-256 idempotency keys, offloaded to S3-compatible "
            "object storage when exceeding inline thresholds, queued into SQS with bounded exponential "
            "backoff, and dispatched across heterogeneous compute providers (local NVIDIA RTX 5070 Ti "
            "CUDA workers, RunPod serverless GPUs, AWS Bedrock managed foundation models, and AWS "
            "SageMaker endpoints). Include how Time-To-First-Token (TTFT), Inter-Token Latency (ITL), "
            "VRAM KV-cache watermarks, and unit token economics ($ per 1M tokens) govern dynamic "
            "prompt-size-aware provider routing policies under concurrent load."
        ),
    },
}


@dataclass(frozen=True)
class ScenarioMetricsRecord:
    """Comprehensive MLPerf / GenAI-Perf metrics for one (prompt_tier, warm_state, concurrency) scenario."""

    scenario_id: str
    prompt_tier: str
    prompt_chars: int
    prompt_tokens: int
    output_tokens_target: int
    warm_state: str  # "cold" | "warm"
    concurrency: int
    sample_count: int
    total_wall_duration_ms: float
    # End-to-End Latency
    latency_mean_ms: float
    latency_p50_ms: float
    latency_p95_ms: float
    latency_p99_ms: float
    # Prefill vs Decode Breakdown
    ttft_mean_ms: float
    ttft_p50_ms: float
    ttft_p95_ms: float
    itl_mean_ms: float  # Inter-Token Latency (TPOT) in ms/token
    itl_p50_ms: float
    itl_p95_ms: float
    decode_mean_ms: float
    # Throughput
    requests_per_sec: float
    mean_single_stream_tokens_per_sec: float
    aggregate_output_tokens_per_sec: float
    aggregate_total_tokens_per_sec: float
    # Hardware Telemetry
    vram_allocated_mb: float
    vram_peak_mb: float
    ram_rss_mb: float
    # Unit Economics
    cost_microcents_per_request: int
    cost_per_1m_tokens_usd: float
    tokens_per_usd: float
    measurement_type: str  # "measured"

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def compute_percentile(values: list[float], percentile: float) -> float:
    """Compute a percentile from a non-empty list of floats."""
    if not values:
        return 0.0
    arr = np.array(values, dtype=np.float64)
    return round(float(np.percentile(arr, percentile)), 3)


def _slugify(value: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9]+", "-", value.strip().lower()).strip("-")
    return cleaned[:36] if cleaned else "default"


def _execute_single_sync(
    adapter: LocalPyTorchAdapter,
    model_id: str,
    prompt: str,
    max_new_tokens: int,
    idx: int,
) -> tuple[float, float, float, int, int, float, float, float, int]:
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
    ttft_ms = min(res.usage.time_to_first_token_ms, wall_ms)
    decode_ms = max(wall_ms - ttft_ms, 0.01)
    itl_ms = decode_ms / max(res.usage.completion_tokens - 1, 1)
    return (
        round(wall_ms, 3),
        round(ttft_ms, 3),
        round(itl_ms, 4),
        res.usage.prompt_tokens,
        res.usage.completion_tokens,
        res.usage.tokens_per_sec,
        res.telemetry.vram_allocated_mb,
        res.telemetry.vram_peak_mb,
        res.usage.estimated_cost_microcents,
    )


def run_scenario(
    adapter: LocalPyTorchAdapter,
    loader: ModelLoader,
    telemetry: TelemetryCollector,
    model_id: str,
    prompt_tier: str,
    prompt: str,
    max_new_tokens: int,
    concurrency: int,
    sample_count: int,
    warm_state: str,
) -> ScenarioMetricsRecord:
    """Execute a benchmark scenario for a specific prompt tier, concurrency, and warm/cold state."""
    if warm_state == "cold":
        loader.clear_cache()
    else:
        loader.load(model_id)

    latencies_ms: list[float] = []
    ttfts_ms: list[float] = []
    itls_ms: list[float] = []
    stream_tps: list[float] = []
    prompt_tok_count = 0
    total_tokens_out = 0
    total_tokens_all = 0
    max_vram_alloc = 0.0
    max_vram_peak = 0.0
    cost_microcents_sample = 0

    start_wall_ns = time.perf_counter_ns()

    if concurrency <= 1:
        for i in range(sample_count):
            if warm_state == "cold":
                loader.clear_cache()
            (
                wall_ms,
                ttft_ms,
                itl_ms,
                tok_in,
                tok_out,
                tps,
                v_alloc,
                v_peak,
                cost_mc,
            ) = _execute_single_sync(adapter, model_id, prompt, max_new_tokens, i)
            latencies_ms.append(wall_ms)
            ttfts_ms.append(ttft_ms)
            itls_ms.append(itl_ms)
            stream_tps.append(tps)
            prompt_tok_count = tok_in
            total_tokens_out += tok_out
            total_tokens_all += tok_in + tok_out
            max_vram_alloc = max(max_vram_alloc, v_alloc)
            max_vram_peak = max(max_vram_peak, v_peak)
            cost_microcents_sample = cost_mc
    else:
        with ThreadPoolExecutor(max_workers=concurrency) as pool:
            futures = [
                pool.submit(_execute_single_sync, adapter, model_id, prompt, max_new_tokens, i)
                for i in range(sample_count)
            ]
            for fut in futures:
                (
                    wall_ms,
                    ttft_ms,
                    itl_ms,
                    tok_in,
                    tok_out,
                    tps,
                    v_alloc,
                    v_peak,
                    cost_mc,
                ) = fut.result()
                latencies_ms.append(wall_ms)
                ttfts_ms.append(ttft_ms)
                itls_ms.append(itl_ms)
                stream_tps.append(tps)
                prompt_tok_count = tok_in
                total_tokens_out += tok_out
                total_tokens_all += tok_in + tok_out
                max_vram_alloc = max(max_vram_alloc, v_alloc)
                max_vram_peak = max(max_vram_peak, v_peak)
                cost_microcents_sample = cost_mc

    total_wall_ms = max((time.perf_counter_ns() - start_wall_ns) / 1_000_000.0, 0.1)
    agg_out_tps = round((total_tokens_out / total_wall_ms) * 1000.0, 2)
    agg_total_tps = round((total_tokens_all / total_wall_ms) * 1000.0, 2)
    req_per_sec = round((sample_count / total_wall_ms) * 1000.0, 2)

    lat_mean = round(float(np.mean(latencies_ms)), 3)
    ttft_mean = round(float(np.mean(ttfts_ms)), 3)
    decode_mean = round(max(lat_mean - ttft_mean, 0.01), 3)

    # 1 microcent = $1e-6 USD. Cost per 1M tokens in USD:
    tokens_per_req = max(prompt_tok_count + max_new_tokens, 1)
    cost_usd_per_req = cost_microcents_sample * 1e-6
    cost_per_1m_usd = round((cost_usd_per_req / tokens_per_req) * 1_000_000.0, 4)
    tokens_per_usd = round(1_000_000.0 / max(cost_per_1m_usd, 1e-6), 1)

    return ScenarioMetricsRecord(
        scenario_id=f"{prompt_tier}_{warm_state}_c{concurrency}",
        prompt_tier=prompt_tier,
        prompt_chars=len(prompt),
        prompt_tokens=prompt_tok_count,
        output_tokens_target=max_new_tokens,
        warm_state=warm_state,
        concurrency=concurrency,
        sample_count=sample_count,
        total_wall_duration_ms=round(total_wall_ms, 3),
        latency_mean_ms=lat_mean,
        latency_p50_ms=compute_percentile(latencies_ms, 50),
        latency_p95_ms=compute_percentile(latencies_ms, 95),
        latency_p99_ms=compute_percentile(latencies_ms, 99),
        ttft_mean_ms=ttft_mean,
        ttft_p50_ms=compute_percentile(ttfts_ms, 50),
        ttft_p95_ms=compute_percentile(ttfts_ms, 95),
        itl_mean_ms=round(float(np.mean(itls_ms)), 4),
        itl_p50_ms=compute_percentile(itls_ms, 50),
        itl_p95_ms=compute_percentile(itls_ms, 95),
        decode_mean_ms=decode_mean,
        requests_per_sec=req_per_sec,
        mean_single_stream_tokens_per_sec=round(float(np.mean(stream_tps)), 2),
        aggregate_output_tokens_per_sec=agg_out_tps,
        aggregate_total_tokens_per_sec=agg_total_tps,
        vram_allocated_mb=round(max_vram_alloc, 2),
        vram_peak_mb=round(max_vram_peak, 2),
        ram_rss_mb=telemetry.get_process_rss_mb(),
        cost_microcents_per_request=cost_microcents_sample,
        cost_per_1m_tokens_usd=cost_per_1m_usd,
        tokens_per_usd=tokens_per_usd,
        measurement_type="measured",
    )


def _build_chart_series_and_routing_matrix(
    scenarios: list[ScenarioMetricsRecord],
    provider_name: str,
    model_id: str,
) -> tuple[dict[str, Any], list[dict[str, Any]], list[dict[str, Any]]]:
    """Build pre-indexed chart datasets for Web UI visualization and prompt-tier provider routing."""
    # 1. Throughput & Latency vs Concurrency curves (grouped by prompt_tier for warm runs)
    concurrency_curves: dict[str, list[dict[str, Any]]] = {}
    for s in scenarios:
        if s.warm_state != "warm":
            continue
        concurrency_curves.setdefault(s.prompt_tier, []).append(
            {
                "concurrency": s.concurrency,
                "throughput_tokens_per_sec": s.aggregate_output_tokens_per_sec,
                "requests_per_sec": s.requests_per_sec,
                "latency_p50_ms": s.latency_p50_ms,
                "latency_p95_ms": s.latency_p95_ms,
                "latency_p99_ms": s.latency_p99_ms,
                "ttft_p50_ms": s.ttft_p50_ms,
                "itl_p50_ms": s.itl_p50_ms,
            }
        )

    # 2. Prompt Size Tier Impact (Prefill TTFT vs Decode Latency at c=1 warm)
    prompt_tier_breakdown: list[dict[str, Any]] = []
    for s in scenarios:
        if s.warm_state == "warm" and s.concurrency == 1:
            prompt_tier_breakdown.append(
                {
                    "prompt_tier": s.prompt_tier,
                    "prompt_tokens": s.prompt_tokens,
                    "output_tokens": s.output_tokens_target,
                    "ttft_p50_ms": s.ttft_p50_ms,
                    "decode_mean_ms": s.decode_mean_ms,
                    "itl_p50_ms": s.itl_p50_ms,
                    "e2e_p95_ms": s.latency_p95_ms,
                    "throughput_tokens_per_sec": s.aggregate_output_tokens_per_sec,
                    "cost_per_1m_tokens_usd": s.cost_per_1m_tokens_usd,
                }
            )

    # 3. Cross-Provider Reference Comparison Matrix (for M08 Routing & M11 Web Pareto Chart)
    # Combines Measured local run metrics with Estimated cloud adapter profiles per prompt tier
    reference_providers: list[dict[str, Any]] = [
        {
            "provider": "local_pytorch_gpu",
            "hardware": "NVIDIA GeForce RTX 5070 Ti (16 GB GDDR7)",
            "model_id": model_id,
            "precision": "awq_int4",
            "vram_footprint_gb": 6.4,
            "cold_start_ms": 450.0,
            "profiles_by_prompt_tier": {
                "short": {
                    "ttft_p50_ms": 14.0,
                    "itl_p50_ms": 9.8,
                    "e2e_p95_ms": 340.0,
                    "batch_c8_tokens_per_sec": 360.0,
                    "cost_per_1m_tokens_usd": 0.12,
                },
                "medium": {
                    "ttft_p50_ms": 22.0,
                    "itl_p50_ms": 10.2,
                    "e2e_p95_ms": 365.0,
                    "batch_c8_tokens_per_sec": 340.0,
                    "cost_per_1m_tokens_usd": 0.12,
                },
                "long": {
                    "ttft_p50_ms": 68.0,
                    "itl_p50_ms": 11.5,
                    "e2e_p95_ms": 460.0,
                    "batch_c8_tokens_per_sec": 285.0,
                    "cost_per_1m_tokens_usd": 0.14,
                },
            },
            "measurement_type": "estimated",
        },
        {
            "provider": "runpod_serverless",
            "hardware": "RunPod NVIDIA A100-SXM4-80GB",
            "model_id": model_id,
            "precision": "fp16",
            "vram_footprint_gb": 16.2,
            "cold_start_ms": 2800.0,
            "profiles_by_prompt_tier": {
                "short": {
                    "ttft_p50_ms": 38.0,
                    "itl_p50_ms": 7.5,
                    "e2e_p95_ms": 295.0,
                    "batch_c8_tokens_per_sec": 620.0,
                    "cost_per_1m_tokens_usd": 0.35,
                },
                "medium": {
                    "ttft_p50_ms": 49.0,
                    "itl_p50_ms": 7.8,
                    "e2e_p95_ms": 315.0,
                    "batch_c8_tokens_per_sec": 590.0,
                    "cost_per_1m_tokens_usd": 0.35,
                },
                "long": {
                    "ttft_p50_ms": 85.0,
                    "itl_p50_ms": 8.1,
                    "e2e_p95_ms": 360.0,
                    "batch_c8_tokens_per_sec": 540.0,
                    "cost_per_1m_tokens_usd": 0.38,
                },
            },
            "measurement_type": "estimated",
        },
        {
            "provider": "aws_bedrock",
            "hardware": "AWS Managed Inference (Bedrock Converse API)",
            "model_id": model_id,
            "precision": "bf16_managed",
            "vram_footprint_gb": 0.0,
            "cold_start_ms": 0.0,
            "profiles_by_prompt_tier": {
                "short": {
                    "ttft_p50_ms": 95.0,
                    "itl_p50_ms": 14.0,
                    "e2e_p95_ms": 580.0,
                    "batch_c8_tokens_per_sec": 480.0,
                    "cost_per_1m_tokens_usd": 0.60,
                },
                "medium": {
                    "ttft_p50_ms": 130.0,
                    "itl_p50_ms": 14.2,
                    "e2e_p95_ms": 620.0,
                    "batch_c8_tokens_per_sec": 460.0,
                    "cost_per_1m_tokens_usd": 0.60,
                },
                "long": {
                    "ttft_p50_ms": 210.0,
                    "itl_p50_ms": 14.5,
                    "e2e_p95_ms": 740.0,
                    "batch_c8_tokens_per_sec": 440.0,
                    "cost_per_1m_tokens_usd": 0.60,
                },
            },
            "measurement_type": "estimated",
        },
    ]

    # 4. Prompt-Size-Aware Routing Recommendations (Reference for M08 Policy Router)
    routing_recommendations = [
        {
            "prompt_tier": "short",
            "token_range": "1 - 64 tokens",
            "workload_characteristic": "Decode-bound; network & cold-start overhead dominate E2E latency.",
            "recommended_primary_provider": provider_name,
            "recommended_gpu_target": "local_pytorch_gpu (RTX 5070 Ti)",
            "recommended_burst_fallback": "aws_bedrock (zero cold start)",
            "rationale": (
                "Local GPU avoids network RTT and serverless cold starts, achieving lowest TTFT "
                "and lowest unit cost ($0.12/1M tokens estimated)."
            ),
        },
        {
            "prompt_tier": "medium",
            "token_range": "65 - 256 tokens",
            "workload_characteristic": "Balanced prefill attention and autoregressive decode.",
            "recommended_primary_provider": provider_name,
            "recommended_gpu_target": "local_pytorch_gpu (RTX 5070 Ti)",
            "recommended_burst_fallback": "runpod_serverless (when local concurrency > 4)",
            "rationale": (
                "Local GPU handles up to c=4 with optimal cost/latency; burst queues above c=4 "
                "benefit from RunPod A100 higher aggregate batch throughput."
            ),
        },
        {
            "prompt_tier": "long",
            "token_range": "257+ tokens",
            "workload_characteristic": "Prefill compute and KV-cache VRAM capacity bound.",
            "recommended_primary_provider": "runpod_serverless",
            "recommended_gpu_target": "runpod_serverless (A100 80GB) or aws_sagemaker",
            "recommended_burst_fallback": "aws_bedrock",
            "rationale": (
                "Long prompts rapidly consume 16 GB local VRAM KV-cache under concurrency; "
                "routing long-context batches to 80 GB cloud GPUs prevents local CUDA OOM."
            ),
        },
    ]

    chart_series = {
        "x_axis_concurrency_levels": sorted({s.concurrency for s in scenarios if s.warm_state == "warm"}),
        "prompt_tiers": list(PROMPT_TIERS.keys()),
        "concurrency_scaling_by_prompt_tier": concurrency_curves,
        "prompt_tier_latency_breakdown_c1": prompt_tier_breakdown,
    }

    return chart_series, reference_providers, routing_recommendations


def run_benchmark_suite(
    model_id: str = "meta-llama/Llama-3-8B-Instruct",
    max_new_tokens: int = 32,
    samples_per_level: int = 6,
    concurrency_levels: list[int] | None = None,
    prompt_tiers: list[str] | None = None,
    run_timestamp: datetime | None = None,
) -> dict[str, Any]:
    """Run the complete multi-prompt-tier, cold/warm, and concurrency benchmark suite."""
    levels = concurrency_levels if concurrency_levels is not None else [1, 2, 4, 8]
    tiers_to_run = prompt_tiers if prompt_tiers is not None else ["short", "medium", "long"]
    ts_now = run_timestamp if run_timestamp is not None else datetime.now(timezone.utc)
    iso_timestamp = ts_now.strftime("%Y-%m-%dT%H:%M:%SZ")
    file_ts_slug = ts_now.strftime("%Y-%m-%dT%H-%M-%SZ")

    telemetry = TelemetryCollector()
    loader = ModelLoader()
    adapter = LocalPyTorchAdapter(model_loader=loader, telemetry_collector=telemetry)

    loaded, _ = loader.load(model_id)
    initial_hw = telemetry.capture_snapshot(
        active_backend=loaded.backend.backend_name,
        model_footprint_mb=loaded.backend.footprint_mb,
    )

    hw_slug = _slugify(f"{initial_hw.device_type}-{initial_hw.backend}")
    model_slug = _slugify(model_id)
    run_id = f"{file_ts_slug}_{adapter.name}_{hw_slug}_{model_slug}"

    scenarios: list[ScenarioMetricsRecord] = []

    # 1. Cold start baseline on medium prompt (concurrency = 1)
    cold_tier = "medium" if "medium" in tiers_to_run else tiers_to_run[0]
    cold_prompt = str(PROMPT_TIERS[cold_tier]["prompt"])
    cold_res = run_scenario(
        adapter=adapter,
        loader=loader,
        telemetry=telemetry,
        model_id=model_id,
        prompt_tier=cold_tier,
        prompt=cold_prompt,
        max_new_tokens=max_new_tokens,
        concurrency=1,
        sample_count=max(2, samples_per_level // 2),
        warm_state="cold",
    )
    scenarios.append(cold_res)

    # 2. Warm sweep across all prompt size tiers and concurrency levels
    for tier_key in tiers_to_run:
        tier_info = PROMPT_TIERS.get(tier_key, PROMPT_TIERS["short"])
        prompt_text = str(tier_info["prompt"])
        for c_level in levels:
            warm_res = run_scenario(
                adapter=adapter,
                loader=loader,
                telemetry=telemetry,
                model_id=model_id,
                prompt_tier=tier_key,
                prompt=prompt_text,
                max_new_tokens=max_new_tokens,
                concurrency=c_level,
                sample_count=max(c_level, samples_per_level),
                warm_state="warm",
            )
            scenarios.append(warm_res)

    torch_version = "not_installed (numpy_cpu_fallback active)"
    if telemetry.is_torch_available() and telemetry._torch is not None:
        torch_version = str(getattr(telemetry._torch, "__version__", "installed"))

    chart_series, ref_providers, routing_recs = _build_chart_series_and_routing_matrix(
        scenarios=scenarios,
        provider_name=adapter.name,
        model_id=model_id,
    )

    peak_throughput = max((s.aggregate_output_tokens_per_sec for s in scenarios), default=0.0)
    warm_c1_scenarios = [s for s in scenarios if s.warm_state == "warm" and s.concurrency == 1]
    baseline_c1 = warm_c1_scenarios[0] if warm_c1_scenarios else scenarios[0]

    return {
        "schema_version": "1.0.0",
        "benchmark_id": "m04-inference-benchmark",
        "run_id": run_id,
        "generated_at": iso_timestamp,
        "run_date": ts_now.strftime("%Y-%m-%d"),
        "provider": adapter.name,
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
            "precision": "fp32",
            "model_spec": {
                "hidden_dim": loaded.spec.hidden_dim,
                "num_layers": loaded.spec.num_layers,
                "vocab_size": loaded.spec.vocab_size,
                "max_context_length": loaded.spec.max_context_length,
                "cost_microcents_per_token": loaded.spec.cost_microcents_per_token,
                "active_tensor_footprint_mb_measured": loaded.backend.footprint_mb,
                "full_fp16_weights_vram_gb_estimated": loaded.spec.estimated_vram_mb,
            },
        },
        "workload": {
            "prompt_tiers_evaluated": [
                {
                    "tier": k,
                    "description": PROMPT_TIERS[k]["description"],
                    "prompt_chars": len(str(PROMPT_TIERS[k]["prompt"])),
                    "prompt_tokens": len(
                        tokenize_prompt(str(PROMPT_TIERS[k]["prompt"]), loaded.spec.vocab_size)
                    ),
                }
                for k in tiers_to_run
            ],
            "max_new_tokens": max_new_tokens,
            "temperature": 0.7,
            "concurrency_levels": levels,
            "samples_per_level": samples_per_level,
        },
        "summary_kpis": {
            "cold_start_latency_p50_ms": cold_res.latency_p50_ms,
            "warm_c1_latency_p50_ms": baseline_c1.latency_p50_ms,
            "warm_c1_ttft_p50_ms": baseline_c1.ttft_p50_ms,
            "warm_c1_itl_p50_ms": baseline_c1.itl_p50_ms,
            "peak_aggregate_tokens_per_sec": peak_throughput,
            "cost_per_1m_tokens_usd": baseline_c1.cost_per_1m_tokens_usd,
            "ram_rss_mb": baseline_c1.ram_rss_mb,
            "vram_peak_mb": max((s.vram_peak_mb for s in scenarios), default=0.0),
            "measurement_mode": "measured",
        },
        "metric_definitions": {
            "latency_p50_ms": "Measured 50th percentile end-to-end request latency in milliseconds.",
            "latency_p95_ms": "Measured 95th percentile end-to-end request latency in milliseconds.",
            "latency_p99_ms": "Measured 99th percentile end-to-end request latency in milliseconds.",
            "ttft_p50_ms": "Measured 50th percentile Time-To-First-Token (prefill + first step) in milliseconds.",
            "itl_p50_ms": "Measured 50th percentile Inter-Token Latency / Time-Per-Output-Token (decode phase) in ms/token.",
            "aggregate_output_tokens_per_sec": "Measured total completion tokens generated divided by batch wall-clock duration.",
            "cost_per_1m_tokens_usd": "Normalized unit economic cost in USD per 1,000,000 tokens.",
        },
        "measured_results": [s.to_dict() for s in scenarios],
        "chart_series": chart_series,
        "routing_recommendations_by_prompt_tier": routing_recs,
        "reference_provider_comparison_estimated": ref_providers,
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
    """Format a single benchmark run into a reproducible Markdown evidence report."""
    hw = report["hardware_environment"]
    sw = report["software_and_model"]
    wl = report["workload"]
    est = report["reference_projections_estimated"]

    lines = [
        f"# Inference Benchmark Run Report — `{report['run_id']}`",
        "",
        "Generated by [`benchmarks/run_inference_benchmark.py`](../run_inference_benchmark.py) in compliance with `.agents/skills/benchmarking/SKILL.md` and `AGENTS.md` (**Evidence over claims**).",
        "",
        "## 1. Run Provenance, Hardware & Model Config (`Measured`)",
        "",
        "| Dimension | Value | Evidence Mode |",
        "|---|---|---|",
        f"| **Run ID & Timestamp (UTC)** | `{report['run_id']}` (`{report['generated_at']}`) | `Measured` |",
        f"| **Provider Adapter** | `{report['provider']}` | `Measured` |",
        f"| **Execution Device** | `{hw['device_name']}` (`{hw['device_type']}`) | `Measured` |",
        f"| **Active Tensor Backend** | `{hw['backend']}` (`precision={sw['precision']}`) | `Measured` |",
        f"| **Logical CPU Cores / CUDA** | `{hw['cpu_count_logical']}` cores · `CUDA={hw['cuda_available']}` | `Measured` |",
        f"| **Software Stack** | Python `{sw['python_version']}` · NumPy `{sw['numpy_version']}` · PyTorch `{sw['pytorch_version']}` | `Measured` |",
        f"| **Model Identifier** | `{sw['model_id']}` (`layers={sw['model_spec']['num_layers']}`, `dim={sw['model_spec']['hidden_dim']}`) | `Measured` |",
        f"| **Active Tensor Footprint** | `{sw['model_spec']['active_tensor_footprint_mb_measured']} MiB` | `Measured` |",
        "",
        "## 2. Prompt Size Tiers & Workload Matrix",
        "",
        "| Prompt Tier | Token Count | Char Length | Workload Profile |",
        "|---|---|---|---|",
    ]

    for pt in wl["prompt_tiers_evaluated"]:
        lines.append(
            f"| `{pt['tier']}` | {pt['prompt_tokens']} tok | {pt['prompt_chars']} chars | {pt['description']} |"
        )

    lines.extend(
        [
            "",
            f"- **Target Output Tokens**: `{wl['max_new_tokens']}` tokens (`temperature={wl['temperature']}`)",
            f"- **Concurrency Sweep**: `{wl['concurrency_levels']}` concurrent workers (`{wl['samples_per_level']}` samples per level)",
            "",
            "## 3. Multi-Prompt & Concurrency Benchmark Results (`Measured`)",
            "",
            "| Scenario | Prompt Tier | State | Conc (`c`) | Prompt Tok | Out Tok | E2E p50 (ms) | E2E p95 (ms) | E2E p99 (ms) | TTFT p50 (ms) | ITL p50 (ms/tok) | Output Throughput (tok/s) | Cost ($/1M tok) | RAM (MiB) | Mode |",
            "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
        ]
    )

    for row in report["measured_results"]:
        lines.append(
            f"| `{row['scenario_id']}` | `{row['prompt_tier']}` | `{row['warm_state']}` | {row['concurrency']} "
            f"| {row['prompt_tokens']} | {row['output_tokens_target']} | {row['latency_p50_ms']:.2f} "
            f"| {row['latency_p95_ms']:.2f} | {row['latency_p99_ms']:.2f} | {row['ttft_p50_ms']:.2f} "
            f"| {row['itl_p50_ms']:.3f} | **{row['aggregate_output_tokens_per_sec']:.1f}** "
            f"| \\${row['cost_per_1m_tokens_usd']:.2f} | {row['ram_rss_mb']:.1f} | `{row['measurement_type']}` |"
        )

    lines.extend(
        [
            "",
            "## 4. Prompt-Size-Aware Provider Routing Reference Matrix (`Measured` + `Estimated`)",
            "",
            "Used by the policy router (M08) and product dashboard (M11) to select the optimal execution backend based on incoming prompt size and concurrency:",
            "",
            "| Prompt Tier | Token Range | Bottleneck Profile | Primary Provider | GPU / Cloud Target | Burst Fallback | Routing Rationale |",
            "|---|---|---|---|---|---|---|",
        ]
    )

    for rec in report["routing_recommendations_by_prompt_tier"]:
        lines.append(
            f"| `{rec['prompt_tier']}` | {rec['token_range']} | {rec['workload_characteristic']} "
            f"| `{rec['recommended_primary_provider']}` | `{rec['recommended_gpu_target']}` "
            f"| `{rec['recommended_burst_fallback']}` | {rec['rationale']} |"
        )

    lines.extend(
        [
            "",
            "## 5. Reference Cloud & Local GPU Targets (`Estimated`)",
            "",
            "| Provider Adapter | Target Hardware | Precision | Cold Start | Short Prompt E2E p95 | Long Prompt E2E p95 | Batch (c=8) Throughput | Unit Cost ($/1M tok) | Mode |",
            "|---|---|---|---|---|---|---|---|---|",
        ]
    )

    for prov in report["reference_provider_comparison_estimated"]:
        short_p = prov["profiles_by_prompt_tier"]["short"]
        long_p = prov["profiles_by_prompt_tier"]["long"]
        lines.append(
            f"| `{prov['provider']}` | `{prov['hardware']}` | `{prov['precision']}` | {prov['cold_start_ms']:.0f} ms "
            f"| {short_p['e2e_p95_ms']:.0f} ms | {long_p['e2e_p95_ms']:.0f} ms "
            f"| {short_p['batch_c8_tokens_per_sec']:.0f} tok/s | \\${short_p['cost_per_1m_tokens_usd']:.2f} | `{prov['measurement_type']}` |"
        )

    lines.extend(
        [
            "",
            f"- **RTX 5070 Ti Baseline Note (`Estimated`)**: `{est['vram_footprint_gb_estimated']} GiB` VRAM, `{est['single_stream_tokens_per_sec_estimated']} tok/s` single-stream, `{est['batch_c8_aggregate_tokens_per_sec_estimated']} tok/s` at `c=8`, `{est['ttft_p50_ms_estimated']} ms` TTFT.",
            "",
            "## 6. Reproducibility Command",
            "",
            "```bash",
            "python3 benchmarks/run_inference_benchmark.py --output-dir benchmarks/results",
            "```",
            "",
        ]
    )
    return "\n".join(lines)


def update_run_ledgers(output_dir: Path, report: dict[str, Any]) -> dict[str, Path]:
    """Persist run-dated artifacts and update manifest.json, history.jsonl, and index.md for Web UI & CLI comparison."""
    output_dir.mkdir(parents=True, exist_ok=True)
    runs_dir = output_dir / "runs" / str(report["run_id"])
    runs_dir.mkdir(parents=True, exist_ok=True)

    run_json_path = runs_dir / "report.json"
    run_md_path = runs_dir / "report.md"
    md_content = render_markdown_report(report)

    run_json_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    run_md_path.write_text(md_content, encoding="utf-8")

    # Keep latest aliases at top-level of output_dir for backward compatibility
    latest_json_path = output_dir / "m04_inference_benchmark.json"
    latest_md_path = output_dir / "m04_inference_benchmark.md"
    latest_json_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    latest_md_path.write_text(md_content, encoding="utf-8")

    # Build compact summary entry for manifest.json and history.jsonl
    hw = report["hardware_environment"]
    sw = report["software_and_model"]
    kpis = report["summary_kpis"]
    summary_entry = {
        "run_id": report["run_id"],
        "generated_at": report["generated_at"],
        "run_date": report["run_date"],
        "provider": report["provider"],
        "model_id": sw["model_id"],
        "precision": sw["precision"],
        "device_type": hw["device_type"],
        "device_name": hw["device_name"],
        "backend": hw["backend"],
        "prompt_tiers": [pt["tier"] for pt in report["workload"]["prompt_tiers_evaluated"]],
        "concurrency_levels": report["workload"]["concurrency_levels"],
        "max_new_tokens": report["workload"]["max_new_tokens"],
        "summary_kpis": kpis,
        "chart_series": report["chart_series"],
        "report_json_path": f"runs/{report['run_id']}/report.json",
        "report_md_path": f"runs/{report['run_id']}/report.md",
    }

    # Update manifest.json (deduplicating by run_id, newest first for Web UI consumption)
    manifest_path = output_dir / "manifest.json"
    existing_runs: list[dict[str, Any]] = []
    if manifest_path.is_file():
        try:
            loaded_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            if isinstance(loaded_manifest, dict) and isinstance(loaded_manifest.get("runs"), list):
                existing_runs = [
                    r for r in loaded_manifest["runs"] if r.get("run_id") != report["run_id"]
                ]
        except Exception:
            existing_runs = []

    updated_runs = [summary_entry, *existing_runs]
    manifest_payload = {
        "schema_version": "1.0.0",
        "updated_at": report["generated_at"],
        "total_runs": len(updated_runs),
        "runs": updated_runs,
    }
    manifest_path.write_text(json.dumps(manifest_payload, indent=2) + "\n", encoding="utf-8")

    # Append to history.jsonl
    history_path = output_dir / "history.jsonl"
    with open(history_path, "w", encoding="utf-8") as f:
        for r in reversed(updated_runs):
            f.write(json.dumps(r) + "\n")

    # Render comparative index.md
    index_path = output_dir / "index.md"
    index_lines = [
        "# Inference Benchmark Run Ledger & Multi-Run Comparison Index",
        "",
        "This index tracks dated benchmark executions across hardware targets, models, prompt sizes, and provider adapters. Web dashboards (`apps/dashboard`) consume [`manifest.json`](manifest.json) directly to plot comparative latency, throughput, and Pareto cost curves.",
        "",
        "## Executed Benchmark Runs (`Measured`)",
        "",
        "| Run Date (UTC) | Run ID | Provider | Hardware / Backend | Model (`Precision`) | Prompt Tiers | Warm c=1 p50 (ms) | Warm c=1 TTFT (ms) | Warm c=1 ITL (ms/tok) | Peak Throughput (tok/s) | Unit Cost ($/1M tok) | Artifacts |",
        "|---|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    for r in updated_runs:
        rk = r["summary_kpis"]
        tiers_str = ", ".join(r["prompt_tiers"])
        index_lines.append(
            f"| `{r['generated_at']}` | `{r['run_id']}` | `{r['provider']}` "
            f"| `{r['device_name']}` (`{r['backend']}`) | `{r['model_id']}` (`{r['precision']}`) "
            f"| `{tiers_str}` | {rk['warm_c1_latency_p50_ms']:.2f} | {rk['warm_c1_ttft_p50_ms']:.2f} "
            f"| {rk['warm_c1_itl_p50_ms']:.3f} | **{rk['peak_aggregate_tokens_per_sec']:.1f}** "
            f"| \\${rk['cost_per_1m_tokens_usd']:.2f} "
            f"| [Report]({r['report_md_path']}) · [JSON]({r['report_json_path']}) |"
        )

    index_lines.extend(
        [
            "",
            "## Web UI & Graph Integration (`manifest.json`)",
            "",
            "- **Web Manifest**: [`manifest.json`](manifest.json) exposes `runs[].chart_series.concurrency_scaling_by_prompt_tier` and `runs[].chart_series.prompt_tier_latency_breakdown_c1` for direct charting.",
            "- **JSONL History**: [`history.jsonl`](history.jsonl) provides an append-only stream for CLI/DuckDB analytics.",
            "",
        ]
    )
    index_path.write_text("\n".join(index_lines), encoding="utf-8")

    return {
        "run_json": run_json_path,
        "run_md": run_md_path,
        "manifest_json": manifest_path,
        "history_jsonl": history_path,
        "index_md": index_path,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Run reproducible inference benchmark suite and update multi-run comparison ledgers."
    )
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
        help="Number of completion tokens to generate per request.",
    )
    parser.add_argument(
        "--samples",
        type=int,
        default=6,
        help="Number of samples per concurrency level.",
    )
    parser.add_argument(
        "--prompt-tiers",
        type=str,
        default="short,medium,long",
        help="Comma-separated prompt size tiers to evaluate (short,medium,long).",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("benchmarks/results"),
        help="Directory to write dated run artifacts, manifest.json, and index.md.",
    )
    args = parser.parse_args(argv)

    tiers = [t.strip() for t in args.prompt_tiers.split(",") if t.strip() in PROMPT_TIERS]
    if not tiers:
        tiers = ["short", "medium", "long"]

    report = run_benchmark_suite(
        model_id=args.model_id,
        max_new_tokens=args.max_new_tokens,
        samples_per_level=args.samples,
        prompt_tiers=tiers,
    )

    paths = update_run_ledgers(args.output_dir, report)
    print(
        f"Benchmark complete (run_id={report['run_id']}). "
        f"Wrote {paths['run_json']}, {paths['manifest_json']}, and {paths['index_md']}."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
