#!/usr/bin/env python3
"""Cross-provider same-job probe for cold/warm start, load, runtime, and cost.

Enterprise FinOps harness (M12):
- Submits the *same* canonical job to every selected provider.
- Captures cold vs warm latency, optional concurrency load, tokens, and unit cost.
- Emits cheapest / fastest / balanced / recommended picks for routing decisions.
- Writes dated evidence under benchmarks/results/runs/ with explicit evidence labels.

Modes:
  simulate  Offline deterministic profiles (CI-safe, labeled `simulated`)
  api       Live control-plane jobs + process-next (labeled `measured` when successful;
            catalog-only providers without adapters fall back to `estimated`)

Examples:
  .venv/bin/python benchmarks/run_provider_comparison.py
  .venv/bin/python benchmarks/run_provider_comparison.py --mode api --base-url http://localhost:3000
  .venv/bin/python benchmarks/run_provider_comparison.py --providers local_pytorch,runpod,vast_ai
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from benchmarks.provider_comparison import (
    CANONICAL_MAX_NEW_TOKENS,
    CANONICAL_PROMPT,
    PROVIDER_MATRIX,
    ProbeSample,
    ProviderRollup,
    estimate_prompt_tokens,
    pick_recommendations,
    rollup_provider,
    rollup_to_dict,
    select_profiles,
    simulate_provider_samples,
)


def _utc_stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%SZ")


def http_json(
    url: str,
    *,
    method: str = "GET",
    headers: dict[str, str] | None = None,
    payload: dict[str, Any] | None = None,
    timeout: float = 60.0,
) -> tuple[int, dict[str, Any], float]:
    req_headers = dict(headers or {})
    data = None
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        req_headers.setdefault("Content-Type", "application/json")
    req = urllib.request.Request(url, data=data, headers=req_headers, method=method)
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            body = json.loads(res.read().decode("utf-8") or "{}")
            return res.status, body, (time.perf_counter() - t0) * 1000.0
    except urllib.error.HTTPError as exc:
        try:
            body = json.loads(exc.read().decode("utf-8") or "{}")
        except Exception:
            body = {"error": str(exc)}
        return exc.code, body, (time.perf_counter() - t0) * 1000.0
    except Exception as exc:
        return 503, {"error": str(exc)}, (time.perf_counter() - t0) * 1000.0


def submit_and_await_job(
    *,
    base_url: str,
    tenant_id: str,
    api_key: str,
    profile: dict[str, Any],
    prompt: str,
    max_new_tokens: int,
    warm_state: str,
    concurrency_tag: int,
    poll_timeout_s: float,
) -> ProbeSample:
    headers = {
        "x-tenant-id": tenant_id,
        "x-api-key": api_key,
        "Authorization": f"Bearer {api_key}",
    }
    params = {
        **dict(profile.get("parameters") or {}),
        "max_new_tokens": max_new_tokens,
        "provider_comparison_probe": True,
        "warm_state": warm_state,
        "concurrency_tag": concurrency_tag,
    }
    body = {
        "model_id": "meta-llama/Llama-3-8B-Instruct",
        "routing_preference": profile["routing_preference"],
        "priority": 5,
        "max_retries": 1,
        "input": {"prompt": prompt, "parameters": params},
        "parameters": params,
    }

    submit_t0 = time.perf_counter()
    status, submit_body, _ = http_json(
        f"{base_url.rstrip('/')}/v1/jobs",
        method="POST",
        headers=headers,
        payload=body,
        timeout=30.0,
    )
    if status >= 400 or not submit_body.get("job_id"):
        return ProbeSample(
            provider=profile["id"],
            warm_state=warm_state,  # type: ignore[arg-type]
            concurrency=concurrency_tag,
            e2e_latency_ms=0.0,
            queue_wait_ms=0.0,
            inference_ms=0.0,
            cold_start_ms=0.0,
            ttft_ms=None,
            tokens_in=0,
            tokens_out=0,
            tokens_per_sec=0.0,
            cost_usd=0.0,
            cost_microcents=0,
            hardware=str(profile["hardware"]),
            job_id=None,
            evidence="measured",
            ok=False,
            error=f"submit failed status={status} body={submit_body}",
        )

    job_id = str(submit_body["job_id"])
    # Kick the local worker loop (compose / host API).
    http_json(
        f"{base_url.rstrip('/')}/v1/worker/process-next",
        method="POST",
        headers=headers,
        payload={"count": 1},
        timeout=120.0,
    )

    deadline = time.perf_counter() + poll_timeout_s
    job: dict[str, Any] = {}
    while time.perf_counter() < deadline:
        st, job, _ = http_json(
            f"{base_url.rstrip('/')}/v1/jobs/{job_id}",
            method="GET",
            headers=headers,
            timeout=30.0,
        )
        if st < 400 and job.get("status") in {"SUCCEEDED", "FAILED", "CANCELLED"}:
            break
        # Keep draining the queue for other concurrent probes.
        http_json(
            f"{base_url.rstrip('/')}/v1/worker/process-next",
            method="POST",
            headers=headers,
            payload={"count": 2},
            timeout=120.0,
        )
        time.sleep(0.35)

    e2e_ms = (time.perf_counter() - submit_t0) * 1000.0
    if job.get("status") != "SUCCEEDED":
        return ProbeSample(
            provider=profile["id"],
            warm_state=warm_state,  # type: ignore[arg-type]
            concurrency=concurrency_tag,
            e2e_latency_ms=round(e2e_ms, 3),
            queue_wait_ms=0.0,
            inference_ms=float(job.get("duration_ms") or 0.0),
            cold_start_ms=0.0,
            ttft_ms=None,
            tokens_in=int(job.get("tokens_in") or 0),
            tokens_out=int(job.get("tokens_out") or 0),
            tokens_per_sec=0.0,
            cost_usd=0.0,
            cost_microcents=int(job.get("cost_microcents") or 0),
            hardware=str(profile["hardware"]),
            job_id=job_id,
            evidence="measured",
            ok=False,
            error=f"terminal status={job.get('status')} error={job.get('error_message')}",
        )

    result = job.get("result") or {}
    metadata = {}
    if isinstance(result, dict):
        metadata = result.get("metadata") if isinstance(result.get("metadata"), dict) else result

    inference_ms = float(job.get("duration_ms") or metadata.get("compute_duration_ms") or e2e_ms)
    queue_wait = max(0.0, e2e_ms - inference_ms)
    warm_flag = bool(metadata.get("warm_start")) if "warm_start" in metadata else warm_state == "warm"
    model_load = float(metadata.get("model_load_ms") or metadata.get("serverless_cold_start_ms") or 0.0)
    cold_start = model_load if (warm_state == "cold" or not warm_flag) else 0.0
    ttft = metadata.get("ttft_ms")
    tokens_in = int(job.get("tokens_in") or metadata.get("prompt_tokens") or estimate_prompt_tokens(prompt))
    tokens_out = int(job.get("tokens_out") or metadata.get("completion_tokens") or max_new_tokens)
    tps = float(metadata.get("tokens_per_sec") or 0.0)
    if tps <= 0 and inference_ms > 0:
        tps = (tokens_out / inference_ms) * 1000.0
    cost_uc = int(job.get("cost_microcents") or 0)
    cost_usd = cost_uc / 100_000_000.0
    hw = str(metadata.get("hardware") or metadata.get("device_name") or profile["hardware"])

    return ProbeSample(
        provider=str(job.get("provider") or profile["id"]),
        warm_state=warm_state,  # type: ignore[arg-type]
        concurrency=concurrency_tag,
        e2e_latency_ms=round(e2e_ms, 3),
        queue_wait_ms=round(queue_wait, 3),
        inference_ms=round(inference_ms, 3),
        cold_start_ms=round(cold_start, 3),
        ttft_ms=float(ttft) if ttft is not None else None,
        tokens_in=tokens_in,
        tokens_out=tokens_out,
        tokens_per_sec=round(tps, 3),
        cost_usd=round(cost_usd, 8),
        cost_microcents=cost_uc,
        hardware=hw,
        job_id=job_id,
        evidence="measured",
        ok=True,
        notes="Control-plane job probe",
    )


def probe_provider_api(
    profile: dict[str, Any],
    *,
    base_url: str,
    tenant_id: str,
    api_key: str,
    prompt: str,
    max_new_tokens: int,
    load_concurrency: int,
    poll_timeout_s: float,
    estimate_if_no_adapter: bool,
) -> list[ProbeSample]:
    if not profile.get("has_live_adapter"):
        if not estimate_if_no_adapter:
            return []
        # Estimated fallback so FinOps panels still get a comparable row.
        samples = simulate_provider_samples(
            profile, prompt=prompt, max_new_tokens=max_new_tokens, load_concurrency=load_concurrency
        )
        for s in samples:
            s.evidence = "estimated"
            s.notes = (
                "No live worker adapter registered; estimated from characteristic FinOps profile "
                "(not a measured control-plane run)."
            )
        return samples

    samples: list[ProbeSample] = []
    # Cold then warm sequential on the same provider.
    for warm_state in ("cold", "warm"):
        samples.append(
            submit_and_await_job(
                base_url=base_url,
                tenant_id=tenant_id,
                api_key=api_key,
                profile=profile,
                prompt=prompt,
                max_new_tokens=max_new_tokens,
                warm_state=warm_state,
                concurrency_tag=1,
                poll_timeout_s=poll_timeout_s,
            )
        )

    # Load: fan-out concurrent identical jobs (warm path).
    if load_concurrency > 1:
        with ThreadPoolExecutor(max_workers=load_concurrency) as pool:
            futures = [
                pool.submit(
                    submit_and_await_job,
                    base_url=base_url,
                    tenant_id=tenant_id,
                    api_key=api_key,
                    profile=profile,
                    prompt=prompt,
                    max_new_tokens=max_new_tokens,
                    warm_state="warm",
                    concurrency_tag=load_concurrency,
                    poll_timeout_s=poll_timeout_s,
                )
                for _ in range(load_concurrency)
            ]
            for fut in as_completed(futures):
                samples.append(fut.result())
    return samples


def render_markdown(report: dict[str, Any]) -> str:
    picks = report["recommendations"]
    lines = [
        "# Cross-Provider Same-Job Comparison",
        "",
        f"- Run ID: `{report['run_id']}`",
        f"- Mode: `{report['mode']}`",
        f"- Model: `{report['model_id']}`",
        f"- Prompt tokens (est.): `{report['prompt_tokens']}` · max_new_tokens: `{report['max_new_tokens']}`",
        "- Workload: identical canonical prompt across all providers",
        "",
        "## Recommendations",
        "",
        "| Pick | Provider | Hardware | Warm p50 (ms) | Cold penalty (ms) | Cost $/job | Evidence |",
        "|---|---|---|---:|---:|---:|---|",
    ]
    for key in ("cheapest", "fastest", "balanced", "recommended"):
        p = picks.get(key) or {}
        if not p:
            continue
        lines.append(
            f"| {key} | `{p.get('provider')}` | {p.get('hardware')} | "
            f"{p.get('warm_e2e_p50_ms')} | {p.get('cold_start_penalty_ms')} | "
            f"{p.get('cost_usd_per_job')} | {p.get('evidence')} |"
        )
    lines.extend(["", f"_{picks.get('analysis_note', '')}_", "", "## Provider rollup", ""])
    lines.append("| Provider | Cold p50 | Warm p50 | Cold start | Load p95 | tok/s | $/job | $/1M tok | Evidence |")
    lines.append("|---|---:|---:|---:|---:|---:|---:|---:|---|")
    for r in report["providers"]:
        lines.append(
            f"| `{r['provider']}` | {r['cold_e2e_p50_ms']} | {r['warm_e2e_p50_ms']} | "
            f"{r['cold_start_penalty_ms']} | {r['load_p95_ms'] if r['load_p95_ms'] is not None else '—'} | "
            f"{r['tokens_per_sec_warm']} | {r['cost_usd_per_job']} | {r['cost_per_1m_tokens_usd']} | "
            f"{r['evidence']} |"
        )
    lines.extend(
        [
            "",
            "## Methodology",
            "",
            "1. Submit the same prompt + max_new_tokens to each provider.",
            "2. Capture a cold sample, then a warm sample (concurrency=1).",
            "3. Optionally fan-out concurrent warm jobs for load p95.",
            "4. Rank cheapest (min $/job), fastest (min warm p50), balanced (0.5·norm cost + 0.5·norm latency).",
            "5. Label every number as measured, estimated, simulated, or provider-reported.",
            "",
        ]
    )
    return "\n".join(lines) + "\n"


def update_ledgers(output_dir: Path, report: dict[str, Any]) -> dict[str, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    run_dir = output_dir / "runs" / report["run_id"]
    run_dir.mkdir(parents=True, exist_ok=True)
    run_json = run_dir / "report.json"
    run_md = run_dir / "report.md"
    run_json.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    run_md.write_text(render_markdown(report), encoding="utf-8")

    latest_json = output_dir / "provider_comparison.json"
    latest_md = output_dir / "provider_comparison.md"
    latest_json.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    latest_md.write_text(render_markdown(report), encoding="utf-8")

    history = output_dir / "provider_comparison_history.jsonl"
    with history.open("a", encoding="utf-8") as fh:
        fh.write(
            json.dumps(
                {
                    "run_id": report["run_id"],
                    "generated_at": report["generated_at"],
                    "mode": report["mode"],
                    "recommendations": report["recommendations"],
                    "provider_count": len(report["providers"]),
                }
            )
            + "\n"
        )

    # Patch manifest with a lightweight pointer (do not rewrite entire inference history).
    manifest_path = output_dir / "manifest.json"
    manifest: dict[str, Any]
    if manifest_path.exists():
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            manifest = {"schema_version": "1.0.0", "runs": []}
    else:
        manifest = {"schema_version": "1.0.0", "runs": []}
    manifest["provider_comparison_latest"] = {
        "run_id": report["run_id"],
        "generated_at": report["generated_at"],
        "mode": report["mode"],
        "path": str(run_json.relative_to(output_dir)).replace("\\", "/"),
        "recommendations": {
            k: (v or {}).get("provider")
            for k, v in report["recommendations"].items()
            if k in {"cheapest", "fastest", "balanced", "recommended"}
        },
    }
    manifest["updated_at"] = report["generated_at"]
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    return {
        "run_json": run_json,
        "run_md": run_md,
        "latest_json": latest_json,
        "latest_md": latest_md,
        "manifest_json": manifest_path,
    }


def build_report(
    *,
    mode: str,
    profiles: list[dict[str, Any]],
    rollups: list[ProviderRollup],
    prompt: str,
    max_new_tokens: int,
    load_concurrency: int,
) -> dict[str, Any]:
    stamp = _utc_stamp()
    generated_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    run_id = f"{stamp}_provider_comparison_{mode}"
    return {
        "schema_version": "1.0.0",
        "run_id": run_id,
        "generated_at": generated_at,
        "mode": mode,
        "model_id": "meta-llama/Llama-3-8B-Instruct",
        "prompt": prompt,
        "prompt_tokens": estimate_prompt_tokens(prompt),
        "max_new_tokens": max_new_tokens,
        "load_concurrency": load_concurrency,
        "provider_ids": [p["id"] for p in profiles],
        "providers": [rollup_to_dict(r) for r in rollups],
        "recommendations": pick_recommendations(rollups),
        "evidence_policy": (
            "Never fabricate metrics. simulate→simulated; api success→measured; catalog-only fallback→estimated."
        ),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Cross-provider cold/warm/load comparison harness")
    parser.add_argument("--mode", choices=["simulate", "api"], default="simulate")
    parser.add_argument("--base-url", default=os.environ.get("API_BASE_URL", "http://localhost:3000"))
    parser.add_argument("--tenant-id", default=os.environ.get("TENANT_ID", "tenant-demo"))
    parser.add_argument("--api-key", default=os.environ.get("API_KEY", "dev-secret-key"))
    parser.add_argument(
        "--providers",
        default="",
        help="Comma-separated provider ids (default: full matrix). "
        f"Available: {','.join(p['id'] for p in PROVIDER_MATRIX)}",
    )
    parser.add_argument("--prompt", default=CANONICAL_PROMPT)
    parser.add_argument("--max-new-tokens", type=int, default=CANONICAL_MAX_NEW_TOKENS)
    parser.add_argument("--load-concurrency", type=int, default=4)
    parser.add_argument("--poll-timeout-seconds", type=float, default=180.0)
    parser.add_argument(
        "--live-adapters-only",
        action="store_true",
        help="In api mode, only probe providers with registered worker adapters (skip catalog estimates)",
    )
    parser.add_argument("--output-dir", type=Path, default=Path("benchmarks/results"))
    args = parser.parse_args(argv)

    provider_ids = [p.strip() for p in args.providers.split(",") if p.strip()] or None
    profiles = select_profiles(provider_ids)
    if args.mode == "api" and args.live_adapters_only:
        profiles = [p for p in profiles if p.get("has_live_adapter")]

    rollups: list[ProviderRollup] = []
    print(f"Provider comparison mode={args.mode} providers={len(profiles)} load_c={args.load_concurrency}")

    for profile in profiles:
        print(f"  → probing {profile['id']} ({profile['display_name']})...")
        if args.mode == "simulate":
            samples = simulate_provider_samples(
                profile,
                prompt=args.prompt,
                max_new_tokens=args.max_new_tokens,
                load_concurrency=args.load_concurrency,
            )
        else:
            samples = probe_provider_api(
                profile,
                base_url=args.base_url,
                tenant_id=args.tenant_id,
                api_key=args.api_key,
                prompt=args.prompt,
                max_new_tokens=args.max_new_tokens,
                load_concurrency=args.load_concurrency,
                poll_timeout_s=args.poll_timeout_seconds,
                estimate_if_no_adapter=not args.live_adapters_only,
            )
            if not samples:
                print("     skipped (no samples)")
                continue
        rollup = rollup_provider(profile, samples)
        rollups.append(rollup)
        print(
            f"     warm_p50={rollup.warm_e2e_p50_ms}ms cost=${rollup.cost_usd_per_job} "
            f"cold_penalty={rollup.cold_start_penalty_ms}ms evidence={rollup.evidence}"
        )

    report = build_report(
        mode=args.mode,
        profiles=profiles,
        rollups=rollups,
        prompt=args.prompt,
        max_new_tokens=args.max_new_tokens,
        load_concurrency=args.load_concurrency,
    )

    paths = update_ledgers(args.output_dir, report)
    picks = report["recommendations"]
    print("\nRecommendations:")
    for key in ("cheapest", "fastest", "balanced", "recommended"):
        p = picks.get(key) or {}
        print(
            f"  {key:12} → {p.get('provider')} "
            f"(warm {p.get('warm_e2e_p50_ms')}ms · ${p.get('cost_usd_per_job')} · {p.get('evidence')})"
        )
    print(f"\nWrote {paths['run_json']}")
    print(f"Wrote {paths['latest_md']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
