"""Provider registry and lifecycle health check manager."""

from __future__ import annotations

import asyncio
import time
from typing import Any, Mapping

from apps.worker.contracts import InferenceError
from apps.worker.providers.base import InferenceProvider
from apps.worker.providers.bedrock import BedrockAdapter
from apps.worker.providers.local import LocalPyTorchAdapter
from apps.worker.providers.runpod import RunPodAdapter
from apps.worker.providers.sagemaker import SageMakerAdapter


class ProviderRegistry:
    """Central registry and health monitor for all inference provider adapters."""

    def __init__(self, providers: Mapping[str, InferenceProvider] | None = None) -> None:
        self._providers: dict[str, InferenceProvider] = {}
        if providers is not None:
            for name, provider in providers.items():
                self.register(name, provider)
        else:
            self._register_defaults()

    def _register_defaults(self) -> None:
        self.register("local_pytorch", LocalPyTorchAdapter())
        self.register("runpod", RunPodAdapter())
        self.register("bedrock", BedrockAdapter())
        self.register("sagemaker", SageMakerAdapter())

    def register(self, name: str, provider: InferenceProvider) -> None:
        self._providers[name] = provider

    def get(self, name: str) -> InferenceProvider:
        if name not in self._providers:
            available = ", ".join(sorted(self._providers.keys()))
            raise InferenceError(
                f"Unknown inference provider '{name}'. Available providers: {available}",
                "UNKNOWN_INFERENCE_PROVIDER",
                False,
            )
        return self._providers[name]

    def has(self, name: str) -> bool:
        return name in self._providers

    def list_providers(self) -> list[str]:
        return sorted(self._providers.keys())

    async def check_health(self) -> dict[str, dict[str, Any]]:
        """Run concurrent health checks across all registered providers."""
        results: dict[str, dict[str, Any]] = {}

        async def _probe(name: str, prov: InferenceProvider) -> tuple[str, bool, float]:
            t0 = time.perf_counter()
            try:
                healthy = await prov.is_healthy()
            except Exception:
                healthy = False
            latency_ms = round((time.perf_counter() - t0) * 1000.0, 2)
            return name, healthy, latency_ms

        probes = [_probe(name, prov) for name, prov in self._providers.items()]
        probed_results = await asyncio.gather(*probes)

        for name, healthy, latency_ms in probed_results:
            prov = self._providers[name]
            mock_mode = getattr(prov, "mock_mode", False)
            results[name] = {
                "healthy": healthy,
                "latency_ms": latency_ms,
                "mock_mode": mock_mode,
                "name": name,
            }

        return results


# Global default instance
_DEFAULT_REGISTRY: ProviderRegistry | None = None


def get_default_registry() -> ProviderRegistry:
    global _DEFAULT_REGISTRY
    if _DEFAULT_REGISTRY is None:
        _DEFAULT_REGISTRY = ProviderRegistry()
    return _DEFAULT_REGISTRY

