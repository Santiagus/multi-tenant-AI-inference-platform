"""AWS Bedrock foundation model inference provider adapter."""

from __future__ import annotations

import json
import os
import time
from typing import Any

from apps.worker.contracts import (
    HardwareTelemetry,
    InferenceError,
    InferenceRequest,
    InferenceResult,
    UsageMetrics,
)
from apps.worker.providers.base import InferenceProvider


class BedrockAdapter(InferenceProvider):
    """Executes inference via AWS Bedrock Converse / InvokeModel API."""

    def __init__(
        self,
        aws_region: str | None = None,
        mock_mode: bool | None = None,
        healthy: bool = True,
    ) -> None:
        self._aws_region = aws_region or os.environ.get("AWS_REGION", "us-east-1")
        has_aws_creds = bool(
            os.environ.get("AWS_ACCESS_KEY_ID") or os.environ.get("AWS_CONTAINER_CREDENTIALS_RELATIVE_URI")
        )
        self._mock_mode = (
            mock_mode if mock_mode is not None else (not has_aws_creds or os.environ.get("BEDROCK_MOCK", "1") == "1")
        )
        self._healthy = healthy

    @property
    def name(self) -> str:
        return "bedrock"

    @property
    def aws_region(self) -> str:
        return self._aws_region

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
            import boto3  # type: ignore[import-not-found,import-untyped]

            client = boto3.client("bedrock", region_name=self._aws_region)
            # Lightweight API call checking service connectivity
            client.list_foundation_models(byOutputModality="TEXT")
            return True
        except Exception:
            return False

    async def estimate_cost(self, request: InferenceRequest) -> int:
        prompt_tokens = max(1, len(request.prompt.split()))
        max_new_tokens = int(request.parameters.get("max_new_tokens", 32))
        projected_completion = max(1, min(max_new_tokens, 512))
        # AWS Bedrock token pricing: ~15 microcents/prompt token, ~75 microcents/completion token (e.g. Claude 3 Sonnet)
        return (prompt_tokens * 15) + (projected_completion * 75)

    async def predict(self, request: InferenceRequest) -> InferenceResult:
        simulate_failure = request.parameters.get("_simulate_failure")
        if simulate_failure == "permanent":
            raise InferenceError(
                "Bedrock ValidationException: Invalid modelId or parameters",
                "BEDROCK_VALIDATION_EXCEPTION",
                False,
            )
        if simulate_failure in ("transient", "throttled"):
            raise InferenceError(
                "Bedrock ThrottlingException: Rate limit exceeded in target region",
                "BEDROCK_THROTTLING_EXCEPTION",
                True,
            )
        if simulate_failure == "timeout":
            raise InferenceError(
                "Bedrock ModelTimeoutException: Remote model invocation timed out",
                "BEDROCK_TIMEOUT",
                True,
            )

        if not await self.is_healthy():
            raise InferenceError(
                f"AWS Bedrock provider is unhealthy or unreachable in region {self._aws_region}",
                "BEDROCK_PROVIDER_UNHEALTHY",
                True,
            )

        if self._mock_mode:
            return self._predict_mock(request)
        return self._predict_live(request)

    def _predict_mock(self, request: InferenceRequest) -> InferenceResult:
        prompt = request.prompt
        prompt_tokens = max(1, len(prompt.split()))
        max_new_tokens = int(request.parameters.get("max_new_tokens", 24))
        tokens_out = max(1, min(max_new_tokens, 64))
        mock_compute_ms = float(request.parameters.get("_mock_latency_ms", 35.0))
        ttft_ms = round(mock_compute_ms * 0.40, 2)
        total_tokens = prompt_tokens + tokens_out
        cost_microcents = (prompt_tokens * 15) + (tokens_out * 75)
        tokens_per_sec = round((tokens_out / max(mock_compute_ms, 0.001)) * 1000.0, 2)

        output_text = (
            f"AWS Bedrock [Converse API]: Generated response for model '{request.model_id}': "
            f"{prompt[:100]}"
        )

        telemetry = HardwareTelemetry(
            device_type="cloud_managed",
            device_name="AWS Bedrock Managed Compute",
            backend="bedrock_converse_api",
            vram_allocated_mb=0.0,
            vram_reserved_mb=0.0,
            vram_peak_mb=0.0,
            vram_total_mb=0.0,
            gpu_utilization_pct=None,
            ram_rss_mb=256.0,
            measurement_mode="provider_reported",
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
                "provider_type": "managed_cloud_api",
                "aws_region": self._aws_region,
                "execution_mode": "mock",
                "is_mocked": True,
                "auth_type": "iam_sigv4",
            },
        )

    def _predict_live(self, request: InferenceRequest) -> InferenceResult:
        try:
            import boto3  # type: ignore[import-not-found,import-untyped]
            from botocore.exceptions import ClientError  # type: ignore[import-not-found,import-untyped]
        except ImportError as err:
            raise InferenceError(
                "boto3 is required for live AWS Bedrock execution. Install boto3 or enable mock_mode.",
                "BEDROCK_DEPENDENCY_MISSING",
                False,
            ) from err

        start_time = time.time()
        client = boto3.client("bedrock-runtime", region_name=self._aws_region)

        # Standard Converse API invocation format
        model_id = request.model_id
        if not model_id.startswith(("anthropic.", "meta.", "amazon.", "mistral.")):
            # Default model alias mapping
            model_id = "anthropic.claude-3-sonnet-20240229-v1:0"

        max_tokens = int(request.parameters.get("max_new_tokens", 256))
        temperature = float(request.parameters.get("temperature", 0.7))

        try:
            response = client.converse(
                modelId=model_id,
                messages=[
                    {
                        "role": "user",
                        "content": [{"text": request.prompt}],
                    }
                ],
                inferenceConfig={
                    "maxTokens": max_tokens,
                    "temperature": temperature,
                },
            )
        except ClientError as exc:
            code = exc.response.get("Error", {}).get("Code", "UNKNOWN_BEDROCK_ERROR")
            msg = exc.response.get("Error", {}).get("Message", str(exc))
            is_transient = code in ("ThrottlingException", "ModelTimeoutException", "ServiceUnavailableException")
            raise InferenceError(f"Bedrock invocation failed: {msg}", f"BEDROCK_{code}", is_transient) from exc

        duration_ms = max(1.0, (time.time() - start_time) * 1000.0)
        output_content = response.get("output", {}).get("message", {}).get("content", [])
        output_text = "".join(part.get("text", "") for part in output_content if "text" in part)

        token_usage = response.get("usage", {})
        prompt_tokens = int(token_usage.get("inputTokens", len(request.prompt.split())))
        completion_tokens = int(token_usage.get("outputTokens", len(output_text.split())))
        total_tokens = prompt_tokens + completion_tokens
        cost_microcents = (prompt_tokens * 15) + (completion_tokens * 75)
        tokens_per_sec = round((completion_tokens / max(duration_ms, 0.001)) * 1000.0, 2)

        telemetry = HardwareTelemetry(
            device_type="cloud_managed",
            device_name="AWS Bedrock Managed Compute",
            backend="bedrock_converse_api",
            vram_allocated_mb=0.0,
            vram_reserved_mb=0.0,
            vram_peak_mb=0.0,
            vram_total_mb=0.0,
            gpu_utilization_pct=None,
            ram_rss_mb=256.0,
            measurement_mode="provider_reported",
        )

        usage = UsageMetrics(
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=total_tokens,
            compute_duration_ms=duration_ms,
            time_to_first_token_ms=round(duration_ms * 0.35, 2),
            tokens_per_sec=tokens_per_sec,
            estimated_cost_microcents=cost_microcents,
        )

        return InferenceResult(
            output_text=output_text,
            finish_reason=response.get("stopReason", "stop"),
            usage=usage,
            provider_name=self.name,
            telemetry=telemetry,
            metadata={
                "provider_type": "managed_cloud_api",
                "aws_region": self._aws_region,
                "execution_mode": "live",
                "is_mocked": False,
                "auth_type": "iam_sigv4",
            },
        )
