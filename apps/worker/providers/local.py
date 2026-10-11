"""Local PyTorch / CPU-fallback inference provider adapter."""

from __future__ import annotations

from apps.worker.contracts import (
    InferenceError,
    InferenceRequest,
    InferenceResult,
    UsageMetrics,
)
from apps.worker.models import ModelLoader, tokenize_prompt
from apps.worker.providers.base import InferenceProvider
from apps.worker.telemetry import TelemetryCollector


class LocalPyTorchAdapter(InferenceProvider):
    """Executes inference on local GPU (CUDA) or CPU fallback via ModelLoader."""

    def __init__(
        self,
        model_loader: ModelLoader | None = None,
        telemetry_collector: TelemetryCollector | None = None,
    ) -> None:
        self._loader = model_loader if model_loader is not None else ModelLoader()
        self._telemetry = (
            telemetry_collector if telemetry_collector is not None else TelemetryCollector()
        )

    @property
    def name(self) -> str:
        return "local_pytorch"

    async def is_healthy(self) -> bool:
        try:
            device = self._loader.resolve_device()
            return device in ("cuda", "cpu")
        except Exception:
            return False

    async def estimate_cost(self, request: InferenceRequest) -> int:
        spec = self._loader.resolve_spec(request.model_id)
        prompt_tokens = len(tokenize_prompt(request.prompt, spec.vocab_size))
        max_new_tokens = int(request.parameters.get("max_new_tokens", 32))
        projected_tokens = prompt_tokens + max(1, min(max_new_tokens, 512))
        return projected_tokens * spec.cost_microcents_per_token

    async def predict(self, request: InferenceRequest) -> InferenceResult:
        simulate_failure = request.parameters.get("_simulate_failure")
        if simulate_failure == "permanent":
            raise InferenceError(
                "Permanent model execution failure: unsupported context length",
                "INVALID_MODEL_PARAMETERS",
                False,
            )
        if simulate_failure == "transient":
            raise InferenceError(
                "Transient provider capacity timeout while allocating compute",
                "PROVIDER_TRANSIENT_TIMEOUT",
                True,
            )
        if simulate_failure == "transient_once" and request.retry_count == 0:
            raise InferenceError(
                "Transient worker warm-up error on initial attempt",
                "WORKER_WARMUP_TRANSIENT",
                True,
            )

        max_new_tokens = int(request.parameters.get("max_new_tokens", 24))
        temperature = float(request.parameters.get("temperature", 0.7))
        if max_new_tokens <= 0:
            raise InferenceError(
                "max_new_tokens must be greater than zero",
                "INVALID_MODEL_PARAMETERS",
                False,
            )

        self._telemetry.reset_peak_memory()
        loaded, is_warm = self._loader.load(request.model_id)

        output_text, tokens_in, tokens_out, ttft_ms, compute_ms = loaded.backend.generate(
            prompt=request.prompt,
            max_new_tokens=max_new_tokens,
            temperature=temperature,
        )

        hw_telemetry = self._telemetry.capture_snapshot(
            active_backend=loaded.backend.backend_name,
            model_footprint_mb=loaded.backend.footprint_mb,
        )

        total_tokens = tokens_in + tokens_out
        cost_microcents = total_tokens * loaded.spec.cost_microcents_per_token
        tokens_per_sec = round((tokens_out / max(compute_ms, 0.001)) * 1000.0, 2)

        usage = UsageMetrics(
            prompt_tokens=tokens_in,
            completion_tokens=tokens_out,
            total_tokens=total_tokens,
            compute_duration_ms=compute_ms,
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
            telemetry=hw_telemetry,
            metadata={
                "warm_start": is_warm,
                "model_load_ms": 0.0 if is_warm else loaded.load_duration_ms,
                "model_footprint_mb": loaded.backend.footprint_mb,
                "estimated_full_weights_vram_mb": loaded.spec.estimated_vram_mb,
            },
        )

