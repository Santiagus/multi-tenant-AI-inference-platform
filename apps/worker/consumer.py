"""Job transport and inference execution worker entrypoint.

Can be invoked programmatically via `WorkerRuntime` or as a CLI/JSON-RPC
bridge (`python3 -m apps.worker.consumer`) by the control plane or container daemon.
"""

from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path
import sys
from typing import Any

from apps.worker.artifacts import ArtifactHandler
from apps.worker.contracts import InferenceError, InferenceRequest
from apps.worker.providers.base import InferenceProvider
from apps.worker.providers.local import LocalPyTorchAdapter


class WorkerRuntime:
    """Coordinates job transport, provider execution, and artifact formatting."""

    def __init__(
        self,
        provider: InferenceProvider | None = None,
        artifact_handler: ArtifactHandler | None = None,
    ) -> None:
        self._provider = provider if provider is not None else LocalPyTorchAdapter()
        self._artifacts = artifact_handler if artifact_handler is not None else ArtifactHandler()

    async def process_job_payload(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Execute a single inference job payload and return structured response envelope."""
        try:
            request = InferenceRequest.from_dict(payload)
            result = await self._provider.predict(request)
            artifact_uri = self._artifacts.write_local_artifact(request, result)
            return {
                "ok": True,
                "job_id": request.job_id,
                "tenant_id": request.tenant_id,
                "model_id": request.model_id,
                "provider": result.provider_name,
                "output_text": result.output_text,
                "finish_reason": result.finish_reason,
                "tokens_in": result.usage.prompt_tokens,
                "tokens_out": result.usage.completion_tokens,
                "cost_microcents": result.usage.estimated_cost_microcents,
                "duration_ms": max(1, round(result.usage.compute_duration_ms)),
                "output_uri": artifact_uri,
                "metadata": {
                    **result.metadata,
                    "ttft_ms": result.usage.time_to_first_token_ms,
                    "tokens_per_sec": result.usage.tokens_per_sec,
                    "telemetry": result.telemetry.to_dict(),
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
        "--healthcheck",
        action="store_true",
        help="Verify worker runtime and provider health.",
    )
    args = parser.parse_args(argv)

    runtime = WorkerRuntime()

    if args.healthcheck:
        healthy = asyncio.run(runtime._provider.is_healthy())
        print(json.dumps({"status": "ok" if healthy else "unhealthy", "provider": runtime._provider.name}))
        return 0 if healthy else 1

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

