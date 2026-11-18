#!/usr/bin/env python3
"""Real local-GPU metrics verification harness.

Runs a couple of production-weight jobs per VRAM-fitting model with prompts and
geometry capped for ~10 minutes max inference per job. Asserts:
  - production_weights / not stub token_accounting
  - usage.compute_duration_ms == metadata.inference_ms
  - duration is not the classic stub band (~400ms with 250/512 tokens)

Evidence mode: measured (local RTX-class CUDA).

Usage (from repo root, GPU host / platform-api container)::

  MOCK_PROVIDERS=0 MOCK_INFERENCE=0 python benchmarks/run_real_metrics_gpu.py
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import time
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

os.environ.setdefault("MOCK_PROVIDERS", "0")
os.environ.setdefault("MOCK_INFERENCE", "0")
os.environ.setdefault("INFERENCE_MOCK_MODE", "0")
os.environ.setdefault("USE_PRODUCTION_WEIGHTS", "1")

from apps.worker.contracts import InferenceRequest  # noqa: E402
from apps.worker.providers.local import LocalPyTorchAdapter  # noqa: E402


@dataclass(frozen=True)
class BenchCase:
    model_id: str
    purpose: str
    prompt: str
    parameters: dict[str, Any]
    min_vram_gb: float


# Only fits_vram models; parameters chosen for ≤ ~10 min denoise/generate on RTX 5070 Ti 16GB.
CASES: list[BenchCase] = [
    BenchCase(
        model_id="TinyLlama/TinyLlama-1.1B-Chat-v1.0",
        purpose="text_to_text",
        prompt="In two sentences, explain why measured inference latency differs from wall-clock job time.",
        parameters={
            "device": "cuda",
            "weights": "production",
            "max_new_tokens": 64,
            "temperature": 0.2,
            "engine": "auto",
        },
        min_vram_gb=3,
    ),
    BenchCase(
        model_id="TinyLlama/TinyLlama-1.1B-Chat-v1.0",
        purpose="text_to_text",
        prompt="List three enterprise metrics for GPU inference jobs: load time, inference time, and token throughput.",
        parameters={
            "device": "cuda",
            "weights": "production",
            "max_new_tokens": 80,
            "temperature": 0.2,
            "engine": "auto",
        },
        min_vram_gb=3,
    ),
    BenchCase(
        model_id="stabilityai/sd-turbo",
        purpose="text_to_image",
        prompt="A sunlit Mediterranean kitchen with fresh tomatoes and olive oil, photorealistic product photo.",
        parameters={
            "device": "cuda",
            "weights": "production",
            "width": 512,
            "height": 512,
            "num_inference_steps": 2,
            "guidance_scale": 0.0,
            "engine": "auto",
        },
        min_vram_gb=5,
    ),
    BenchCase(
        model_id="stabilityai/sd-turbo",
        purpose="text_to_image",
        prompt="Macro shot of amber perfume bottle on black marble, dramatic golden rim light, sharp glass caustics.",
        parameters={
            "device": "cuda",
            "weights": "production",
            "width": 512,
            "height": 512,
            "num_inference_steps": 4,
            "guidance_scale": 0.0,
            "engine": "auto",
        },
        min_vram_gb=5,
    ),
    BenchCase(
        model_id="openai/clip-vit-large-patch14",
        purpose="media_photo",
        prompt="A Formula 1 driver in a red racing suit standing beside a race car",
        parameters={
            "device": "cuda",
            "weights": "production",
            "media_asset_uri": "tests/fixtures/media/fernando_alonso_f1.jpg",
            "engine": "auto",
        },
        min_vram_gb=2,
    ),
    BenchCase(
        model_id="openai/clip-vit-large-patch14",
        purpose="media_photo",
        prompt="A close-up photograph of a domestic pet dog sitting on snow",
        parameters={
            "device": "cuda",
            "weights": "production",
            "media_asset_uri": "tests/fixtures/media/fernando_alonso_f1.jpg",
            "engine": "auto",
        },
        min_vram_gb=2,
    ),
    # Short LTX geometry so denoise stays under the 10-minute budget (full 161f/30step can exceed 40m).
    BenchCase(
        model_id="Lightricks/LTX-Video",
        purpose="text_to_video",
        prompt=(
            "A blue hatchback on a quiet coastal road at golden hour, "
            "slow dolly from the front three-quarter, soft wind, cinematic."
        ),
        parameters={
            "device": "cuda",
            "weights": "production",
            "width": 544,
            "height": 320,
            "fps": 24,
            "duration_seconds": 2,
            "num_inference_steps": 12,
            "guidance_scale": 3.0,
            "engine": "auto",
        },
        min_vram_gb=10,
    ),
    BenchCase(
        model_id="Lightricks/LTX-Video",
        purpose="text_to_video",
        prompt=(
            "Steam rising from a ceramic espresso cup on a wooden table, "
            "soft morning window light, shallow depth of field, one continuous shot."
        ),
        parameters={
            "device": "cuda",
            "weights": "production",
            "width": 544,
            "height": 320,
            "fps": 24,
            "duration_seconds": 2,
            "num_inference_steps": 12,
            "guidance_scale": 3.0,
            "engine": "auto",
        },
        min_vram_gb=10,
    ),
]


def _fixture_ok(path: str) -> bool:
    return Path(path).exists()


def _select_cases(vram_gb: float) -> list[BenchCase]:
    selected: list[BenchCase] = []
    for case in CASES:
        if case.min_vram_gb > vram_gb + 0.5:
            continue
        media = str(case.parameters.get("media_asset_uri") or "")
        if media and not _fixture_ok(media):
            # Try alternate whisper fixture names.
            alts = [
                "tests/fixtures/media/sample_audio.wav",
                "tests/fixtures/media/whisper_sample.wav",
                "tests/fixtures/media/sample_bunny_clip.mp4",
            ]
            found = next((a for a in alts if _fixture_ok(a)), None)
            if not found and case.purpose == "speech_to_text":
                print(f"[skip] {case.model_id}: missing audio fixture", file=sys.stderr)
                continue
            if found:
                case = BenchCase(
                    model_id=case.model_id,
                    purpose=case.purpose,
                    prompt=case.prompt,
                    parameters={**case.parameters, "media_asset_uri": found},
                    min_vram_gb=case.min_vram_gb,
                )
            elif media and not _fixture_ok(media):
                print(f"[skip] {case.model_id}: missing {media}", file=sys.stderr)
                continue
        selected.append(case)
    return selected


def _assert_real_metrics(meta: dict[str, Any], usage: Any, case: BenchCase) -> list[str]:
    errors: list[str] = []
    if not bool(meta.get("production_weights")):
        errors.append("production_weights is not true")
    if meta.get("token_accounting") in (None, "synthetic"):
        errors.append(f"token_accounting={meta.get('token_accounting')!r} looks stubby")
    inference_ms = float(meta.get("inference_ms") or 0.0)
    usage_ms = float(usage.compute_duration_ms)
    if abs(inference_ms - usage_ms) > 1.0:
        errors.append(f"inference_ms ({inference_ms}) != usage.compute_duration_ms ({usage_ms})")
    # Classic stub signature from the old bug.
    if abs(usage_ms - 406) < 30 and int(usage.prompt_tokens) == 250 and int(usage.completion_tokens) == 512:
        errors.append("matches classic stub UsageMetrics signature (406ms / 250/512)")
    # SD-Turbo warm 2–4 step denoise can be well under 200ms on RTX 5070 Ti; only flag absurd stubs.
    if case.purpose == "text_to_video" and usage_ms < 1000:
        errors.append(f"suspiciously fast video inference_ms={usage_ms}")
    if case.purpose == "text_to_image" and usage_ms < 20:
        errors.append(f"suspiciously fast image inference_ms={usage_ms}")
    if case.purpose == "text_to_video":
        if meta.get("actual_duration_s") is None:
            errors.append("missing actual_duration_s")
        if meta.get("num_frames") is None:
            errors.append("missing num_frames")
    model_load_ms = float(meta.get("model_load_ms") or 0.0)
    if bool(meta.get("warm_start")) and model_load_ms > 0:
        errors.append(f"warm_start but model_load_ms={model_load_ms}")
    return errors


async def _run_one(adapter: LocalPyTorchAdapter, case: BenchCase, idx: int) -> dict[str, Any]:
    job_id = f"bench-metrics-{idx:02d}"
    req = InferenceRequest(
        job_id=job_id,
        tenant_id="tenant-default",
        model_id=case.model_id,
        prompt=case.prompt,
        parameters=dict(case.parameters),
        timeout_seconds=900.0,
    )
    wall0 = time.perf_counter()
    result = await adapter.predict(req)
    wall_ms = (time.perf_counter() - wall0) * 1000.0
    meta = dict(result.metadata)
    # Drop bulky artifacts from the report.
    meta.pop("image_base64", None)
    meta.pop("video_base64", None)
    meta.pop("poster_base64", None)
    errors = _assert_real_metrics(meta, result.usage, case)
    row = {
        "job_id": job_id,
        "model_id": case.model_id,
        "purpose": case.purpose,
        "ok": len(errors) == 0,
        "errors": errors,
        "wall_ms": round(wall_ms, 3),
        "usage": result.usage.to_dict(),
        "metadata": {
            k: meta.get(k)
            for k in (
                "production_weights",
                "warm_start",
                "model_load_ms",
                "pipe_load_ms",
                "inference_ms",
                "total_provider_ms",
                "tokens_per_sec",
                "token_accounting",
                "token_unit_label",
                "width",
                "height",
                "fps",
                "num_frames",
                "num_inference_steps",
                "requested_duration_s",
                "actual_duration_s",
                "measurement_mode",
                "device_slot",
            )
            if k in meta or True
        },
        "telemetry": result.telemetry.to_dict() if result.telemetry else None,
        "output_preview": (result.output_text or "")[:240],
    }
    return row


async def main() -> int:
    try:
        import torch  # type: ignore[import-not-found]

        cuda = bool(torch.cuda.is_available())
        vram_gb = float(torch.cuda.get_device_properties(0).total_memory) / (1024**3) if cuda else 0.0
        device_name = torch.cuda.get_device_name(0) if cuda else "cpu"
    except Exception as exc:
        print(f"CUDA probe failed: {exc}", file=sys.stderr)
        return 2

    if not cuda:
        print("CUDA required for this harness", file=sys.stderr)
        return 2

    cases = _select_cases(vram_gb)
    print(
        json.dumps(
            {
                "event": "start",
                "device": device_name,
                "vram_gb": round(vram_gb, 2),
                "cases": len(cases),
                "mock_providers": os.environ.get("MOCK_PROVIDERS"),
            }
        ),
        flush=True,
    )

    adapter = LocalPyTorchAdapter()
    rows: list[dict[str, Any]] = []
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%SZ")
    out_dir = ROOT / "benchmarks" / "results" / "runs" / f"{stamp}_real_metrics_gpu"
    out_dir.mkdir(parents=True, exist_ok=True)
    checkpoint_path = out_dir / "checkpoint.jsonl"

    for i, case in enumerate(cases):
        print(f"[run] {i + 1}/{len(cases)} {case.model_id} ({case.purpose})", flush=True)
        try:
            row = await _run_one(adapter, case, i)
        except Exception as exc:
            row = {
                "job_id": f"bench-metrics-{i:02d}",
                "model_id": case.model_id,
                "purpose": case.purpose,
                "ok": False,
                "errors": [f"{type(exc).__name__}: {exc}"],
            }
        rows.append(row)
        with checkpoint_path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(row) + "\n")
        print(
            json.dumps(
                {
                    "event": "case_done",
                    "model_id": row.get("model_id"),
                    "ok": row.get("ok"),
                    "inference_ms": (row.get("metadata") or {}).get("inference_ms"),
                    "model_load_ms": (row.get("metadata") or {}).get("model_load_ms"),
                    "tokens": row.get("usage"),
                    "errors": row.get("errors"),
                    "checkpoint": str(checkpoint_path),
                }
            ),
            flush=True,
        )

    summary: dict[str, int] = {
        "total": len(rows),
        "passed": sum(1 for r in rows if r.get("ok")),
        "failed": sum(1 for r in rows if not r.get("ok")),
    }
    report: dict[str, Any] = {
        "schema_version": "1.0.0",
        "benchmark_id": "real-metrics-gpu",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "measurement_mode": "measured",
        "hardware": {"device_name": device_name, "vram_gb": round(vram_gb, 2)},
        "cases": [
            asdict(c)
            if False
            else {
                "model_id": c.model_id,
                "purpose": c.purpose,
                "prompt": c.prompt,
                "parameters": c.parameters,
                "min_vram_gb": c.min_vram_gb,
            }
            for c in cases
        ],
        "results": rows,
        "summary": summary,
    }
    (out_dir / "report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    md_lines = [
        f"# Real metrics GPU harness — {stamp}",
        "",
        f"- Device: **{device_name}** ({vram_gb:.1f} GB)",
        "- Measurement: **measured**",
        f"- Passed: **{summary['passed']}/{summary['total']}**",
        "",
        "| Model | Purpose | load_ms | inference_ms | in/out | accounting | OK |",
        "|---|---|---:|---:|---|---|---|",
    ]
    for r in rows:
        meta_raw = r.get("metadata")
        meta: dict[str, Any] = meta_raw if isinstance(meta_raw, dict) else {}
        usage_raw = r.get("usage")
        usage: dict[str, Any] = usage_raw if isinstance(usage_raw, dict) else {}
        md_lines.append(
            "| {model} | {purpose} | {load} | {inf} | {tin}/{tout} | {acct} | {ok} |".format(
                model=r.get("model_id"),
                purpose=r.get("purpose"),
                load=meta.get("model_load_ms"),
                inf=meta.get("inference_ms"),
                tin=usage.get("prompt_tokens"),
                tout=usage.get("completion_tokens"),
                acct=meta.get("token_accounting"),
                ok="yes" if r.get("ok") else "no",
            )
        )
        if r.get("errors"):
            md_lines.append(f"| | errors | | | | {'; '.join(r['errors'])} | |")
    (out_dir / "report.md").write_text("\n".join(md_lines) + "\n", encoding="utf-8")
    print(json.dumps({"event": "done", "report": str(out_dir / "report.json"), **summary}), flush=True)
    return 0 if summary["failed"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
