"""Provider abstraction and local PyTorch / CPU fallback adapter."""

from apps.worker.providers.base import InferenceProvider
from apps.worker.providers.local import LocalPyTorchAdapter

__all__ = ["InferenceProvider", "LocalPyTorchAdapter"]

