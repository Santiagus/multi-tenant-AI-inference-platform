"""Python/PyTorch inference worker package.

Separates concerns per .agents/skills/python-inference/SKILL.md:
- contracts: request, result, usage, and telemetry data models
- telemetry: GPU VRAM / utilization and CPU RAM hardware telemetry
- models: model loading, registry, and PyTorch / CPU-fallback forward execution
- providers: provider-agnostic InferenceProvider interface and LocalPyTorchAdapter
- artifacts: S3/local artifact serialization and storage handling
- consumer: job transport and worker execution pipeline
"""

from apps.worker.contracts import (
    HardwareTelemetry,
    InferenceError,
    InferenceRequest,
    InferenceResult,
    UsageMetrics,
)
from apps.worker.models import (
    LoadedModel,
    ModelBackend,
    ModelLoader,
    ModelSpec,
)
from apps.worker.providers.base import InferenceProvider
from apps.worker.providers.local import LocalPyTorchAdapter
from apps.worker.telemetry import TelemetryCollector

__all__ = [
    "HardwareTelemetry",
    "InferenceError",
    "InferenceProvider",
    "InferenceRequest",
    "InferenceResult",
    "LoadedModel",
    "LocalPyTorchAdapter",
    "ModelBackend",
    "ModelLoader",
    "ModelSpec",
    "TelemetryCollector",
    "UsageMetrics",
]

