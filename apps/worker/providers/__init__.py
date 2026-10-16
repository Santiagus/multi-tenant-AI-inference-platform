"""Provider abstraction, registry, and concrete inference adapters."""

from apps.worker.providers.base import InferenceProvider
from apps.worker.providers.bedrock import BedrockAdapter
from apps.worker.providers.local import LocalPyTorchAdapter
from apps.worker.providers.registry import ProviderRegistry, get_default_registry
from apps.worker.providers.runpod import RunPodAdapter
from apps.worker.providers.sagemaker import SageMakerAdapter

__all__ = [
    "InferenceProvider",
    "LocalPyTorchAdapter",
    "RunPodAdapter",
    "BedrockAdapter",
    "SageMakerAdapter",
    "ProviderRegistry",
    "get_default_registry",
]
