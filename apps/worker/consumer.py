"""Job transport and inference execution worker entrypoint.

Can be invoked programmatically via `WorkerRuntime` or as a CLI/JSON-RPC
bridge (`python3 -m apps.worker.consumer`) by the control plane or container daemon.

Modes:
  --payload / stdin JSON  → one-shot job (CI / legacy)
  --serve                 → persistent NDJSON loop; keeps Diffusers pipes warm across jobs
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import threading
import time
from typing import Any

from apps.worker.artifacts import ArtifactHandler
from apps.worker.contracts import InferenceError, InferenceRequest
from apps.worker.providers.base import InferenceProvider
from apps.worker.providers.local import LocalPyTorchAdapter
from apps.worker.providers.registry import ProviderRegistry, get_default_registry


def resolve_cloud_provider(model_id: str, parameters: dict[str, Any]) -> str:
    """Evaluate optimal cloud provider based on model architecture, modality, and isolation."""
    mid = model_id.lower()
    if "claude" in mid or mid.startswith("anthropic.") or mid.startswith("amazon."):
        return "bedrock"
    if parameters.get("requires_vpc") or parameters.get("vpc"):
        return "sagemaker"
    # For open-weights LLMs and diffusion models, dispatch to external GPU (RunPod)
    return "runpod"


class WorkerRuntime:
    """Coordinates job transport, provider execution, and artifact formatting."""

    def __init__(
        self,
        provider: InferenceProvider | None = None,
        artifact_handler: ArtifactHandler | None = None,
        registry: ProviderRegistry | None = None,
    ) -> None:
        self._registry = registry if registry is not None else get_default_registry()
        self._provider = provider if provider is not None else self._registry.get("local_pytorch")
        self._artifacts = artifact_handler if artifact_handler is not None else ArtifactHandler()

    @property
    def registry(self) -> ProviderRegistry:
        return self._registry

    @property
    def local_adapter(self) -> LocalPyTorchAdapter | None:
        if isinstance(self._provider, LocalPyTorchAdapter):
            return self._provider
        try:
            candidate = self._registry.get("local_pytorch")
        except Exception:
            return None
        return candidate if isinstance(candidate, LocalPyTorchAdapter) else None

    def resolve_provider(self, requested_name: str | None = None) -> InferenceProvider:
        if requested_name and requested_name.strip():
            return self._registry.get(requested_name.strip())
        return self._provider

    def resident_status(self) -> dict[str, Any]:
        adapter = self.local_adapter
        if adapter is None:
            return {
                "gpu": {"model_id": None, "warm": False, "footprint_mb": 0},
                "cpu": {"model_id": None, "warm": False, "footprint_mb": 0},
                "idle_ttl_sec": int(os.environ.get("WORKER_IDLE_TTL_SEC", "900")),
            }
        return adapter.resident_status()

    def clear_idle_pipes(self) -> None:
        adapter = self.local_adapter
        if adapter is not None:
            adapter.clear_pipes()

    async def process_job_payload(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Execute a single inference job payload and return structured response envelope."""
        try:
            request = InferenceRequest.from_dict(payload)
            routing_pref = str(
                payload.get("routing_preference") or request.parameters.get("routing_preference") or ""
            ).lower()
            if routing_pref:
                request.parameters.setdefault("routing_preference", routing_pref)
            if routing_pref == "local/cpu":
                request.parameters.setdefault("device", "cpu")
            elif routing_pref == "local/gpu":
                request.parameters.setdefault("device", "cuda")

            # Support provider override via payload or parameters or routing_preference
            requested_provider = payload.get("provider") or request.parameters.get("provider")
            if not requested_provider:
                if routing_pref in ("runpod", "cloud/runpod"):
                    requested_provider = "runpod"
                elif routing_pref in ("bedrock", "cloud/bedrock"):
                    requested_provider = "bedrock"
                elif routing_pref in ("sagemaker", "cloud/sagemaker"):
                    requested_provider = "sagemaker"
                elif routing_pref == "cloud":
                    requested_provider = resolve_cloud_provider(request.model_id, request.parameters)
                elif routing_pref in ("local/cpu", "local/gpu", "local", "local_first"):
                    requested_provider = "local_pytorch"

            provider = self.resolve_provider(str(requested_provider) if requested_provider else None)

            result = await provider.predict(request)
            mode = str(
                result.metadata.get("execution_mode", "live" if result.provider_name == "local_pytorch" else "mock")
            )
            is_mocked = bool(result.metadata.get("is_mocked", mode == "mock"))
            if (
                os.environ.get("ENABLE_JOB_PROGRESS", "").lower() in ("1", "true", "yes")
                or os.environ.get("LOG_LEVEL", "").lower() == "debug"
            ):
                sys.stderr.write(
                    f"[PROVIDER_EXECUTION] job_id={request.job_id} provider={result.provider_name} mode={mode} is_mocked={is_mocked}\n"
                )
            artifact_uri = self._artifacts.write_local_artifact(request, result)

            return {
                "ok": True,
                "job_id": request.job_id,
                "tenant_id": request.tenant_id,
                "correlation_id": request.correlation_id,
                "traceparent": request.traceparent,
                "model_id": request.model_id,
                "provider": result.provider_name,
                "execution_mode": mode,
                "is_mocked": is_mocked,
                "output_text": result.output_text,
                "finish_reason": result.finish_reason,
                "tokens_in": result.usage.prompt_tokens,
                "tokens_out": result.usage.completion_tokens,
                "cost_microcents": result.usage.estimated_cost_microcents,
                "duration_ms": max(1, round(result.usage.compute_duration_ms)),
                "output_uri": artifact_uri,
                "metadata": {
                    **result.metadata,
                    "execution_mode": mode,
                    "is_mocked": is_mocked,
                    "correlation_id": request.correlation_id,
                    "traceparent": request.traceparent,
                    "ttft_ms": result.usage.time_to_first_token_ms,
                    "tokens_per_sec": result.usage.tokens_per_sec,
                    "telemetry": result.telemetry.to_dict(),
                    "resident_status": self.resident_status(),
                },
            }
        except InferenceError as exc:
            return {
                "ok": False,
                "error": {
                    "code": exc.code,
                    "message": exc.message,
                    "is_transient": exc.is_transient,
                },
            }
        except Exception as exc:
            return {
                "ok": False,
                "error": {
                    "code": "WORKER_EXECUTION_ERROR",
                    "message": str(exc),
                    "is_transient": True,
                },
            }


def _emit_serve_event(event: dict[str, Any]) -> None:
    """Control/status events on stdout as NDJSON (same channel as job responses)."""
    sys.stdout.write(json.dumps(event) + "\n")
    sys.stdout.flush()


def run_serve_loop(runtime: WorkerRuntime) -> int:
    """Persistent NDJSON worker: one JSON request per stdin line → one JSON response per stdout line."""
    idle_ttl = float(os.environ.get("WORKER_IDLE_TTL_SEC", "900"))
    stop = threading.Event()
    activity = {"ts": time.monotonic()}

    def _idle_watch() -> None:
        unloaded_at = 0.0
        while not stop.is_set():
            time.sleep(5.0)
            idle_for = time.monotonic() - activity["ts"]
            if idle_for >= idle_ttl and (time.monotonic() - unloaded_at) >= idle_ttl:
                runtime.clear_idle_pipes()
                unloaded_at = time.monotonic()
                _emit_serve_event(
                    {
                        "ok": True,
                        "type": "idle_unload",
                        "resident_status": runtime.resident_status(),
                    }
                )

    watcher = threading.Thread(target=_idle_watch, name="worker-idle-ttl", daemon=True)
    watcher.start()
    _emit_serve_event({"ok": True, "type": "ready", "resident_status": runtime.resident_status()})

    try:
        for raw_line in sys.stdin:
            line = raw_line.strip()
            if not line:
                continue
            activity["ts"] = time.monotonic()
            try:
                payload = json.loads(line)
            except Exception as exc:
                _emit_serve_event(
                    {
                        "ok": False,
                        "type": "job_result",
                        "error": {
                            "code": "INVALID_WORKER_PAYLOAD",
                            "message": f"Invalid JSON payload: {exc}",
                            "is_transient": False,
                        },
                    }
                )
                continue

            if not isinstance(payload, dict):
                _emit_serve_event(
                    {
                        "ok": False,
                        "type": "job_result",
                        "error": {
                            "code": "INVALID_WORKER_PAYLOAD",
                            "message": "Payload must be a JSON object",
                            "is_transient": False,
                        },
                    }
                )
                continue

            msg_type = str(payload.get("type") or "job").lower()
            if msg_type in ("status", "ping", "health"):
                _emit_serve_event(
                    {
                        "ok": True,
                        "type": "status",
                        "resident_status": runtime.resident_status(),
                    }
                )
                continue
            if msg_type == "unload":
                runtime.clear_idle_pipes()
                _emit_serve_event(
                    {
                        "ok": True,
                        "type": "idle_unload",
                        "resident_status": runtime.resident_status(),
                    }
                )
                continue

            response = asyncio.run(runtime.process_job_payload(payload))
            response["type"] = "job_result"
            response["resident_status"] = runtime.resident_status()
            _emit_serve_event(response)
            activity["ts"] = time.monotonic()
    finally:
        stop.set()

    return 0


def run_cli(argv: list[str] | None = None) -> int:
    """CLI entrypoint accepting a JSON request via --payload or stdin."""
    parser = argparse.ArgumentParser(description="Execute Python/PyTorch inference worker job.")
    parser.add_argument(
        "--payload",
        type=str,
        default=None,
        help="Inline JSON job payload. If omitted, reads JSON from stdin.",
    )
    parser.add_argument(
        "--serve",
        action="store_true",
        help="Run persistent NDJSON serve loop (keeps models warm across jobs).",
    )
    parser.add_argument(
        "--healthcheck",
        action="store_true",
        help="Verify worker runtime and provider health.",
    )
    parser.add_argument(
        "--provider",
        type=str,
        default=None,
        help="Specific provider name to healthcheck or dispatch to.",
    )
    args = parser.parse_args(argv)

    runtime = WorkerRuntime()

    if args.healthcheck:
        if args.provider:
            provider = runtime.resolve_provider(args.provider)
            healthy = asyncio.run(provider.is_healthy())
            print(json.dumps({"status": "ok" if healthy else "unhealthy", "provider": provider.name}))
            return 0 if healthy else 1
        all_health = asyncio.run(runtime.registry.check_health())
        local_healthy = all_health.get("local_pytorch", {}).get("healthy", False)
        all_healthy = all(p["healthy"] for p in all_health.values())
        print(
            json.dumps(
                {
                    "status": "ok" if local_healthy else "unhealthy",
                    "provider": runtime._provider.name,
                    "all_healthy": all_healthy,
                    "providers": all_health,
                    "resident_status": runtime.resident_status(),
                }
            )
        )
        return 0 if local_healthy else 1

    if args.serve:
        return run_serve_loop(runtime)

    raw_input = args.payload if args.payload is not None else sys.stdin.read()
    try:
        payload = json.loads(raw_input)
        if not isinstance(payload, dict):
            raise ValueError("Payload must be a JSON object")
    except Exception as exc:
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": {
                        "code": "INVALID_WORKER_PAYLOAD",
                        "message": f"Invalid JSON payload: {exc}",
                        "is_transient": False,
                    },
                }
            )
        )
        return 1

    response = asyncio.run(runtime.process_job_payload(payload))
    print(json.dumps(response))
    return 0 if response.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(run_cli())
