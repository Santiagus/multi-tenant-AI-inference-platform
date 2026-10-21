#!/usr/bin/env python3
"""Run Tier 1 and Tier 2 Swagger UI inference examples with full production weights.

Submits all 10 representative platform workloads (SLMs, ViTs, LLMs, MMDiTs, 3D Video DiTs)
sequentially against the live Fastify control plane API and polls each asynchronous job
to completion, capturing hardware telemetry, latency metrics, and artifact URIs.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import threading
import time
import urllib.error
import urllib.request
from typing import Any

try:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(line_buffering=True)
except Exception:
    pass

DEFAULT_EXAMPLES: list[dict[str, Any]] = [
    {
        "tier": "Tier 1",
        "category": "text",
        "key": "tier1_cpu_tinyllama",
        "name": "TinyLlama-1.1B-Chat (SLM)",
        "payload": {
            "model_id": "TinyLlama/TinyLlama-1.1B-Chat-v1.0",
            "routing_preference": "local/cpu",
            "priority": 5,
            "max_retries": 3,
            "input": {
                "prompt": "Explain the difference between process and thread synchronization in modern operating systems.",
                "parameters": {
                    "use_production_weights": True,
                    "tier": 2,
                    "temperature": 0.7,
                    "max_new_tokens": 1024,
                },
            },
        },
    },
    {
        "tier": "Tier 1",
        "category": "image",
        "key": "tier1_cpu_clip",
        "name": "CLIP-ViT-L/14 Vision Transformer Encoder",
        "payload": {
            "model_id": "openai/clip-vit-large-patch14",
            "routing_preference": "local/cpu",
            "priority": 5,
            "max_retries": 3,
            "input": {
                "prompt": "Formula 1 driver Fernando Alonso wearing team racing suit and cap during Grand Prix weekend",
                "media_asset_uri": "tests/fixtures/media/fernando_alonso_f1.jpg",
                "parameters": {
                    "use_production_weights": True,
                    "tier": 2,
                    "max_new_tokens": 256,
                },
            },
            "input_uri": "s3://platform-artifacts/tenants/tenant-default/inputs/fernando_alonso_f1.jpg",
        },
    },
    {
        "tier": "Tier 2",
        "category": "text",
        "key": "tier2_gpu_llama3",
        "name": "Llama-3-8B-Instruct Enterprise LLM",
        "payload": {
            "model_id": "meta-llama/Llama-3-8B-Instruct",
            "routing_preference": "local/gpu",
            "priority": 5,
            "max_retries": 3,
            "input": {
                "prompt": "Compare Raft and Multi-Paxos consensus algorithms for distributed state machine replication.",
                "parameters": {
                    "use_production_weights": True,
                    "tier": 2,
                    "temperature": 0.7,
                    "max_new_tokens": 1024,
                },
            },
        },
    },
    {
        "tier": "Tier 2",
        "category": "text",
        "key": "tier2_gpu_qwen25_7b",
        "name": "Qwen2.5-7B-Instruct General & Coding LLM",
        "payload": {
            "model_id": "Qwen/Qwen2.5-7B-Instruct",
            "routing_preference": "local/gpu",
            "priority": 5,
            "max_retries": 3,
            "input": {
                "prompt": "Write an asynchronous Python worker pipeline that handles SQS backpressure and dead-letter queue redrive.",
                "parameters": {
                    "use_production_weights": True,
                    "tier": 2,
                    "temperature": 0.2,
                    "max_new_tokens": 1024,
                },
            },
        },
    },
    {
        "tier": "Tier 2",
        "category": "text",
        "key": "tier2_gpu_deepseek_r1",
        "name": "DeepSeek-R1-Distill-7B Reasoning LLM",
        "payload": {
            "model_id": "deepseek-ai/DeepSeek-R1-Distill-Qwen-7B",
            "routing_preference": "local/gpu",
            "priority": 5,
            "max_retries": 3,
            "input": {
                "prompt": "Summarize the 3 core advantages of asynchronous queue-based architectures for AI inference in 3 concise bullet points.",
                "parameters": {
                    "use_production_weights": True,
                    "tier": 2,
                    "temperature": 0.6,
                    "max_new_tokens": 512,
                },
            },
        },
    },
    {
        "tier": "Tier 2",
        "category": "image",
        "key": "tier2_gpu_flux",
        "name": "FLUX.1-schnell Text-to-Image MMDiT",
        "payload": {
            "model_id": "black-forest-labs/FLUX.1-schnell",
            "routing_preference": "local/gpu",
            "priority": 6,
            "max_retries": 3,
            "input": {
                "prompt": "Cinematic wide-angle 8k photograph of a futuristic AI inference datacenter server hall, volumetric atmospheric haze.",
                "parameters": {
                    "use_production_weights": True,
                    "tier": 2,
                    "num_inference_steps": 4,
                    "guidance_scale": 7.5,
                    "width": 1024,
                    "height": 1024,
                },
            },
        },
    },
    {
        "tier": "Tier 2",
        "category": "image",
        "key": "tier2_gpu_sd35",
        "name": "SD-3.5-medium Text-to-Image Diffusion",
        "payload": {
            "model_id": "stabilityai/stable-diffusion-3.5-medium",
            "routing_preference": "local/gpu",
            "priority": 6,
            "max_retries": 3,
            "input": {
                "prompt": "A cute golden retriever puppy wearing a bright red aviator jacket, sitting on fresh green lawn grass in daylight, sharp focus, professional photography.",
                "parameters": {
                    "use_production_weights": True,
                    "tier": 2,
                    "num_inference_steps": 4,
                    "guidance_scale": 0.0,
                    "width": 512,
                    "height": 512,
                },
            },
        },
    },
    {
        "tier": "Tier 2",
        "category": "image",
        "key": "tier2_gpu_qwen_vl",
        "name": "Qwen2.5-VL-7B Multimodal Vision-Language",
        "payload": {
            "model_id": "Qwen/Qwen2.5-VL-7B-Instruct",
            "routing_preference": "local/gpu",
            "priority": 5,
            "max_retries": 3,
            "input": {
                "prompt": "Analyze this photo of Formula 1 driver Fernando Alonso. Identify the driver, team racing kit, sponsor branding, physical stance, and paddock environment.",
                "media_asset_uri": "tests/fixtures/media/fernando_alonso_f1.jpg",
                "parameters": {
                    "use_production_weights": True,
                    "tier": 2,
                    "temperature": 0.2,
                    "max_new_tokens": 1024,
                },
            },
            "input_uri": "s3://platform-artifacts/tenants/tenant-default/inputs/fernando_alonso_f1.jpg",
        },
    },
    {
        "tier": "Tier 2",
        "category": "video",
        "key": "tier2_gpu_wan_video",
        "name": "Wan2.1-T2V-1.3B 3D Video DiT",
        "payload": {
            "model_id": "Wan-AI/Wan2.1-T2V-1.3B",
            "routing_preference": "local/gpu",
            "priority": 7,
            "max_retries": 3,
            "input": {
                "prompt": "Video-to-Video weather transformation: Convert lush green summer forest into a severe winter blizzard, applying dynamic multi-layered falling snow, frosted icy vegetation, and cold atmospheric winter mist while preserving camera motion.",
                "media_asset_uri": "tests/fixtures/media/sample_bunny_clip.mp4",
                "parameters": {
                    "use_production_weights": True,
                    "tier": 2,
                    "denoising_steps": 4,
                    "fps": 24,
                },
            },
            "input_uri": "s3://platform-artifacts/tenants/tenant-default/inputs/sample_bunny_clip.mp4",
        },
    },
    {
        "tier": "Tier 2",
        "category": "video",
        "key": "tier2_gpu_cogvideox",
        "name": "CogVideoX-2b 3D Video DiT",
        "payload": {
            "model_id": "THUDM/CogVideoX-2b",
            "routing_preference": "local/gpu",
            "priority": 7,
            "max_retries": 3,
            "input": {
                "prompt": "High-definition drone flythrough of a solar power farm in the desert during golden hour.",
                "parameters": {
                    "use_production_weights": True,
                    "tier": 2,
                    "denoising_steps": 6,
                    "fps": 24,
                },
            },
        },
    },
]


def _format_media_links(r: dict[str, Any]) -> str:
    """Format clickable download URLs for generated media (image, video, poster)."""
    if r.get("status") not in ("SUCCEEDED", "SUCCESS"):
        return "-"

    img_url = r.get("img_uri") or r.get("image_uri")
    video_url = r.get("video_output_uri") or r.get("video_uri")
    poster_url = r.get("poster_uri")

    # If missing, inspect artifacts in r["data"]
    data = r.get("data")
    if isinstance(data, dict):
        artifacts = data.get("artifacts") or []
        for art in artifacts:
            name = (art.get("name") or "").lower()
            url = art.get("download_url") or art.get("uri") or art.get("url")
            if not url:
                continue
            if not img_url and name in ("output_image", "image", "img", "img_uri", "image_uri"):
                img_url = url
            elif not video_url and name in ("output_video", "video", "video_uri", "video_output"):
                video_url = url
            elif not poster_url and name in ("output_poster", "poster", "poster_uri"):
                poster_url = url

    def _normalize_url(u: str) -> str:
        s = str(u).strip()
        if s.startswith("s3://"):
            s3_base = os.environ.get("S3_PUBLIC_ENDPOINT", "http://localhost:9000")
            rel_path = s[len("s3://") :]
            return f"{s3_base}/{rel_path}"
        return s

    parts: list[str] = []
    if video_url:
        parts.append(f"video: {_normalize_url(video_url)}")
    if poster_url:
        parts.append(f"poster: {_normalize_url(poster_url)}")
    if img_url:
        parts.append(_normalize_url(img_url))

    return "  ".join(parts) if parts else "-"


def execute_examples(
    base_url: str = "http://localhost:3000",
    api_key: str = "dev-secret-key",
    tenant_id: str = "tenant-default",
    timeout_seconds: int = 180,
    output_json_path: str | None = None,
    filter_key: str | None = None,
    img_video_only: bool = False,
    image_only: bool = False,
    video_only: bool = False,
    modality: str | None = None,
    dry_run: bool = False,
    poll_interval: float = 5.0,
    refresh_interval: float | None = None,
) -> int:
    """Submit each workload example, poll to completion, and report metrics."""
    if refresh_interval is not None:
        poll_interval = refresh_interval
    headers = {
        "Content-Type": "application/json",
        "x-tenant-id": tenant_id,
        "Authorization": f"Bearer {api_key}",
    }

    selected_examples = list(DEFAULT_EXAMPLES)

    if img_video_only:
        selected_examples = [ex for ex in selected_examples if ex.get("category") in ("image", "video")]

    if image_only:
        selected_examples = [ex for ex in selected_examples if ex.get("category") == "image"]

    if video_only:
        selected_examples = [ex for ex in selected_examples if ex.get("category") == "video"]

    if modality:
        allowed_modalities = {
            m.strip().lower()
            for token in modality.replace("/", ",").split(",")
            for m in (
                ["image", "video"]
                if token.strip().lower() in ("media", "img-video", "img/video", "image-video", "img_video")
                else [token.strip().lower()]
            )
            if m
        }
        if "img" in allowed_modalities:
            allowed_modalities.add("image")
        if "vid" in allowed_modalities:
            allowed_modalities.add("video")
        selected_examples = [ex for ex in selected_examples if ex.get("category", "").lower() in allowed_modalities]

    if filter_key:
        fk = filter_key.strip().lower()
        if fk in ("media", "img/video", "image/video", "img-video", "image-video", "img_video", "image_video"):
            selected_examples = [ex for ex in selected_examples if ex.get("category") in ("image", "video")]
        elif fk in ("img", "image", "images"):
            selected_examples = [ex for ex in selected_examples if ex.get("category") == "image"]
        elif fk in ("vid", "video", "videos"):
            selected_examples = [ex for ex in selected_examples if ex.get("category") == "video"]
        elif fk in ("text", "slm", "llm"):
            selected_examples = [ex for ex in selected_examples if ex.get("category") == "text"]
        else:
            selected_examples = [
                ex
                for ex in selected_examples
                if fk in ex["key"].lower()
                or fk in ex["tier"].lower()
                or fk in ex["name"].lower()
                or fk in ex.get("category", "").lower()
            ]

    if not selected_examples:
        sys.stderr.write("No examples matched the specified filter criteria\n")
        return 1

    if dry_run:
        dry_header = f"{'Tier':<8} | {'Category':<8} | {'Model Name':<45} | {'Key'}"
        dry_width = max(80, len(dry_header) + 25)
        print("=" * dry_width)
        print("Multi-Tenant AI Inference Platform: Production Examples Runner (DRY RUN)")
        print(f"Total Workloads Matched: {len(selected_examples)}")
        print("=" * dry_width)
        print(dry_header)
        print("-" * dry_width)
        for item in selected_examples:
            cat = item.get("category", "text")
            print(f"{item['tier']:<8} | {cat:<8} | {item['name']:<45} | {item['key']}")
        print("=" * dry_width)
        return 0

    terminal_statuses = {"SUCCEEDED", "FAILED", "DEAD_LETTER", "CANCELLED"}
    results: list[dict[str, Any]] = []
    failures = 0

    print("=" * 80)
    print("Multi-Tenant AI Inference Platform: Production Examples Runner")
    print(f"Base URL: {base_url} | Tenant: {tenant_id} | Total Workloads: {len(selected_examples)}")
    print("=" * 80)

    for item in selected_examples:
        category_str = item.get("category", "text").upper()
        print(f"\n[{item['tier']} | {category_str}] Submitting: {item['name']} ({item['key']})", flush=True)
        req = urllib.request.Request(
            f"{base_url}/v1/jobs",
            data=json.dumps(item["payload"]).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        try:
            with urllib.request.urlopen(req) as resp:
                submit_data = json.loads(resp.read().decode("utf-8"))
        except Exception as exc:
            sys.stderr.write(f"  FAILED to submit job for {item['name']}: {exc}\n")
            failures += 1
            results.append(
                {
                    "tier": item["tier"],
                    "category": item.get("category", "text"),
                    "key": item["key"],
                    "name": item["name"],
                    "status": "SUBMIT_FAILED",
                    "error": str(exc),
                }
            )
            continue

        job_id = submit_data["job_id"]
        print(f"  -> Job ID: {job_id}", flush=True)

        start_t = time.time()

        # Trigger processing in background thread in case background worker daemon is disabled,
        # allowing the main thread to immediately begin polling and printing status every refresh interval.
        def _trigger_worker() -> None:
            try:
                pnext_req = urllib.request.Request(
                    f"{base_url}/v1/worker/process-next",
                    data=b"{}",
                    headers=headers,
                    method="POST",
                )
                with urllib.request.urlopen(pnext_req, timeout=timeout_seconds):
                    pass
            except Exception:
                pass

        worker_thread = threading.Thread(target=_trigger_worker, daemon=True)
        worker_thread.start()

        poll_count = 0
        final_job_data: dict[str, Any] = {}

        while True:
            poll_count += 1
            elapsed = round(time.time() - start_t, 1)

            poll_req = urllib.request.Request(
                f"{base_url}/v1/jobs/{job_id}",
                headers=headers,
                method="GET",
            )
            try:
                with urllib.request.urlopen(poll_req) as resp:
                    final_job_data = json.loads(resp.read().decode("utf-8"))
            except Exception as poll_err:
                print(f"     [{elapsed}s] Poll #{poll_count} error: {poll_err}", flush=True)
                time.sleep(poll_interval)
                continue

            status = final_job_data.get("status")
            progress = final_job_data.get("progress_pct", 0)
            phase = (final_job_data.get("progress") or {}).get("phase", "queued")
            print(
                f"     [{elapsed}s] Poll #{poll_count}: status={status}, progress={progress}%, phase={phase}",
                flush=True,
            )

            if status in terminal_statuses:
                is_success = status == "SUCCEEDED"
                if not is_success:
                    failures += 1

                payload_input = item.get("payload", {}).get("input") or {}
                prompt = (
                    payload_input.get("prompt")
                    or item.get("payload", {}).get("prompt")
                    or (final_job_data.get("input") or {}).get("prompt")
                )
                media_asset_uri = (
                    payload_input.get("media_asset_uri")
                    or item.get("payload", {}).get("media_asset_uri")
                    or item.get("payload", {}).get("input_uri")
                    or final_job_data.get("media_asset_uri")
                )

                output_text = None
                result_obj = final_job_data.get("result")
                if isinstance(result_obj, dict):
                    output_text = result_obj.get("output_text")
                if not output_text:
                    output_text = final_job_data.get("output_text")

                artifacts = final_job_data.get("artifacts") or []
                poster_uri: str | None = None
                video_output_uri: str | None = None
                img_uri: str | None = None

                for art in artifacts:
                    art_name = (art.get("name") or "").lower()
                    url = art.get("download_url") or art.get("uri") or art.get("url")
                    if not url:
                        continue
                    if art_name in ("output_poster", "poster", "poster_uri"):
                        poster_uri = url
                    elif art_name in ("output_video", "video", "video_uri", "video_output"):
                        video_output_uri = url
                    elif art_name in ("output_image", "image", "img", "img_uri", "image_uri"):
                        img_uri = url

                if not poster_uri:
                    poster_uri = (
                        final_job_data.get("poster_uri")
                        or (isinstance(result_obj, dict) and result_obj.get("poster_uri"))
                        or None
                    )
                if not video_output_uri:
                    video_output_uri = (
                        final_job_data.get("video_output_uri")
                        or (isinstance(result_obj, dict) and result_obj.get("video_output_uri"))
                        or final_job_data.get("video_uri")
                        or None
                    )
                if not img_uri:
                    img_uri = (
                        final_job_data.get("img_uri")
                        or (isinstance(result_obj, dict) and result_obj.get("img_uri"))
                        or final_job_data.get("image_uri")
                        or None
                    )

                model_id_str = str(item.get("payload", {}).get("model_id", "")).lower()
                is_image_gen = any(k in model_id_str for k in ("flux", "stable-diffusion", "sd35", "sd-turbo", "t2i"))
                is_video_gen = any(k in model_id_str for k in ("wan", "cogvideo", "t2v", "v2v", "video"))

                s3_poster_uri = None
                s3_video_uri = None
                s3_img_uri = None

                if is_success:
                    if is_video_gen or poster_uri or video_output_uri:
                        s3_poster_uri = f"s3://platform-artifacts/tenants/{tenant_id}/outputs/{job_id}/poster.png"
                        s3_video_uri = f"s3://platform-artifacts/tenants/{tenant_id}/outputs/{job_id}/output.mp4"
                        if not poster_uri:
                            poster_uri = s3_poster_uri
                        if not video_output_uri:
                            video_output_uri = s3_video_uri
                    if is_image_gen or (img_uri and ("output.png" in str(img_uri) or is_image_gen)):
                        s3_img_uri = f"s3://platform-artifacts/tenants/{tenant_id}/outputs/{job_id}/output.png"
                        if not img_uri:
                            img_uri = s3_img_uri

                print(f"  -> Job Finished ({status} in {elapsed}s):")
                if prompt:
                    print(f"     Prompt: {prompt}")
                if media_asset_uri:
                    print(f"     Media Asset URI: {media_asset_uri}")
                if output_text:
                    output_text_str = str(output_text).strip()
                    if "\n" in output_text_str:
                        print(f"     Output Text:\n{output_text_str}")
                    else:
                        print(f"     Output Text: {output_text_str}")
                if poster_uri:
                    disp_poster = poster_uri
                    if disp_poster.startswith("s3://"):
                        s3_base = os.environ.get("S3_PUBLIC_ENDPOINT", "http://localhost:9000")
                        disp_poster = f"{s3_base}/{disp_poster[len('s3://') :]}"
                    print(f"     Poster URI: {disp_poster}")
                if video_output_uri:
                    disp_video = video_output_uri
                    if disp_video.startswith("s3://"):
                        s3_base = os.environ.get("S3_PUBLIC_ENDPOINT", "http://localhost:9000")
                        disp_video = f"{s3_base}/{disp_video[len('s3://') :]}"
                    print(f"     Video Output URI: {disp_video}")
                if img_uri:
                    disp_img = img_uri
                    if disp_img.startswith("s3://"):
                        s3_base = os.environ.get("S3_PUBLIC_ENDPOINT", "http://localhost:9000")
                        disp_img = f"{s3_base}/{disp_img[len('s3://') :]}"
                    print(f"     Img URI: {disp_img}")

                result_entry: dict[str, Any] = {
                    "tier": item["tier"],
                    "category": item.get("category", "text"),
                    "key": item["key"],
                    "name": item["name"],
                    "job_id": job_id,
                    "status": status,
                    "elapsed_seconds": elapsed,
                }
                if prompt:
                    result_entry["prompt"] = prompt
                if media_asset_uri:
                    result_entry["media_asset_uri"] = media_asset_uri
                if output_text:
                    result_entry["output_text"] = output_text
                if poster_uri:
                    result_entry["poster_uri"] = poster_uri
                if video_output_uri:
                    result_entry["video_output_uri"] = video_output_uri
                if img_uri:
                    result_entry["img_uri"] = img_uri
                result_entry["data"] = final_job_data
                results.append(result_entry)
                break

            if elapsed > timeout_seconds:
                print(f"     TIMEOUT waiting for job {job_id} after {elapsed}s")
                failures += 1
                payload_input = item.get("payload", {}).get("input") or {}
                prompt = payload_input.get("prompt") or item.get("payload", {}).get("prompt")
                media_asset_uri = (
                    payload_input.get("media_asset_uri")
                    or item.get("payload", {}).get("media_asset_uri")
                    or item.get("payload", {}).get("input_uri")
                )
                timeout_entry: dict[str, Any] = {
                    "tier": item["tier"],
                    "category": item.get("category", "text"),
                    "key": item["key"],
                    "name": item["name"],
                    "job_id": job_id,
                    "status": "TIMEOUT",
                    "elapsed_seconds": elapsed,
                    "data": final_job_data,
                }
                if prompt:
                    timeout_entry["prompt"] = prompt
                if media_asset_uri:
                    timeout_entry["media_asset_uri"] = media_asset_uri
                results.append(timeout_entry)
                # Attempt to cancel timed out job so it does not block the single worker queue
                try:
                    cancel_req = urllib.request.Request(
                        f"{base_url}/v1/jobs/{job_id}/cancel",
                        headers=headers,
                        method="POST",
                    )
                    with urllib.request.urlopen(cancel_req):
                        pass
                except Exception:
                    pass
                break

            # Re-trigger worker if job transitioned to QUEUED or RETRYING and background thread finished
            if not worker_thread.is_alive() and status in ("QUEUED", "RETRYING"):
                worker_thread = threading.Thread(target=_trigger_worker, daemon=True)
                worker_thread.start()

            time.sleep(poll_interval)

        if worker_thread.is_alive():
            worker_thread.join(timeout=1.0)

    if output_json_path:
        with open(output_json_path, "w", encoding="utf-8") as f:
            json.dump(results, f, indent=2)
        print(f"\nSaved detailed execution results to: {output_json_path}")

    summary_header = f"{'Tier':<8} | {'Category':<8} | {'Model Name':<45} | {'Status':<9} | {'Elapsed':<7} | {'Job ID':<36} | {'Outputs'}"
    summary_sep = "=" * 140
    summary_div = "-" * 140

    print("\n" + summary_sep)
    print("EXECUTION RUN COMPLETE. SUMMARY TABLE:")
    print(summary_sep)
    print(summary_header)
    print(summary_div)
    for r in results:
        status_str = r["status"]
        cat_str = r.get("category", "text")
        elapsed_str = f"{r.get('elapsed_seconds', 0.0)}s"
        jid = r.get("job_id", "N/A")
        outputs_str = _format_media_links(r)
        print(
            f"{r['tier']:<8} | {cat_str:<8} | {r['name']:<45} | {status_str:<9} | {elapsed_str:<7} | {jid:<36} | {outputs_str}"
        )
    print(summary_sep)

    return 0 if failures == 0 else 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Execute Tier 1 and Tier 2 Swagger UI inference examples with full production weights."
    )
    parser.add_argument(
        "--base-url",
        type=str,
        default=os.environ.get("BASE_URL", "http://localhost:3000"),
        help="Fastify API base URL (default: http://localhost:3000)",
    )
    parser.add_argument(
        "--api-key",
        type=str,
        default=os.environ.get("API_KEY", "dev-secret-key"),
        help="API Key for Authorization header (default: dev-secret-key)",
    )
    parser.add_argument(
        "--tenant-id",
        type=str,
        default=os.environ.get("DEFAULT_TENANT_ID", "tenant-default"),
        help="Tenant identifier for multi-tenant isolation (default: tenant-default)",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=600,
        help="Maximum timeout seconds per inference workload (default: 600)",
    )
    parser.add_argument(
        "--output-json",
        type=str,
        default=None,
        help="Optional path to persist full structured JSON result envelopes",
    )
    parser.add_argument(
        "--img-video",
        "--media",
        "--media-only",
        dest="img_video_only",
        action="store_true",
        help="Run only image and video related examples (CLIP, FLUX, SD-3.5, Qwen2.5-VL, Wan2.1, CogVideoX)",
    )
    parser.add_argument(
        "--image-only",
        "--img",
        dest="image_only",
        action="store_true",
        help="Run only image related examples (CLIP, FLUX, SD-3.5, Qwen2.5-VL)",
    )
    parser.add_argument(
        "--video-only",
        "--video",
        dest="video_only",
        action="store_true",
        help="Run only video related examples (Wan2.1, CogVideoX)",
    )
    parser.add_argument(
        "--modality",
        type=str,
        default=None,
        help="Filter by modality/category (e.g. 'image', 'video', 'text', 'media', or 'image,video')",
    )
    parser.add_argument(
        "--filter",
        type=str,
        default=None,
        help="Filter by example key, Tier, or modality (e.g. tier1_cpu_tinyllama, Tier 1, media, image, video)",
    )
    parser.add_argument(
        "--poll-interval",
        "--refresh-interval",
        dest="poll_interval",
        type=float,
        default=float(os.environ.get("POLL_INTERVAL", os.environ.get("REFRESH_INTERVAL", "5.0"))),
        help="Polling / refresh interval in seconds for tracking job status (default: 5.0)",
    )
    parser.add_argument(
        "--list",
        "--dry-run",
        dest="dry_run",
        action="store_true",
        help="List matched examples without submitting jobs",
    )
    args = parser.parse_args(argv)

    return execute_examples(
        base_url=args.base_url,
        api_key=args.api_key,
        tenant_id=args.tenant_id,
        timeout_seconds=args.timeout,
        output_json_path=args.output_json,
        filter_key=args.filter,
        img_video_only=args.img_video_only,
        image_only=args.image_only,
        video_only=args.video_only,
        modality=args.modality,
        dry_run=args.dry_run,
        poll_interval=args.poll_interval,
        refresh_interval=args.poll_interval,
    )


if __name__ == "__main__":
    raise SystemExit(main())
