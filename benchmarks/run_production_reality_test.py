#!/usr/bin/env python3
"""Production reality inference benchmark harness (M04 / M12).

Contrasts static microbenchmarks against live multi-tenant production dynamics:
1. Cold Start Scaling Penalty: Request 1 latency on freshly booted worker pod (KEDA 0 -> 1).
2. Dynamic Shape Churn: Variable input sequence lengths (1 to 850 tokens) causing JIT shape specialization stress.
3. Tail Latency & Throughput: Measures p50 and p99 TTFT and steady-state latency under non-uniform streams.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import platform
import sys
import time
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import numpy as np  # type: ignore[import-not-found]
try:
    import torch  # type: ignore[import-not-found]
except Exception:
    torch = None  # type: ignore[assignment]

from apps.worker.models import (
    BENCHMARK_MODEL_REGISTRY,
    ExecutionEngine,
    ModelLoader,
)

# Realistic non-uniform multi-tenant prompt stream
PRODUCTION_PROMPT_STREAM: list[dict[str, Any]] = [
    {
        "id": "req-01-ping",
        "category": "Ultra-Short Ping",
        "prompt": "Hello",
        "max_new_tokens": 16,
    },
    {
        "id": "req-02-interactive",
        "category": "Interactive Chat",
        "prompt": "Explain Raft consensus protocol leader election in distributed inference clusters.",
        "max_new_tokens": 32,
    },
    {
        "id": "req-03-code",
        "category": "Code Generation",
        "prompt": "Write a Fastify TypeScript plugin that validates tenant headers and returns RFC 7807 problem details.",
        "max_new_tokens": 48,
    },
    {
        "id": "req-04-summary",
        "category": "Medium Summarization",
        "prompt": (
            "Summarize the architecture specifications for two-path orchestration in multi-tenant inference:\n"
            + ("Distributed job worker lifecycle with SQS and KEDA autoscaling. " * 8)
        ),
        "max_new_tokens": 64,
    },
    {
        "id": "req-05-rag-doc",
        "category": "Long-Context RAG Doc",
        "prompt": (
            "Analyze the following operational specification document for memory constraints:\n"
            + ("Multi-tenant AI inference platform tenant isolation and GPU quota enforcement. " * 30)
        ),
        "max_new_tokens": 64,
    },
    {
        "id": "req-06-followup",
        "category": "Conversational Followup",
        "prompt": "Can you format that as a JSON configuration schema?",
        "max_new_tokens": 24,
    },
    {
        "id": "req-07-short-query",
        "category": "Edge Query",
        "prompt": "What is the memory footprint of Llama-3-8B FP32?",
        "max_new_tokens": 16,
    },
    {
        "id": "req-08-heavy-rag",
        "category": "Heavy Ingestion",
        "prompt": (
            "Ingest document context and extract API endpoints:\n"
            + ("Fastify control plane route definitions and PostgreSQL state transitions. " * 45)
        ),
        "max_new_tokens": 64,
    },
]


def run_production_reality_for_engine(
    model_id: str,
    device: str,
    engine_name: str,
    engine_enum: ExecutionEngine,
    allow_auto_upgrade: bool = False,
) -> dict[str, Any]:
    """Execute non-uniform prompt sequence without pre-warmup to capture authentic cold and churn behavior."""
    loader = ModelLoader(torch_module=torch, prefer_device=device, tier="benchmark")

    # Load model (captures cold load)
    load_start_ns = time.perf_counter_ns()
    loaded, _ = loader.load(
        model_id=model_id,
        device=device,
        engine=engine_enum,
        allow_auto_upgrade=allow_auto_upgrade,
        tier="benchmark",
    )
    cold_load_ms = (time.perf_counter_ns() - load_start_ns) / 1_000_000

    request_latencies: list[float] = []
    request_ttfts: list[float] = []
    tokens_generated_list: list[int] = []
    prompt_tokens_list: list[int] = []

    for req in PRODUCTION_PROMPT_STREAM:
        t0 = time.perf_counter_ns()
        _, p_tok, g_tok, ttft_ms, _ = loaded.backend.generate(
            prompt=req["prompt"],
            max_new_tokens=req["max_new_tokens"],
        )
        if device == "cuda" and torch is not None and torch.cuda.is_available():
            torch.cuda.synchronize()
        wall_ms = (time.perf_counter_ns() - t0) / 1_000_000

        request_latencies.append(round(wall_ms, 3))
        request_ttfts.append(round(ttft_ms, 3))
        tokens_generated_list.append(g_tok)
        prompt_tokens_list.append(p_tok)

    cold_req1_latency_ms = request_latencies[0]
    cold_req1_ttft_ms = request_ttfts[0]

    steady_latencies = request_latencies[1:] if len(request_latencies) > 1 else request_latencies
    steady_avg_latency_ms = round(sum(steady_latencies) / len(steady_latencies), 3)

    sorted_ttfts = sorted(request_ttfts)
    ttft_p50_ms = round(sorted_ttfts[len(sorted_ttfts) // 2], 3)
    ttft_p99_ms = round(sorted_ttfts[-1], 3)

    total_tokens_gen = sum(tokens_generated_list)
    total_steady_time_s = sum(steady_latencies) / 1000.0
    effective_churn_tps = round(
        sum(tokens_generated_list[1:]) / max(total_steady_time_s, 0.001), 1
    )

    return {
        "engine_label": engine_name,
        "device": device,
        "cold_load_ms": round(cold_load_ms, 3),
        "cold_req1_latency_ms": cold_req1_latency_ms,
        "cold_req1_ttft_ms": cold_req1_ttft_ms,
        "steady_avg_latency_ms": steady_avg_latency_ms,
        "ttft_p50_ms": ttft_p50_ms,
        "ttft_p99_ms": ttft_p99_ms,
        "effective_churn_tps": effective_churn_tps,
        "total_requests": len(PRODUCTION_PROMPT_STREAM),
        "total_tokens_generated": total_tokens_gen,
        "request_details": [
            {
                "request_id": PRODUCTION_PROMPT_STREAM[i]["id"],
                "category": PRODUCTION_PROMPT_STREAM[i]["category"],
                "prompt_tokens": prompt_tokens_list[i],
                "generated_tokens": tokens_generated_list[i],
                "ttft_ms": request_ttfts[i],
                "latency_ms": request_latencies[i],
            }
            for i in range(len(PRODUCTION_PROMPT_STREAM))
        ],
    }


def execute_production_reality_benchmark() -> dict[str, Any]:
    """Run production reality evaluation across reference models and execution engines."""
    has_cuda = torch is not None and torch.cuda.is_available()
    device = "cuda" if has_cuda else "cpu"

    target_models = [
        "meta-llama/Llama-3-8B-Instruct",
        "TinyLlama/TinyLlama-1.1B-Chat-v1.0",
    ]

    engine_matrix = [
        ("PyTorch Eager", ExecutionEngine.EAGER, False),
        ("TorchScript JIT (Legacy)", ExecutionEngine.TORCHSCRIPT, False),
        ("PyTorch 2.x torch.compile", ExecutionEngine.TORCH_COMPILE, False),
        ("Transparent Auto-Upgrade", ExecutionEngine.TORCHSCRIPT, True),
    ]

    results_by_model: dict[str, list[dict[str, Any]]] = {}

    print("=========================================================================================")
    print(f"  Production Reality Inference Benchmark: Dynamic Shape Churn & Cold Scaling")
    print(f"  Target Device: {device.upper()} | Non-uniform stream: {len(PRODUCTION_PROMPT_STREAM)} sequential requests")
    print("=========================================================================================")

    for mid in target_models:
        print(f"\nEvaluating Model: {mid}")
        print("-----------------------------------------------------------------------------------------")
        print(f"{'Execution Engine':26} | {'Req 1 Cold (ms)':15} | {'Steady Avg (ms)':15} | {'TTFT p50 (ms)':13} | {'TTFT p99 (ms)':13} | {'Churn tok/s':11}")
        print("-----------------------------------------------------------------------------------------")

        model_results: list[dict[str, Any]] = []
        for name, enum_val, auto_up in engine_matrix:
            res = run_production_reality_for_engine(
                model_id=mid,
                device=device,
                engine_name=name,
                engine_enum=enum_val,
                allow_auto_upgrade=auto_up,
            )
            model_results.append(res)
            print(
                f"{name:26} | "
                f"{res['cold_req1_latency_ms']:15.2f} | "
                f"{res['steady_avg_latency_ms']:15.2f} | "
                f"{res['ttft_p50_ms']:13.2f} | "
                f"{res['ttft_p99_ms']:13.2f} | "
                f"{res['effective_churn_tps']:11.1f}"
            )

        results_by_model[mid] = model_results

    out_data = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "device": device,
        "hardware": {
            "cpu": platform.processor() or "x86_64 Host CPU",
            "gpu": torch.cuda.get_device_name(0) if has_cuda else "N/A",
        },
        "results_by_model": results_by_model,
    }

    out_path = REPO_ROOT / "benchmarks" / "results" / "production_reality_matrix.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out_data, indent=2) + "\n", encoding="utf-8")
    print(f"\nSaved production reality benchmark results to {out_path}")
    return out_data


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run Production Reality Benchmark")
    parser.parse_args()
    execute_production_reality_benchmark()

