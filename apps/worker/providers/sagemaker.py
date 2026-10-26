"""AWS SageMaker dedicated/asynchronous inference endpoint provider adapter."""

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


class SageMakerAdapter(InferenceProvider):
    """Executes inference against AWS SageMaker Real-Time or Async Endpoints."""

    def __init__(
        self,
        endpoint_name: str | None = None,
        aws_region: str | None = None,
        mock_mode: bool | None = None,
        healthy: bool = True,
    ) -> None:
        self._endpoint_name = endpoint_name or os.environ.get("SAGEMAKER_ENDPOINT_NAME", "sagemaker-llama3-endpoint")
        self._aws_region = aws_region or os.environ.get("AWS_REGION", "us-east-1")
        has_aws_creds = bool(
            os.environ.get("AWS_ACCESS_KEY_ID") or os.environ.get("AWS_CONTAINER_CREDENTIALS_RELATIVE_URI")
        )
        is_ci_or_mock = (
            os.environ.get("CI", "").lower() in ("true", "1", "yes")
            or os.environ.get("INFERENCE_MOCK_MODE", "").lower() in ("true", "1", "yes")
            or os.environ.get("SAGEMAKER_MOCK", "1") == "1"
        )
        self._mock_mode = mock_mode if mock_mode is not None else (not has_aws_creds or is_ci_or_mock)
        self._healthy = healthy

    @property
    def name(self) -> str:
        return "sagemaker"

    @property
    def endpoint_name(self) -> str:
        return self._endpoint_name

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

            client = boto3.client("sagemaker", region_name=self._aws_region)
            resp = client.describe_endpoint(EndpointName=self._endpoint_name)
            return resp.get("EndpointStatus") == "InService"
        except Exception:
            return False

    async def estimate_cost(self, request: InferenceRequest) -> int:
        prompt_tokens = max(1, len(request.prompt.split()))
        max_new_tokens = int(request.parameters.get("max_new_tokens", 32))
        projected_tokens = prompt_tokens + max(1, min(max_new_tokens, 512))
        # SageMaker ml.g5.2xlarge allocated capacity (~20 microcents/token equivalent)
        return projected_tokens * 20

    async def predict(self, request: InferenceRequest) -> InferenceResult:
        simulate_failure = request.parameters.get("_simulate_failure")
        if simulate_failure == "permanent":
            raise InferenceError(
                "SageMaker ModelError: Invalid payload tensor format or schema",
                "SAGEMAKER_MODEL_ERROR",
                False,
            )
        if simulate_failure in ("transient", "capacity_timeout"):
            raise InferenceError(
                "SageMaker ModelNotReadyException: Endpoint scaling or container warming",
                "SAGEMAKER_MODEL_NOT_READY",
                True,
            )
        if simulate_failure == "timeout":
            raise InferenceError(
                "SageMaker invocation timed out waiting for backend response",
                "SAGEMAKER_TIMEOUT",
                True,
            )

        if not await self.is_healthy():
            raise InferenceError(
                f"SageMaker endpoint '{self._endpoint_name}' is not InService in region {self._aws_region}",
                "SAGEMAKER_ENDPOINT_UNHEALTHY",
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
        mock_compute_ms = float(request.parameters.get("_mock_latency_ms", 32.0))
        ttft_ms = round(mock_compute_ms * 0.38, 2)
        total_tokens = prompt_tokens + tokens_out
        cost_microcents = total_tokens * 20
        tokens_per_sec = round((tokens_out / max(mock_compute_ms, 0.001)) * 1000.0, 2)

        output_text = f"AWS SageMaker [ml.g5.2xlarge]: Inference result for model '{request.model_id}': {prompt[:100]}"

        telemetry = HardwareTelemetry(
            device_type="cuda",
            device_name="AWS SageMaker ml.g5.2xlarge (A10G)",
            backend="sagemaker_tgi_runtime",
            vram_allocated_mb=18432.0,
            vram_reserved_mb=24576.0,
            vram_peak_mb=20480.0,
            vram_total_mb=24576.0,
            gpu_utilization_pct=72.0,
            ram_rss_mb=384.0,
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
                "provider_type": "dedicated_cloud_endpoint",
                "endpoint_name": self._endpoint_name,
                "aws_region": self._aws_region,
                "execution_mode": "mock",
                "is_mocked": True,
                "vpc_isolated": True,
            },
        )

    def _predict_live(self, request: InferenceRequest) -> InferenceResult:
        try:
            import boto3  # type: ignore[import-not-found,import-untyped]
            from botocore.exceptions import ClientError  # type: ignore[import-not-found,import-untyped]
        except ImportError as err:
            raise InferenceError(
                "boto3 is required for live AWS SageMaker execution. Install boto3 or enable mock_mode.",
                "SAGEMAKER_DEPENDENCY_MISSING",
                False,
            ) from err

        start_time = time.time()
        client = boto3.client("sagemaker-runtime", region_name=self._aws_region)

        payload_bytes = json.dumps(
            {
                "inputs": request.prompt,
                "parameters": {
                    "max_new_tokens": int(request.parameters.get("max_new_tokens", 64)),
                    "temperature": float(request.parameters.get("temperature", 0.7)),
                },
            }
        ).encode("utf-8")

        try:
            response = client.invoke_endpoint(
                EndpointName=self._endpoint_name,
                ContentType="application/json",
                Body=payload_bytes,
            )
        except ClientError as exc:
            code = exc.response.get("Error", {}).get("Code", "UNKNOWN_SAGEMAKER_ERROR")
            msg = exc.response.get("Error", {}).get("Message", str(exc))
            is_transient = code in ("ModelNotReadyException", "CapacityError", "ModelError")
            raise InferenceError(f"SageMaker invocation failed: {msg}", f"SAGEMAKER_{code}", is_transient) from exc

        duration_ms = max(1.0, (time.time() - start_time) * 1000.0)
        body_content = response["Body"].read().decode("utf-8")
        parsed = json.loads(body_content)

        if isinstance(parsed, list) and len(parsed) > 0 and isinstance(parsed[0], dict):
            output_text = str(parsed[0].get("generated_text", ""))
        elif isinstance(parsed, dict):
            output_text = str(parsed.get("generated_text") or parsed.get("output") or "")
        else:
            output_text = str(parsed)

        prompt_tokens = max(1, len(request.prompt.split()))
        completion_tokens = max(1, len(output_text.split()))
        total_tokens = prompt_tokens + completion_tokens
        cost_microcents = total_tokens * 20
        tokens_per_sec = round((completion_tokens / max(duration_ms, 0.001)) * 1000.0, 2)

        telemetry = HardwareTelemetry(
            device_type="cuda",
            device_name="AWS SageMaker ml.g5.2xlarge (A10G)",
            backend="sagemaker_tgi_runtime",
            vram_allocated_mb=18432.0,
            vram_reserved_mb=24576.0,
            vram_peak_mb=20480.0,
            vram_total_mb=24576.0,
            gpu_utilization_pct=75.0,
            ram_rss_mb=384.0,
            measurement_mode="estimated",
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
            finish_reason="stop",
            usage=usage,
            provider_name=self.name,
            telemetry=telemetry,
            metadata={
                "provider_type": "dedicated_cloud_endpoint",
                "endpoint_name": self._endpoint_name,
                "aws_region": self._aws_region,
                "execution_mode": "live",
                "is_mocked": False,
                "vpc_isolated": True,
            },
        )
