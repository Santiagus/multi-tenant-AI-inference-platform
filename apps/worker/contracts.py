"""Canonical inference worker contracts and error classifications."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


class InferenceError(Exception):
    """Structured inference execution exception with transient vs permanent classification."""

    def __init__(self, message: str, code: str, is_transient: bool = False) -> None:
        super().__init__(message)
        self.message = message
        self.code = code
        self.is_transient = is_transient


@dataclass(frozen=True)
class HardwareTelemetry:
    """Hardware and memory telemetry captured during model execution."""

    device_type: str  # "cuda" | "cpu"
    device_name: str
    backend: str  # "pytorch_cuda" | "pytorch_cpu" | "numpy_cpu_fallback"
    vram_allocated_mb: float
    vram_reserved_mb: float
    vram_peak_mb: float
    vram_total_mb: float
    gpu_utilization_pct: float | None
    ram_rss_mb: float
    measurement_mode: str  # "measured" | "estimated"

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class UsageMetrics:
    """Token accounting, compute duration, and cost metrics for an inference run."""

    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    compute_duration_ms: float
    time_to_first_token_ms: float
    tokens_per_sec: float
    estimated_cost_microcents: int

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class InferenceRequest:
    """Standard provider-agnostic inference request contract."""

    job_id: str
    tenant_id: str
    model_id: str
    prompt: str
    parameters: dict[str, Any] = field(default_factory=dict)
    stream: bool = False
    timeout_seconds: float = 300.0
    retry_count: int = 0
    correlation_id: str | None = None
    traceparent: str | None = None

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> InferenceRequest:
        job_id = str(payload.get("job_id") or payload.get("jobId") or "job-unknown")
        tenant_id = str(payload.get("tenant_id") or payload.get("tenantId") or "tenant-default")
        model_id = str(payload.get("model_id") or payload.get("modelId") or "")
        if not model_id.strip():
            raise InferenceError("model_id is required for inference execution", "INVALID_MODEL_ID", False)

        raw_corr = payload.get("correlation_id") or payload.get("correlationId")
        correlation_id = str(raw_corr).strip() if raw_corr else None

        raw_trace = payload.get("traceparent")
        traceparent = str(raw_trace).strip() if raw_trace else None

        input_obj = payload.get("input")
        if isinstance(input_obj, dict):
            prompt = str(input_obj.get("prompt") or "")
            raw_params = input_obj.get("parameters")
            params: dict[str, Any] = dict(raw_params) if isinstance(raw_params, dict) else {}
            for k, v in input_obj.items():
                if k not in ("prompt", "parameters"):
                    params[k] = v
        else:
            prompt = str(payload.get("prompt") or "")
            raw_params = payload.get("parameters")
            params = dict(raw_params) if isinstance(raw_params, dict) else {}

        return cls(
            job_id=job_id,
            tenant_id=tenant_id,
            model_id=model_id,
            prompt=prompt,
            parameters=params,
            stream=bool(payload.get("stream", False)),
            timeout_seconds=float(payload.get("timeout_seconds", 300.0)),
            retry_count=int(payload.get("retry_count") or payload.get("retryCount") or 0),
            correlation_id=correlation_id,
            traceparent=traceparent,
        )


@dataclass(frozen=True)
class InferenceResult:
    """Standard provider-agnostic inference result contract."""

    output_text: str
    finish_reason: str
    usage: UsageMetrics
    provider_name: str
    telemetry: HardwareTelemetry
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "output_text": self.output_text,
            "finish_reason": self.finish_reason,
            "usage": self.usage.to_dict(),
            "provider_name": self.provider_name,
            "telemetry": self.telemetry.to_dict(),
            "metadata": self.metadata,
        }

