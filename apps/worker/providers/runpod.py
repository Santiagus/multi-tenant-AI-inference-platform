"""RunPod Serverless GPU inference provider adapter."""

from __future__ import annotations

import json
import os
import time
from typing import Any
import urllib.error
import urllib.request

from apps.worker.contracts import (
    HardwareTelemetry,
    InferenceError,
    InferenceRequest,
    InferenceResult,
    UsageMetrics,
)
from apps.worker.providers.base import InferenceProvider


class RunPodAdapter(InferenceProvider):
    """Executes inference on RunPod Serverless GPU infrastructure."""

    def __init__(
        self,
        api_key: str | None = None,
        endpoint_id: str | None = None,
        mock_mode: bool | None = None,
        healthy: bool = True,
        base_url: str = "https://api.runpod.ai/v2",
    ) -> None:
        self._api_key = api_key or os.environ.get("RUNPOD_API_KEY", "")
        self._endpoint_id = endpoint_id or os.environ.get("RUNPOD_ENDPOINT_ID", "runpod-llama3-serverless")
        self._mock_mode = (
            mock_mode if mock_mode is not None else (not bool(self._api_key) or os.environ.get("RUNPOD_MOCK", "1") == "1")
        )
        self._healthy = healthy
        self._base_url = base_url.rstrip("/")

    @property
    def name(self) -> str:
        return "runpod"

    @property
    def endpoint_id(self) -> str:
        return self._endpoint_id

    @property
    def mock_mode(self) -> bool:
        return self._mock_mode

    def set_healthy(self, healthy: bool) -> None:
        self._healthy = healthy

    async def is_healthy(self) -> bool:
        if not self._healthy:
            return False
        if self._mock_mode:
            return True
        try:
            req = urllib.request.Request(
                f"{self._base_url}/{self._endpoint_id}/health",
                headers={
                    "Authorization": f"Bearer {self._api_key}",
                    "User-Agent": "MultiTenantInferencePlatform/1.0",
                },
                method="GET",
            )
            with urllib.request.urlopen(req, timeout=5.0) as resp:
                return resp.status == 200
        except Exception:
            return False

    async def estimate_cost(self, request: InferenceRequest) -> int:
        prompt_tokens = max(1, len(request.prompt.split()))
        max_new_tokens = int(request.parameters.get("max_new_tokens", 32))
        projected_tokens = prompt_tokens + max(1, min(max_new_tokens, 512))
        # RunPod serverless billing model: prorated A100 GPU compute (~12 microcents per token equivalent)
        return projected_tokens * 12

    async def predict(self, request: InferenceRequest) -> InferenceResult:
        simulate_failure = request.parameters.get("_simulate_failure")
        if simulate_failure == "permanent":
            raise InferenceError(
                "RunPod request rejected: invalid payload schema or model id",
                "RUNPOD_INVALID_PAYLOAD",
                False,
            )
        if simulate_failure in ("transient", "timeout"):
            raise InferenceError(
                "RunPod serverless request timed out waiting for worker container",
                "RUNPOD_WORKER_TIMEOUT",
                True,
            )
        if simulate_failure == "capacity_unavailable":
            raise InferenceError(
                "RunPod serverless capacity temporarily exhausted in target region",
                "RUNPOD_CAPACITY_EXHAUSTED",
                True,
            )

        if not await self.is_healthy():
            raise InferenceError(
                f"RunPod endpoint '{self._endpoint_id}' is unhealthy or unreachable",
                "RUNPOD_PROVIDER_UNHEALTHY",
                True,
            )

        if self._mock_mode:
            return self._predict_mock(request)
        return self._predict_live(request)

    def _predict_mock(self, request: InferenceRequest) -> InferenceResult:
        start_ns = time.perf_counter_ns()
        prompt = request.prompt
        prompt_tokens = max(1, len(prompt.split()))
        max_new_tokens = int(request.parameters.get("max_new_tokens", 24))
        tokens_out = max(1, min(max_new_tokens, 64))
        mock_compute_ms = float(request.parameters.get("_mock_latency_ms", 28.0))
        ttft_ms = round(mock_compute_ms * 0.35, 2)
        total_tokens = prompt_tokens + tokens_out
        cost_microcents = total_tokens * 12
        tokens_per_sec = round((tokens_out / max(mock_compute_ms, 0.001)) * 1000.0, 2)

        output_text = (
            f"RunPod Serverless [A100-80GB]: Completed execution for model '{request.model_id}': "
            f"{prompt[:100]}"
        )

        telemetry = HardwareTelemetry(
            device_type="cuda",
            device_name="NVIDIA A100-SXM4-80GB",
            backend="runpod_serverless_vllm",
            vram_allocated_mb=24576.0,
            vram_reserved_mb=40960.0,
            vram_peak_mb=32768.0,
            vram_total_mb=81920.0,
            gpu_utilization_pct=88.5,
            ram_rss_mb=512.0,
            measurement_mode="estimated",
        )

        usage = UsageMetrics(
            prompt_tokens=prompt_tokens,
            completion_tokens=tokens_out,
            total_tokens=total_tokens,
            compute_duration_ms=mock_compute_ms,
            time_to_first_token_ms=ttft_ms,
            tokens_per_sec=tokens_per_sec,
            estimated_cost_microcents=cost_microcents,
        )

        finish_reason = "length" if tokens_out >= max_new_tokens else "stop"

        return InferenceResult(
            output_text=output_text,
            finish_reason=finish_reason,
            usage=usage,
            provider_name=self.name,
            telemetry=telemetry,
            metadata={
                "provider_type": "external_gpu",
                "execution_target": "runpod_serverless",
                "endpoint_id": self._endpoint_id,
                "execution_mode": "mock",
                "is_mocked": True,
                "warm_start": True,
                "serverless_cold_start_ms": 0.0,
            },
        )

    def _predict_live(self, request: InferenceRequest) -> InferenceResult:
        url = f"{self._base_url}/{self._endpoint_id}/runsync"
        payload_data = json.dumps(
            {
                "input": {
                    "prompt": request.prompt,
                    "model_id": request.model_id,
                    "parameters": request.parameters,
                }
            }
        ).encode("utf-8")

        http_req = urllib.request.Request(
            url,
            data=payload_data,
            headers={
                "Authorization": f"Bearer {self._api_key}",
                "Content-Type": "application/json",
                "User-Agent": "MultiTenantInferencePlatform/1.0",
            },
            method="POST",
        )

        start_time = time.time()
        try:
            with urllib.request.urlopen(http_req, timeout=request.timeout_seconds) as resp:
                resp_data = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as err:
            is_transient = err.code in (408, 429, 502, 503, 504)
            raise InferenceError(
                f"RunPod API call failed with HTTP {err.code}: {err.reason}",
                f"RUNPOD_HTTP_{err.code}",
                is_transient,
            ) from err
        except Exception as err:
            raise InferenceError(
                f"RunPod connection error: {err}",
                "RUNPOD_NETWORK_ERROR",
                True,
            ) from err

        duration_ms = max(1.0, (time.time() - start_time) * 1000.0)
        output_obj = resp_data.get("output", {})
        if isinstance(output_obj, dict):
            output_text = str(output_obj.get("text") or output_obj.get("output") or "")
            tokens_in = int(output_obj.get("tokens_in", len(request.prompt.split())))
            tokens_out = int(output_obj.get("tokens_out", 16))
        else:
            output_text = str(output_obj)
            tokens_in = max(1, len(request.prompt.split()))
            tokens_out = max(1, len(output_text.split()))

        total_tokens = tokens_in + tokens_out
        cost_microcents = total_tokens * 12
        tokens_per_sec = round((tokens_out / max(duration_ms, 0.001)) * 1000.0, 2)

        telemetry = HardwareTelemetry(
            device_type="cuda",
            device_name="NVIDIA A100-SXM4-80GB",
            backend="runpod_serverless_vllm",
            vram_allocated_mb=24576.0,
            vram_reserved_mb=40960.0,
            vram_peak_mb=32768.0,
            vram_total_mb=81920.0,
            gpu_utilization_pct=85.0,
            ram_rss_mb=512.0,
            measurement_mode="estimated",
        )

        usage = UsageMetrics(
            prompt_tokens=tokens_in,
            completion_tokens=tokens_out,
            total_tokens=total_tokens,
            compute_duration_ms=duration_ms,
            time_to_first_token_ms=round(duration_ms * 0.3, 2),
            tokens_per_sec=tokens_per_sec,
            estimated_cost_microcents=cost_microcents,
        )

        return InferenceResult(
            output_text=output_text,
            finish_reason="stop",
            usage=usage,
            provider_name=self.name,
            telemetry=telemetry,
            metadata={
                "provider_type": "external_gpu",
                "execution_target": "runpod_serverless",
                "endpoint_id": self._endpoint_id,
                "execution_mode": "live",
                "is_mocked": False,
            },
        )

