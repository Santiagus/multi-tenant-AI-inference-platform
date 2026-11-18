"""Provider-agnostic InferenceProvider port interface (see docs/architecture/provider-abstraction.md)."""

from __future__ import annotations

import os
import sys
from abc import ABC, abstractmethod

from apps.worker.contracts import InferenceRequest, InferenceResult

TRUTHY_VALUES = frozenset({"1", "true", "enable", "enabled", "yes", "on"})
FALSY_VALUES = frozenset({"0", "false", "disable", "disabled", "no", "off"})


def is_test_environment() -> bool:
    """Return True if executing within an automated test harness or CI environment."""
    if os.environ.get("ENV") == "test" or os.environ.get("NODE_ENV") == "test":
        return True
    if os.environ.get("IN_TEST", "").strip().lower() in TRUTHY_VALUES:
        return True
    if os.environ.get("PYTEST_CURRENT_TEST") is not None or "pytest" in sys.modules:
        return True
    if "unittest" in sys.modules:
        # Check command-line arguments for unittest runner invocations
        if any("test" in arg.lower() or "unittest" in arg.lower() for arg in sys.argv):
            return True
    return False


def is_mock_inference_enabled(default: bool = True) -> bool:
    """Check generalized inference mock flag across all providers.

    Checks canonical MOCK_PROVIDERS, MOCK_INFERENCE, and fallback INFERENCE_MOCK_MODE.
    Truthy values: 1, ENABLE, ENABLED, TRUE, YES, ON.
    Falsy values: 0, DISABLE, DISABLED, FALSE, NO, OFF.

    Under automated testing environments, mock inference is strictly required:
    disabling mock inference or attempting real inference raises RuntimeError.
    """
    # Check if any variable explicitly attempts to disable mock mode
    for var in ("MOCK_PROVIDERS", "MOCK_INFERENCE", "INFERENCE_MOCK_MODE", "INFERENCE_MOCK"):
        val = os.environ.get(var)
        if val is not None:
            cleaned = val.strip().lower()
            if cleaned in FALSY_VALUES:
                if is_test_environment():
                    raise RuntimeError(
                        f"Real inference in test is strictly forbidden! Environment variable {var}={val!r} "
                        "disables mock inference during testing. Set MOCK_PROVIDERS=1 (or ENABLE/TRUE)."
                    )
                return False

    # Check for enabled mock flags
    for var in ("MOCK_PROVIDERS", "MOCK_INFERENCE", "INFERENCE_MOCK_MODE", "INFERENCE_MOCK"):
        val = os.environ.get(var)
        if val is not None:
            cleaned = val.strip().lower()
            if cleaned in TRUTHY_VALUES:
                return True

    # Default behavior: in test environments, mock inference is always required.
    if is_test_environment():
        return True
    return default


def assert_no_real_inference_in_test(provider_name: str) -> None:
    """Enforce that real inference is never invoked within automated tests."""
    if is_test_environment():
        raise RuntimeError(
            f"Real inference on provider '{provider_name}' is forbidden during test execution. "
            "Mock inference must be ENABLE/TRUE/1."
        )


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
