#!/usr/bin/env python3
"""Submit real local/gpu jobs via the control-plane API so they appear in the Jobs UI.

- Tenant: tenant-default
- Provider path: local_pytorch / routing local/gpu
- Only catalog models with localFit=fits_vram (≤16 GB class)
- Two prompts per model (model-adapted)
- Uses catalog defaults (LTX defaults are few-minute safe)
- Relies on the API background worker (WORKER_ENABLED=true) to drain SQS —
  does not call process-next manually.

Usage::

  python3 benchmarks/run_ui_jobs_local.py
  python3 benchmarks/run_ui_jobs_local.py --models TinyLlama/TinyLlama-1.1B-Chat-v1.0,stabilityai/sd-turbo
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
BASE_URL = os.environ.get("PLATFORM_BASE_URL", "http://localhost:3000").rstrip("/")
TENANT_ID = os.environ.get("PLATFORM_TENANT_ID", "tenant-default")
API_KEY = os.environ.get("PLATFORM_API_KEY", "dev-secret-key")
POLL_SEC = float(os.environ.get("PLATFORM_POLL_SEC", "3"))
PROCESS_TIMEOUT_SEC = int(os.environ.get("PLATFORM_PROCESS_TIMEOUT_SEC", "1800"))


@dataclass(frozen=True)
class JobSpec:
    model_id: str
    purpose: str
    prompt: str
    parameters: dict[str, Any]
    min_vram_gb: float


def _catalog() -> list[JobSpec]:
    """Two jobs per fits_vram local model; prompts adapted; params = catalog defaults."""
    specs: list[JobSpec] = []

    def add(model_id: str, purpose: str, prompts: tuple[str, str], params: dict[str, Any], vram: float) -> None:
        for prompt in prompts:
            specs.append(
                JobSpec(
                    model_id=model_id,
                    purpose=purpose,
                    prompt=prompt,
                    parameters={
                        "weights": "production",
                        "device": "cuda",
                        "engine": "auto",
                        "allow_auto_upgrade": True,
                        "provider": "local_pytorch",
                        **params,
                    },
                    min_vram_gb=vram,
                )
            )

    add(
        "TinyLlama/TinyLlama-1.1B-Chat-v1.0",
        "text_to_text",
        (
            "In two short sentences, explain why job wall-clock can exceed inference_ms.",
            "List three enterprise inference metrics: model load, inference time, and token throughput.",
        ),
        {"temperature": 0.7, "max_new_tokens": 256},
        3,
    )
    add(
        "Qwen/Qwen2.5-7B-Instruct",
        "text_to_text",
        (
            "Summarize in 3 bullet points how a multi-tenant GPU inference queue should isolate tenants.",
            "Write a concise TypeScript type for a job status enum with QUEUED, PROCESSING, SUCCEEDED, FAILED.",
        ),
        {"temperature": 0.7, "max_new_tokens": 256},
        6,
    )
    add(
        "mistralai/Mistral-7B-Instruct-v0.2",
        "text_to_text",
        (
            "Explain cold start vs warm start for a Diffusers pipeline in two sentences.",
            "Give a short checklist for validating that job duration_ms is not a stub value.",
        ),
        {"temperature": 0.6, "max_new_tokens": 256},
        6,
    )
    add(
        "deepseek-ai/DeepSeek-R1-Distill-Qwen-7B",
        "code_reasoning",
        (
            "Reason step-by-step: why should usage.compute_duration_ms equal metadata.inference_ms after a real GPU job?",
            "Propose a tiny Python assert that rejects the classic stub signature 406ms with 250/512 tokens.",
        ),
        {"temperature": 0.5, "max_new_tokens": 384},
        6,
    )
    add(
        "stabilityai/sd-turbo",
        "text_to_image",
        (
            "A sunlit Mediterranean kitchen with fresh tomatoes and olive oil, photorealistic.",
            "Macro shot of an amber perfume bottle on black marble, golden rim light, sharp glass caustics.",
        ),
        {
            "width": 512,
            "height": 512,
            "num_inference_steps": 4,
            "guidance_scale": 0,
        },
        5,
    )
    add(
        "black-forest-labs/FLUX.1-schnell",
        "text_to_image",
        (
            "A sunlit Mediterranean kitchen with fresh tomatoes and olive oil, photorealistic, 35mm.",
            "Minimal product photo of a cobalt ceramic mug on linen, soft window light, shallow depth of field.",
        ),
        {
            "width": 1024,
            "height": 1024,
            "num_inference_steps": 4,
            "guidance_scale": 0,
        },
        8,
    )
    add(
        "openai/clip-vit-large-patch14",
        "media_photo",
        (
            "A Formula 1 driver in a red racing suit standing beside a race car",
            "A close-up photograph of a domestic pet dog sitting on snow",
        ),
        {
            "temperature": 0.2,
            "max_new_tokens": 128,
            "media_asset_uri": "tests/fixtures/media/fernando_alonso_f1.jpg",
        },
        2,
    )
    add(
        "Lightricks/LTX-Video",
        "text_to_video",
        (
            "A blue hatchback on a quiet coastal road at golden hour, slow dolly from the front three-quarter, soft wind, cinematic.",
            "Steam rising from a ceramic espresso cup on a wooden table, soft morning window light, one continuous shot.",
        ),
        {
            "width": 544,
            "height": 320,
            "num_inference_steps": 12,
            "guidance_scale": 3,
            "fps": 24,
            "duration_seconds": 2,
            "negative_prompt": "blurry, low quality, still image, distorted, watermark, text, logo",
        },
        10,
    )
    return specs


def _request(
    method: str,
    path: str,
    body: dict[str, Any] | None = None,
    timeout: float = 60.0,
) -> dict[str, Any]:
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        f"{BASE_URL}{path}",
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {API_KEY}",
            "x-tenant-id": TENANT_ID,
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{method} {path} -> HTTP {exc.code}: {detail[:800]}") from exc


def _submit(spec: JobSpec) -> str:
    # Match dashboard Submit Job: prompt lives under input.prompt (not top-level only).
    payload = {
        "model_id": spec.model_id,
        "routing_preference": "local/gpu",
        "priority": 5,
        "expires_in_seconds": 7200,
        "input": {
            "prompt": spec.prompt,
            "parameters": {
                **spec.parameters,
                "placement": {
                    "provider": "local_pytorch",
                    "pricingModel": "on_demand",
                    "hardwareSkuId": "nvidia-rtx-5070-ti",
                    "hardwareDisplayName": "NVIDIA GeForce RTX 5070 Ti",
                    "bidMode": "fixed",
                    "bidUsdPerHour": 0,
                    "forecastedCostUsd": 0,
                    "forecastedExecutionMs": 120000,
                    "tokensPerSec": 40,
                    "interruptionRiskTier": "guaranteed",
                    "noticeWindowLabel": "Dedicated local process",
                    "rateEvidence": "provider-reported",
                    "throughputEvidence": "estimated",
                },
            },
        },
    }
    created = _request("POST", "/v1/jobs", payload, timeout=120.0)
    job_id = str(created.get("job_id") or created.get("id") or "")
    if not job_id:
        raise RuntimeError(f"submit missing job_id: {created}")
    return job_id


def _get_job(job_id: str) -> dict[str, Any]:
    return _request("GET", f"/v1/jobs/{job_id}", timeout=60.0)


def _process_next() -> dict[str, Any]:
    return _request(
        "POST",
        "/v1/worker/process-next",
        {"count": 1, "mode": "real"},
        timeout=float(PROCESS_TIMEOUT_SEC),
    )


def _wait_terminal(job_id: str, deadline: float) -> dict[str, Any]:
    """Poll job until terminal. Background worker (WORKER_ENABLED) drains the queue."""
    last: dict[str, Any] = {}
    while time.time() < deadline:
        last = _get_job(job_id)
        status = str(last.get("status") or "")
        if status in ("SUCCEEDED", "FAILED", "CANCELLED", "DEAD_LETTER"):
            return last
        time.sleep(POLL_SEC)
    return last


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--models", default="", help="Comma-separated model ids to include")
    parser.add_argument("--skip-models", default="", help="Comma-separated model ids to skip")
    parser.add_argument(
        "--resume-checkpoint",
        default="",
        help="Skip model ids that already have 2 SUCCEEDED rows in this checkpoint.jsonl",
    )
    parser.add_argument("--max-vram-gb", type=float, default=16.0)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    health = _request("GET", "/healthz", timeout=15.0)
    if str(health.get("inferenceMode") or "").lower() != "real":
        print(f"[warn] inferenceMode={health.get('inferenceMode')!r} (expected real)", flush=True)

    wanted = {m.strip() for m in args.models.split(",") if m.strip()}
    skipped = {m.strip() for m in args.skip_models.split(",") if m.strip()}
    if args.resume_checkpoint:
        succ_counts: dict[str, int] = {}
        cp = Path(args.resume_checkpoint)
        if cp.is_file():
            for line in cp.read_text(encoding="utf-8").splitlines():
                row = json.loads(line)
                if row.get("status") == "SUCCEEDED" and row.get("model_id"):
                    mid = str(row["model_id"])
                    succ_counts[mid] = succ_counts.get(mid, 0) + 1
            for mid, n in succ_counts.items():
                if n >= 2:
                    skipped.add(mid)
            print(
                json.dumps({"event": "resume_skip", "succeeded_counts": succ_counts, "skip": sorted(skipped)}),
                flush=True,
            )

    specs = [
        s
        for s in _catalog()
        if s.min_vram_gb <= args.max_vram_gb + 0.01
        and (not wanted or s.model_id in wanted)
        and s.model_id not in skipped
    ]
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%SZ")
    out_dir = ROOT / "benchmarks" / "results" / "runs" / f"{stamp}_ui_jobs_local"
    out_dir.mkdir(parents=True, exist_ok=True)
    print(
        json.dumps(
            {
                "event": "start",
                "tenant": TENANT_ID,
                "base_url": BASE_URL,
                "jobs": len(specs),
                "models": sorted({s.model_id for s in specs}),
                "out_dir": str(out_dir),
            }
        ),
        flush=True,
    )
    if args.dry_run:
        for s in specs:
            print(json.dumps({"dry_run": True, "model_id": s.model_id, "prompt": s.prompt[:80]}), flush=True)
        return 0

    rows: list[dict[str, Any]] = []
    for i, spec in enumerate(specs):
        print(f"[submit] {i + 1}/{len(specs)} {spec.model_id}", flush=True)
        try:
            job_id = _submit(spec)
            print(
                json.dumps(
                    {
                        "event": "submitted",
                        "job_id": job_id,
                        "model_id": spec.model_id,
                        "note": "waiting for WORKER_ENABLED background poller",
                    }
                ),
                flush=True,
            )
            job = _wait_terminal(job_id, time.time() + PROCESS_TIMEOUT_SEC)
            result_raw = job.get("result")
            result: dict[str, Any] = result_raw if isinstance(result_raw, dict) else {}
            meta_raw = result.get("metadata")
            meta: dict[str, Any] = meta_raw if isinstance(meta_raw, dict) else {}
            usage_raw = job.get("usage")
            usage: dict[str, Any] = usage_raw if isinstance(usage_raw, dict) else {}
            row = {
                "job_id": job_id,
                "model_id": spec.model_id,
                "purpose": spec.purpose,
                "status": job.get("status"),
                "duration_ms": job.get("duration_ms"),
                "tokens_in": usage.get("prompt_tokens"),
                "tokens_out": usage.get("completion_tokens"),
                "model_load_ms": meta.get("model_load_ms"),
                "inference_ms": meta.get("inference_ms"),
                "token_accounting": meta.get("token_accounting"),
                "production_weights": meta.get("production_weights"),
                "warm_start": meta.get("warm_start"),
                "error_code": job.get("error_code"),
                "error_message": job.get("error_message"),
                "ui_tenant": TENANT_ID,
            }
        except Exception as exc:
            row = {
                "model_id": spec.model_id,
                "purpose": spec.purpose,
                "status": "ERROR",
                "error_message": str(exc),
            }
        rows.append(row)
        with (out_dir / "checkpoint.jsonl").open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(row) + "\n")
        print(json.dumps({"event": "case_done", **row}), flush=True)

    summary: dict[str, int] = {
        "total": len(rows),
        "succeeded": sum(1 for r in rows if r.get("status") == "SUCCEEDED"),
        "failed": sum(1 for r in rows if r.get("status") not in ("SUCCEEDED",)),
    }
    report: dict[str, Any] = {
        "schema_version": "1.0.0",
        "benchmark_id": "ui-jobs-local",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "tenant_id": TENANT_ID,
        "measurement_mode": "measured",
        "provider": "local_pytorch",
        "routing_preference": "local/gpu",
        "results": rows,
        "summary": summary,
    }
    (out_dir / "report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    md = [
        f"# UI jobs local harness — {stamp}",
        "",
        f"- Tenant: **`{TENANT_ID}`** (open Jobs UI filtered to this tenant)",
        "- Provider: local_pytorch / local/gpu",
        f"- Succeeded: **{summary['succeeded']}/{summary['total']}**",
        "",
        "| Job | Model | Status | load_ms | inference_ms | in/out | accounting |",
        "|---|---|---|---:|---:|---|---|",
    ]
    for r in rows:
        md.append(
            "| `{jid}` | {model} | {status} | {load} | {inf} | {tin}/{tout} | {acct} |".format(
                jid=str(r.get("job_id") or "")[:8],
                model=r.get("model_id"),
                status=r.get("status"),
                load=r.get("model_load_ms"),
                inf=r.get("inference_ms") or r.get("duration_ms"),
                tin=r.get("tokens_in"),
                tout=r.get("tokens_out"),
                acct=r.get("token_accounting"),
            )
        )
    (out_dir / "report.md").write_text("\n".join(md) + "\n", encoding="utf-8")
    print(json.dumps({"event": "done", "report": str(out_dir / "report.json"), **summary}), flush=True)
    return 0 if summary["failed"] == 0 else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("interrupted", file=sys.stderr)
        raise SystemExit(130)
