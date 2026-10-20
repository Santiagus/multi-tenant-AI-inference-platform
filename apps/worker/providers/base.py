"""Provider-agnostic InferenceProvider port interface (see docs/architecture/provider-abstraction.md)."""

from __future__ import annotations

from abc import ABC, abstractmethod

from apps.worker.contracts import InferenceRequest, InferenceResult


class InferenceProvider(ABC):
    """Abstract base class implemented by all inference backend adapters."""

    @property
    @abstractmethod
    def name(self) -> str:
        """Provider identifier: 'local_pytorch', 'runpod', 'bedrock', 'sagemaker'."""

    @abstractmethod
    async def is_healthy(self) -> bool:
        """Verify provider availability and hardware readiness."""

    @abstractmethod
    async def predict(self, request: InferenceRequest) -> InferenceResult:
        """Execute inference and return structured result with usage and hardware telemetry."""

    @abstractmethod
    async def estimate_cost(self, request: InferenceRequest) -> int:
        """Return projected cost in microcents (1/10,000 cent) before dispatch."""
