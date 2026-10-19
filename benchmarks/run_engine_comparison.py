#!/usr/bin/env python3
"""Multi-Engine Multimodal Benchmark Runner by Model Category (MLPerf Aligned).

Evaluates execution engines across reference models by category:
- text-to-text: meta-llama/Llama-3-8B-Instruct (and TinyLlama/TinyLlama-1.1B-Chat-v1.0)
- text-to-image: black-forest-labs/FLUX.1-schnell
- media-photo: Qwen/Qwen2.5-VL-7B-Instruct
- media-video: Wan-AI/Wan2.1-T2V-1.3B

Across 5 execution engines:
- NumPy CPU Fallback
- PyTorch Eager (CPU & CUDA)
- TorchScript JIT (CPU & CUDA)
- PyTorch 2.x torch.compile (CPU & CUDA)
- Transparent Auto-Upgrade (torchscript -> torch.compile) (CPU & CUDA)

Across 4 MLPerf-aligned workload scenarios (Text, Summarization, Long-Context RAG, Multimodal Media Fixtures).
Executes with real materialized benchmark weight tensors (46 - 147 MB) on AMD Ryzen 9 7900 and NVIDIA RTX 5070 Ti.
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
import torch

from apps.worker.flyte_workflow import inspect_local_media_asset
from apps.worker.models import (
    BENCHMARK_MODEL_REGISTRY,
    ExecutionEngine,
    ModelLoader,
    ModelSpec,
)


def load_workload_scenarios(text_dir: Path, media_dir: Path) -> dict[str, dict[str, Any]]:
    """Construct 4 MLPerf-aligned workload scenarios spanning text and multimodal media."""
    short_prompts_file = text_dir / "prompts_short.json"
    code_prompts_file = text_dir / "prompts_code_and_json.json"
    long_doc_file = text_dir / "document_long_context.txt"

    short_prompt = "Explain Raft consensus leader election, log replication, and safety invariants in multi-tenant distributed AI inference clusters."
    if short_prompts_file.exists():
        with open(short_prompts_file, encoding="utf-8") as f:
            short_data = json.load(f)
            if short_data and isinstance(short_data, list):
                short_prompt = short_data[0].get("prompt", short_prompt)

    code_prompt = "Write a Fastify route plugin in TypeScript that validates tenant headers and returns RFC 7807 problem details on authorization error."
    if code_prompts_file.exists():
        with open(code_prompts_file, encoding="utf-8") as f:
            code_data = json.load(f)
            if code_data and isinstance(code_data, list):
                code_prompt = code_data[-1].get("prompt", code_prompt)

    long_doc_text = ""
    if long_doc_file.exists():
        with open(long_doc_file, encoding="utf-8") as f:
            long_doc_text = f.read().strip()

    image_fixture = media_dir / "fernando_alonso_f1.jpg"
    video_fixture = media_dir / "sample_bunny_clip.mp4"

    return {
        "scenario_a_interactive": {
            "name": "Scenario A (Interactive Assistant / Chat)",
            "short_name": "Scenario A (Interactive)",
            "modality": "text",
            "prompt": f"System: Enterprise AI Assistant.\nTask: {short_prompt}\nConstraint: {code_prompt}",
            "target_new_tokens": 32,
            "media_asset_uri": None,
            "description": "Short prompt (~56 tokens), decode-latency sensitive, interactive SLA",
        },
        "scenario_b_summarization": {
            "name": "Scenario B (MLPerf Standard Summarization)",
            "short_name": "Scenario B (Summarization)",
            "modality": "text",
            "prompt": (
                f"Summarize the architecture into operational runbook directives:\n\n"
                f"{long_doc_text[:1200]}\n\n"
                f"Include tenant isolation, two-path orchestration, and SQS/Flyte contracts."
            ),
            "target_new_tokens": 64,
            "media_asset_uri": None,
            "description": "Medium prompt (~254 tokens), balanced prefill and generation",
        },
        "scenario_c_long_context_rag": {
            "name": "Scenario C (Long-Context RAG Document Ingestion)",
            "short_name": "Scenario C (Long-Context RAG)",
            "modality": "text",
            "prompt": (
                f"Detailed Multi-Document Retrieval & Arbitration:\n\n"
                f"{long_doc_text}\n\nContext:\n{long_doc_text}\n\n"
                f"Evaluate GPU quota contention, S3 sandboxing, and KEDA scale-to-zero."
            ),
            "target_new_tokens": 128,
            "media_asset_uri": None,
            "description": "Long context prompt (~1,038 tokens), prefill-compute and KV-cache intensive",
        },
        "scenario_d_multimodal_media": {
            "name": "Scenario D (Multimodal Media Diffusion)",
            "short_name": "Scenario D (Multimodal Media)",
            "modality": "image_to_video",
            "prompt": (
                f"Conditioned multimodal media diffusion prompt:\n"
                f"Animate Fernando Alonso F1 podium celebration with vibrant cyberpunk cel-shading.\n"
                f"Source Image Asset: {image_fixture.name}\n"
                f"Motion Reference Video: {video_fixture.name}"
            ),
            "target_new_tokens": 64,
            "media_asset_uri": str(image_fixture),
            "video_asset_uri": str(video_fixture),
            "description": "Multimodal media conditioning: JPEG header inspection + video spatiotemporal patch token synthesis",
        },
    }


def run_single_engine_scenario(
    loader: ModelLoader,
    model_id: str,
    device: str,
    engine: str,
    allow_auto_upgrade: bool,
    scenario_key: str,
    scenario: dict[str, Any],
    iterations: int = 3,
) -> dict[str, Any]:
    """Execute timed benchmark iterations for one (model, device, engine, scenario) configuration."""
    prompt = scenario["prompt"]
    target_new_tokens = int(scenario["target_new_tokens"])
    media_asset_uri = scenario.get("media_asset_uri")
    modality = scenario.get("modality", "text")

    media_overhead_ms = 0.0
    if media_asset_uri is not None and Path(media_asset_uri).exists():
        t_media_start = time.perf_counter_ns()
        _ = inspect_local_media_asset(media_asset_uri)
        media_overhead_ms = round((time.perf_counter_ns() - t_media_start) / 1_000_000, 3)

    load_start = time.perf_counter_ns()
    loaded, is_warm = loader.load(
        model_id=model_id,
        device=device,
        engine=engine,
        allow_auto_upgrade=allow_auto_upgrade,
        tier="benchmark",
    )
    cold_load_ms = round((time.perf_counter_ns() - load_start) / 1_000_000, 3)

    # Warmup pass to eliminate initial compilation / JIT trace overhead
    _ = loaded.backend.generate(prompt="Warmup ping", max_new_tokens=2)
    if device == "cuda" and torch.cuda.is_available():
        torch.cuda.synchronize()

    ttft_samples: list[float] = []
    latency_samples: list[float] = []
    tpot_samples: list[float] = []
    tokens_generated = 0
    prompt_tokens = 0

    for _ in range(iterations):
        t0 = time.perf_counter_ns()
        output, p_tok, g_tok, ttft_ms, total_ms = loaded.backend.generate(
            prompt=prompt,
            max_new_tokens=target_new_tokens,
        )
        if device == "cuda" and torch.cuda.is_available():
            torch.cuda.synchronize()
        wall_ms = (time.perf_counter_ns() - t0) / 1_000_000
        ttft_samples.append(ttft_ms)
        latency_samples.append(wall_ms)
        tokens_generated = g_tok
        prompt_tokens = p_tok

        if g_tok > 1:
            tpot = max((wall_ms - ttft_ms) / (g_tok - 1), 0.001)
            tpot_samples.append(tpot)
        else:
            tpot_samples.append(wall_ms)

    sorted_ttft = sorted(ttft_samples)
    p50_ttft_ms = round(sorted_ttft[len(sorted_ttft) // 2], 3)
    p95_ttft_ms = round(sorted_ttft[int(len(sorted_ttft) * 0.95)], 3)
    mean_latency_ms = round(sum(latency_samples) / len(latency_samples), 3)
    mean_tpot_ms = round(sum(tpot_samples) / len(tpot_samples), 3)
    tokens_per_sec = (
        round(tokens_generated / (mean_latency_ms / 1000.0), 1)
        if mean_latency_ms > 0
        else 0.0
    )

    cost_microcents = (prompt_tokens + tokens_generated) * loaded.spec.cost_microcents_per_token
    cost_usd_per_1m_tokens = round((loaded.spec.cost_microcents_per_token * 1_000_000) / 100_000_000, 4)

    return {
        "model_id": model_id,
        "device": device,
        "scenario_key": scenario_key,
        "scenario_name": scenario["name"],
        "scenario_short_name": scenario["short_name"],
        "modality": modality,
        "engine_requested": loaded.engine_requested,
        "engine_executed": loaded.engine_executed,
        "upgraded_automatically": loaded.upgraded_automatically,
        "content_sha256": loaded.content_sha256,
        "backend_name": loaded.backend.backend_name,
        "footprint_mb": loaded.backend.footprint_mb,
        "cold_load_ms": cold_load_ms,
        "media_overhead_ms": media_overhead_ms,
        "prompt_tokens": prompt_tokens,
        "generated_tokens": tokens_generated,
        "ttft_p50_ms": p50_ttft_ms,
        "ttft_p95_ms": p95_ttft_ms,
        "tpot_mean_ms": mean_tpot_ms,
        "mean_latency_ms": mean_latency_ms,
        "tokens_per_sec": tokens_per_sec,
        "cost_microcents_job": cost_microcents,
        "cost_usd_per_1m_tokens": cost_usd_per_1m_tokens,
    }


def execute_matrix_benchmark() -> dict[str, Any]:
    """Execute complete empirical engine comparison benchmark across categories on CPU and GPU."""
    text_dir = REPO_ROOT / "tests" / "fixtures" / "text"
    media_dir = REPO_ROOT / "tests" / "fixtures" / "media"
    scenarios = load_workload_scenarios(text_dir, media_dir)

    models_by_category: dict[str, dict[str, Any]] = {
        "text_to_text": {
            "category_name": "Text-to-Text (Autoregressive LLM)",
            "primary_model": "meta-llama/Llama-3-8B-Instruct",
            "edge_model": "TinyLlama/TinyLlama-1.1B-Chat-v1.0",
        },
        "text_to_image": {
            "category_name": "Text-to-Image (Diffusion Transformer / MMDiT)",
            "primary_model": "black-forest-labs/FLUX.1-schnell",
        },
        "media_photo": {
            "category_name": "Media Photo (Vision Transformer & VLM)",
            "primary_model": "Qwen/Qwen2.5-VL-7B-Instruct",
        },
        "media_video": {
            "category_name": "Media Video (3D Spatiotemporal Video DiT)",
            "primary_model": "Wan-AI/Wan2.1-T2V-1.3B",
        },
    }

    all_models = [
        "meta-llama/Llama-3-8B-Instruct",
        "TinyLlama/TinyLlama-1.1B-Chat-v1.0",
        "black-forest-labs/FLUX.1-schnell",
        "Qwen/Qwen2.5-VL-7B-Instruct",
        "Wan-AI/Wan2.1-T2V-1.3B",
    ]

    engine_configs = [
        {"engine": "numpy", "auto_upgrade": False, "label": "NumPy CPU Fallback", "target": "cpu_only"},
        {"engine": "eager", "auto_upgrade": False, "label": "PyTorch Eager", "target": "both"},
        {"engine": "torchscript", "auto_upgrade": False, "label": "TorchScript JIT (Legacy)", "target": "both"},
        {"engine": "torch-compile", "auto_upgrade": False, "label": "PyTorch 2.x torch.compile", "target": "both"},
        {"engine": "torchscript", "auto_upgrade": True, "label": "Transparent Auto-Upgrade", "target": "both"},
    ]

    results_by_model: dict[str, list[dict[str, Any]]] = {m: [] for m in all_models}

    cpu_loader = ModelLoader(torch_module=torch, prefer_device="cpu", tier="benchmark")
    gpu_loader = ModelLoader(torch_module=torch, prefer_device="cuda", tier="benchmark")

    for model_id in all_models:
        print(f"\n=======================================================")
        print(f"Benchmarking Reference Model: {model_id}")
        print(f"=======================================================")

        for s_key, s_data in scenarios.items():
            print(f"  Scenario: {s_data['short_name']}")

            for cfg in engine_configs:
                engine_name = str(cfg["engine"])
                auto_upgrade = bool(cfg["auto_upgrade"])
                label = str(cfg["label"])

                # 1. Run on CPU (Ryzen 9 7900)
                cpu_metrics = run_single_engine_scenario(
                    loader=cpu_loader,
                    model_id=model_id,
                    device="cpu",
                    engine=engine_name,
                    allow_auto_upgrade=auto_upgrade,
                    scenario_key=s_key,
                    scenario=s_data,
                    iterations=3,
                )
                cpu_metrics["engine_label"] = label
                cpu_metrics["device_name"] = "AMD Ryzen 9 7900"

                # 2. Run on GPU (RTX 5070 Ti) if supported
                gpu_metrics: dict[str, Any] | None = None
                if cfg["target"] == "both" and torch.cuda.is_available():
                    gpu_metrics = run_single_engine_scenario(
                        loader=gpu_loader,
                        model_id=model_id,
                        device="cuda",
                        engine=engine_name,
                        allow_auto_upgrade=auto_upgrade,
                        scenario_key=s_key,
                        scenario=s_data,
                        iterations=3,
                    )
                    gpu_metrics["engine_label"] = label
                    gpu_metrics["device_name"] = "NVIDIA GeForce RTX 5070 Ti"

                results_by_model[model_id].append({
                    "scenario_key": s_key,
                    "scenario_name": s_data["name"],
                    "scenario_short_name": s_data["short_name"],
                    "engine_label": label,
                    "engine_requested": engine_name,
                    "auto_upgrade": auto_upgrade,
                    "input_tokens": cpu_metrics["prompt_tokens"],
                    "output_tokens": cpu_metrics["generated_tokens"],
                    "cpu_result": cpu_metrics,
                    "gpu_result": gpu_metrics,
                })

                gpu_str = (
                    f"GPU TTFT={gpu_metrics['ttft_p50_ms']}ms, {gpu_metrics['tokens_per_sec']} tok/s"
                    if gpu_metrics
                    else "GPU: N/A"
                )
                print(f"    [{label}] CPU TTFT={cpu_metrics['ttft_p50_ms']}ms, {cpu_metrics['tokens_per_sec']} tok/s | {gpu_str}")

    return {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "hardware": {
            "cpu": "AMD Ryzen 9 7900 12-Core Processor (24 Threads, 64 MB L3 Cache, DDR5)",
            "gpu": "NVIDIA GeForce RTX 5070 Ti (16 GB GDDR7, CUDA 13.0)",
        },
        "models_by_category": models_by_category,
        "results_by_model": results_by_model,
    }


if __name__ == "__main__":
    matrix = execute_matrix_benchmark()
    out_file = REPO_ROOT / "benchmarks" / "results" / "engine_comparison_matrix.json"
    out_file.parent.mkdir(parents=True, exist_ok=True)
    out_file.write_text(json.dumps(matrix, indent=2) + "\n", encoding="utf-8")
    print(f"\nBenchmark completed successfully! Wrote results to {out_file}.")

