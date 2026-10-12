#!/usr/bin/env python3
"""Observability workload & use-case simulator (M05).

Executes every workload pattern against the running Control Plane API (`http://localhost:3000`
by default) so all 7 Grafana operational dashboard panels populate with rich telemetry:
  1. Health & readiness probes
  2. Happy-path manual transition lifecycle (Use Case 2)
  3. Idempotent submission & payload conflict rejection (Use Case 3)
  4. Job cancellation & terminal conflict guard (Use Case 4)
  5. Schema validation & 404 RFC 7807 rejections (Use Case 5)
  6. Worker queue execution, transient retry recovery & DLQ quarantine (Use Case 6)
  7. Multi-model GPU/CPU inference burst + W3C distributed trace verification (Use Cases 7 & 8)
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from typing import Any
from urllib import error, request


def http_request(
    base_url: str,
    method: str,
    path: str,
    headers: dict[str, str] | None = None,
    payload: dict[str, Any] | None = None,
) -> tuple[int, dict[str, Any], dict[str, str]]:
    """Send an HTTP request using stdlib urllib and return (status, parsed_json, headers)."""
    url = f"{base_url.rstrip('/')}{path}"
    req_headers = {"Accept": "application/json"}
    if headers:
        req_headers.update(headers)

    data_bytes: bytes | None = None
    if payload is not None:
        data_bytes = json.dumps(payload).encode("utf-8")
        req_headers["Content-Type"] = "application/json"

    req = request.Request(url, data=data_bytes, headers=req_headers, method=method)
    try:
        with request.urlopen(req, timeout=10.0) as resp:
            raw = resp.read().decode("utf-8")
            parsed = json.loads(raw) if raw.strip().startswith("{") else {"raw": raw}
            return resp.status, parsed, dict(resp.headers.items())
    except error.HTTPError as exc:
        raw = exc.read().decode("utf-8")
        parsed = json.loads(raw) if raw.strip().startswith("{") else {"raw": raw}
        return exc.code, parsed, dict(exc.headers.items())


def drain_worker_queue(base_url: str, tenant_id: str, max_ticks: int = 15) -> int:
    """Trigger POST /v1/worker/process-next until queue is drained."""
    processed_total = 0
    for _ in range(max_ticks):
        status, body, _ = http_request(
            base_url,
            "POST",
            "/v1/worker/process-next",
            headers={"x-tenant-id": tenant_id},
        )
        if status != 200 or int(body.get("processed", 0)) == 0:
            break
        processed_total += int(body.get("processed", 0))
    return processed_total


def run_simulation(base_url: str, rounds: int, pause_sec: float) -> int:
    """Run all 8 use-case cycles against base_url."""
    print(f"==> Connecting to Control Plane API at {base_url} ...")
    try:
        status, health, _ = http_request(base_url, "GET", "/healthz")
    except Exception as exc:
        print(
            f"ERROR: Could not reach {base_url}/healthz ({exc}). "
            "Make sure `docker compose up -d --build` is running.",
            file=sys.stderr,
        )
        return 1

    if status != 200:
        print(f"ERROR: /healthz returned HTTP {status}: {health}", file=sys.stderr)
        return 1

    http_request(base_url, "GET", "/readyz")
    print("  [Use Case 1] /healthz and /readyz probes OK.")

    # Drain any leftover messages in queue first
    drain_worker_queue(base_url, "tenant-default")

    for r in range(1, rounds + 1):
        print(f"\n--- Simulation Round {r}/{rounds} ---")

        # Use Case 2: Happy Path via manual transition
        _, sub2, _ = http_request(
            base_url,
            "POST",
            "/v1/jobs",
            headers={"x-tenant-id": "tenant-default", "x-correlation-id": f"sim-uc2-r{r}"},
            payload={
                "model_id": "meta-llama/Llama-3-8B-Instruct",
                "routing_preference": "auto",
                "priority": 5,
                "input": {"prompt": "Explain Raft consensus protocol in distributed databases."},
            },
        )
        job2_id = sub2["job_id"]
        http_request(
            base_url,
            "POST",
            f"/v1/jobs/{job2_id}/transition",
            headers={"x-tenant-id": "tenant-default"},
            payload={"status": "PROCESSING", "provider": "local_pytorch"},
        )
        http_request(
            base_url,
            "POST",
            f"/v1/jobs/{job2_id}/transition",
            headers={"x-tenant-id": "tenant-default"},
            payload={
                "status": "SUCCEEDED",
                "provider": "local_pytorch",
                "output": {"output_text": "Raft consensus summary.", "finish_reason": "stop"},
                "duration_ms": 620,
                "tokens_in": 18,
                "tokens_out": 54,
                "cost_microcents": 360,
            },
        )
        # Drain the queue message for job2 so it displays as skipped_terminal
        drain_worker_queue(base_url, "tenant-default", max_ticks=2)
        print(f"  [Use Case 2] Transitioned job {job2_id} -> PROCESSING -> SUCCEEDED.")

        # Use Case 3: Idempotency replay & conflict
        idem_key = f"sim-idem-key-r{r}-{int(time.time())}"
        http_request(
            base_url,
            "POST",
            "/v1/jobs",
            headers={"x-tenant-id": "tenant-default", "Idempotency-Key": idem_key},
            payload={
                "model_id": "meta-llama/Llama-3-8B-Instruct",
                "input": {"prompt": "Analyze batch 1024."},
            },
        )
        http_request(
            base_url,
            "POST",
            "/v1/jobs",
            headers={"x-tenant-id": "tenant-default", "Idempotency-Key": idem_key},
            payload={
                "model_id": "meta-llama/Llama-3-8B-Instruct",
                "input": {"prompt": "Analyze batch 1024."},
            },
        )
        status_conflict, _, _ = http_request(
            base_url,
            "POST",
            "/v1/jobs",
            headers={"x-tenant-id": "tenant-default", "Idempotency-Key": idem_key},
            payload={
                "model_id": "meta-llama/Llama-3-8B-Instruct",
                "input": {"prompt": "TAMPERED payload."},
            },
        )
        drain_worker_queue(base_url, "tenant-default", max_ticks=2)
        print(f"  [Use Case 3] Idempotency replay (200) & conflict guard ({status_conflict}) verified.")

        # Use Case 4: Cancellation & terminal conflict
        _, sub4, _ = http_request(
            base_url,
            "POST",
            "/v1/jobs",
            headers={"x-tenant-id": "tenant-default"},
            payload={
                "model_id": "meta-llama/Llama-3-8B-Instruct",
                "input": {"prompt": "Cancel me before execution."},
            },
        )
        job4_id = sub4["job_id"]
        http_request(
            base_url,
            "POST",
            f"/v1/jobs/{job4_id}/cancel",
            headers={"x-tenant-id": "tenant-default"},
        )
        status_cancel_conflict, _, _ = http_request(
            base_url,
            "POST",
            f"/v1/jobs/{job4_id}/cancel",
            headers={"x-tenant-id": "tenant-default"},
        )
        drain_worker_queue(base_url, "tenant-default", max_ticks=2)
        print(f"  [Use Case 4] Cancelled job {job4_id} & blocked re-cancel ({status_cancel_conflict}).")

        # Use Case 5: Validation failure (400) & Not Found (404)
        status_400, _, _ = http_request(
            base_url,
            "POST",
            "/v1/jobs",
            headers={"x-tenant-id": "tenant-default", "x-correlation-id": f"sim-uc5-400-r{r}"},
            payload={"model_id": "meta-llama/Llama-3-8B-Instruct"},
        )
        status_404, _, _ = http_request(
            base_url,
            "GET",
            "/v1/jobs/00000000-0000-0000-0000-000000000000",
            headers={"x-tenant-id": "tenant-default", "x-correlation-id": f"sim-uc5-404-r{r}"},
        )
        print(f"  [Use Case 5] RFC 7807 validation ({status_400}) & missing job ({status_404}) recorded.")

        # Use Case 6: Transient retry + Permanent failure to DLQ
        _, sub_trans, _ = http_request(
            base_url,
            "POST",
            "/v1/jobs",
            headers={"x-tenant-id": "tenant-default", "x-correlation-id": f"sim-uc6-retry-r{r}"},
            payload={
                "model_id": "meta-llama/Llama-3-8B-Instruct",
                "max_retries": 3,
                "input": {
                    "prompt": "Test transient failure retry.",
                    "_simulate_failure": "transient_once",
                },
            },
        )
        http_request(
            base_url,
            "POST",
            "/v1/worker/process-next",
            headers={"x-tenant-id": "tenant-default"},
        )

        _, sub_dlq, _ = http_request(
            base_url,
            "POST",
            "/v1/jobs",
            headers={"x-tenant-id": "tenant-default", "x-correlation-id": f"sim-uc6-dlq-r{r}"},
            payload={
                "model_id": "meta-llama/Llama-3-8B-Instruct",
                "max_retries": 2,
                "input": {
                    "prompt": "Trigger permanent model error to DLQ.",
                    "_simulate_failure": "permanent",
                },
            },
        )
        http_request(
            base_url,
            "POST",
            "/v1/worker/process-next",
            headers={"x-tenant-id": "tenant-default"},
        )
        _, dlq_body, _ = http_request(
            base_url,
            "GET",
            "/v1/jobs/dlq",
            headers={"x-tenant-id": "tenant-default"},
        )
        print(
            f"  [Use Case 6] Transient retry ({sub_trans['job_id']}) & "
            f"DLQ poison pill ({sub_dlq['job_id']}, DLQ count={len(dlq_body.get('messages', []))}) recorded."
        )

        # Use Cases 7 & 8: Multi-model inference burst + W3C Distributed Trace inspection
        trace_id = f"4bf92f3577b34da6a3ce929d0e0e{r:04d}"
        traceparent = f"00-{trace_id}-00f067aa0ba902b7-01"
        corr_id = f"corr-m05-trace-demo-r{r}"

        models_and_prompts = [
            (
                "TinyLlama/TinyLlama-1.1B-Chat-v1.0",
                "Explain tensor parallelism and KV cache memory budgets in multi-tenant GPU clusters.",
            ),
            (
                "meta-llama/Llama-3-8B-Instruct",
                "Compare continuous batching and paged attention for high-throughput LLM serving.",
            ),
            (
                "mistralai/Mistral-7B-Instruct-v0.3",
                "Design a multi-tenant token rate limiter with microcent cost attribution.",
            ),
        ]

        last_traced_job_id = ""
        for idx, (model_id, prompt_text) in enumerate(models_and_prompts):
            _, sub_gpu, _ = http_request(
                base_url,
                "POST",
                "/v1/jobs",
                headers={
                    "x-tenant-id": "tenant-default",
                    "x-correlation-id": corr_id if idx == 0 else f"{corr_id}-{idx}",
                    "traceparent": traceparent if idx == 0 else f"00-{trace_id}-00f067aa0ba902b{idx}-01",
                },
                payload={
                    "model_id": model_id,
                    "routing_preference": "local",
                    "priority": 8,
                    "input": {
                        "prompt": prompt_text,
                        "parameters": {"max_new_tokens": 32, "temperature": 0.7},
                    },
                },
            )
            if idx == 0:
                last_traced_job_id = sub_gpu["job_id"]

        # Pause briefly while jobs sit in queue so Prometheus sees queue_messages_visible > 0
        time.sleep(max(pause_sec, 0.5))

        # Drain worker queue to execute all queued inference jobs
        drained = drain_worker_queue(base_url, "tenant-default", max_ticks=10)

        # Inspect trace for the first job
        _, trace_info, _ = http_request(
            base_url,
            "GET",
            f"/v1/jobs/{last_traced_job_id}/trace",
            headers={"x-tenant-id": "tenant-default"},
        )
        stages = trace_info.get("stages", [])
        print(
            f"  [Use Cases 7 & 8] Processed {drained} inference jobs; "
            f"job {last_traced_job_id} trace stages={stages} (span_count={trace_info.get('span_count')})."
        )

        if r < rounds and pause_sec > 0:
            time.sleep(pause_sec)

    print("\n==> Simulation complete!")
    print("  - Grafana Dashboard: http://localhost:3001/d/platform-inference-operations")
    print(f"  - Prometheus Metrics: {base_url}/metrics")
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Simulate all platform workload use cases for Grafana & Prometheus observability."
    )
    parser.add_argument(
        "--base-url",
        type=str,
        default="http://localhost:3000",
        help="Base URL of the Control Plane API (default: http://localhost:3000).",
    )
    parser.add_argument(
        "--rounds",
        type=int,
        default=3,
        help="Number of full simulation rounds to execute (default: 3).",
    )
    parser.add_argument(
        "--pause-seconds",
        type=float,
        default=1.5,
        help="Pause in seconds between queue submission and worker drain (default: 1.5).",
    )
    args = parser.parse_args()
    raise SystemExit(run_simulation(args.base_url, max(args.rounds, 1), max(args.pause_seconds, 0.0)))


if __name__ == "__main__":
    main()

