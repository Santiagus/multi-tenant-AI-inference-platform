"""Model abstraction, registry, and tensor forward-pass execution engine.

Provides a unified abstraction over:
- PyTorch neural network execution (GPU CUDA or CPU tensors when `torch` is installed)
- Deterministic NumPy tensor forward pass fallback when running in lightweight CPU-only environments
"""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import time
from typing import Any, Protocol

import numpy as np  # type: ignore[import-not-found]

from apps.worker.contracts import InferenceError


@dataclass(frozen=True)
class ModelSpec:
    """Architecture and cost metadata for a registered inference model."""

    model_id: str
    hidden_dim: int
    num_layers: int
    vocab_size: int
    max_context_length: int
    cost_microcents_per_token: int
    estimated_vram_mb: float


DEFAULT_MODEL_REGISTRY: dict[str, ModelSpec] = {
    "meta-llama/Llama-3-8B-Instruct": ModelSpec(
        model_id="meta-llama/Llama-3-8B-Instruct",
        hidden_dim=128,
        num_layers=4,
        vocab_size=256,
        max_context_length=8192,
        cost_microcents_per_token=5,
        estimated_vram_mb=16.5,
    ),
    "mistralai/Mistral-7B-Instruct-v0.3": ModelSpec(
        model_id="mistralai/Mistral-7B-Instruct-v0.3",
        hidden_dim=128,
        num_layers=4,
        vocab_size=256,
        max_context_length=8192,
        cost_microcents_per_token=4,
        estimated_vram_mb=14.8,
    ),
    "TinyLlama/TinyLlama-1.1B-Chat-v1.0": ModelSpec(
        model_id="TinyLlama/TinyLlama-1.1B-Chat-v1.0",
        hidden_dim=64,
        num_layers=2,
        vocab_size=256,
        max_context_length=4096,
        cost_microcents_per_token=2,
        estimated_vram_mb=4.2,
    ),
}

VOCAB_WORDS: tuple[str, ...] = (
    "distributed",
    "consensus",
    "inference",
    "tensor",
    "latency",
    "throughput",
    "scheduler",
    "pipeline",
    "quorum",
    "replication",
    "partition",
    "isolation",
    "allocation",
    "telemetry",
    "checkpoint",
    "synchronization",
    "bandwidth",
    "execution",
    "gradient",
    "activation",
    "quantization",
    "attention",
    "transformer",
    "embedding",
    "token",
    "stream",
    "node",
    "cluster",
    "worker",
    "queue",
    "storage",
    "artifact",
)


class ModelBackend(Protocol):
    """Protocol implemented by both PyTorch and CPU-fallback tensor model backends."""

    @property
    def backend_name(self) -> str: ...

    @property
    def footprint_mb(self) -> float: ...

    def generate(
        self,
        prompt: str,
        max_new_tokens: int,
        temperature: float = 0.7,
    ) -> tuple[str, int, int, float, float]:
        """Run forward pass generation.

        Returns:
            (output_text, prompt_tokens, completion_tokens, ttft_ms, total_compute_ms)
        """
        ...


def tokenize_prompt(prompt: str, vocab_size: int = 256) -> list[int]:
    """Deterministic subword/word tokenizer mapping text into token IDs."""
    stripped = prompt.strip()
    if not stripped:
        return [1]
    raw_parts = stripped.split()
    tokens: list[int] = []
    for part in raw_parts:
        digest = hashlib.sha256(part.encode("utf-8")).digest()
        tokens.append(digest[0] % vocab_size)
        if len(part) > 6:
            tokens.append(digest[1] % vocab_size)
    return tokens if tokens else [1]


def decode_tokens(model_id: str, prompt: str, token_ids: list[int]) -> str:
    """Deterministically decode generated token IDs into a readable response."""
    words = [VOCAB_WORDS[t % len(VOCAB_WORDS)] for t in token_ids]
    preview = " ".join(words[:16])
    prompt_snippet = prompt.strip()[:80]
    return f"[{model_id}] {prompt_snippet} -> {preview}".strip()


class NumpyCpuModelBackend:
    """Real multi-layer matrix-multiplication and softmax autoregressive backend using NumPy."""

    def __init__(self, spec: ModelSpec) -> None:
        self._spec = spec
        seed = int.from_bytes(hashlib.sha256(spec.model_id.encode("utf-8")).digest()[:4], "little")
        rng = np.random.default_rng(seed)

        self._embeddings = rng.standard_normal((spec.vocab_size, spec.hidden_dim), dtype=np.float32) * 0.08
        self._layers = [
            rng.standard_normal((spec.hidden_dim, spec.hidden_dim), dtype=np.float32)
            / np.sqrt(spec.hidden_dim, dtype=np.float32)
            for _ in range(spec.num_layers)
        ]
        self._lm_head = (
            rng.standard_normal((spec.hidden_dim, spec.vocab_size), dtype=np.float32)
            / np.sqrt(spec.hidden_dim, dtype=np.float32)
        )

        total_bytes = self._embeddings.nbytes + sum(w.nbytes for w in self._layers) + self._lm_head.nbytes
        self._footprint_mb = round(total_bytes / (1024 * 1024), 4)

    @property
    def backend_name(self) -> str:
        return "numpy_cpu_fallback"

    @property
    def footprint_mb(self) -> float:
        return self._footprint_mb

    def _forward_step(self, token_ids: list[int]) -> np.ndarray:
        seq_embeds = self._embeddings[token_ids]
        hidden = np.mean(seq_embeds, axis=0, keepdims=True)
        for weight in self._layers:
            projected = hidden @ weight
            hidden = np.tanh(projected) + hidden
        logits = (hidden @ self._lm_head)[0]
        return logits

    def generate(
        self,
        prompt: str,
        max_new_tokens: int,
        temperature: float = 0.7,
    ) -> tuple[str, int, int, float, float]:
        start_ns = time.perf_counter_ns()
        input_ids = tokenize_prompt(prompt, self._spec.vocab_size)
        if len(input_ids) > self._spec.max_context_length:
            raise InferenceError(
                f"Prompt token length {len(input_ids)} exceeds max context {self._spec.max_context_length}",
                "INVALID_MODEL_PARAMETERS",
                False,
            )

        target_tokens = max(1, min(int(max_new_tokens), 512))
        generated: list[int] = []
        context_ids = list(input_ids)
        ttft_ms = 0.0
        temp = max(float(temperature), 1e-3)

        for step in range(target_tokens):
            logits = self._forward_step(context_ids[-64:])
            scaled = logits / temp
            shifted = scaled - np.max(scaled)
            probs = np.exp(shifted)
            probs = probs / np.sum(probs)
            next_token = int(np.argmax(probs))
            generated.append(next_token)
            context_ids.append(next_token)
            if step == 0:
                ttft_ms = max((time.perf_counter_ns() - start_ns) / 1_000_000, 0.05)

        total_ms = max((time.perf_counter_ns() - start_ns) / 1_000_000, ttft_ms, 0.1)
        output_text = decode_tokens(self._spec.model_id, prompt, generated)
        return (
            output_text,
            len(input_ids),
            len(generated),
            round(ttft_ms, 3),
            round(total_ms, 3),
        )


class PyTorchModelBackend:
    """PyTorch neural network backend supporting CUDA GPU, CPU, and TorchScript JIT execution."""

    def __init__(
        self,
        spec: ModelSpec,
        torch_module: Any,
        device: str,
        use_torchscript: bool = False,
    ) -> None:
        self._spec = spec
        self._torch = torch_module
        self._device = device
        self._use_torchscript = use_torchscript
        self._traced_forward: Any | None = None

        seed = int.from_bytes(hashlib.sha256(spec.model_id.encode("utf-8")).digest()[:4], "little")
        self._torch.manual_seed(seed)

        self._embeddings = (
            self._torch.randn((spec.vocab_size, spec.hidden_dim), device=device) * 0.08
        )
        scale = float(spec.hidden_dim) ** 0.5
        self._layers = [
            self._torch.randn((spec.hidden_dim, spec.hidden_dim), device=device) / scale
            for _ in range(spec.num_layers)
        ]
        self._lm_head = (
            self._torch.randn((spec.hidden_dim, spec.vocab_size), device=device) / scale
        )

        if self._use_torchscript:
            jit_mod = getattr(self._torch, "jit", None)
            if jit_mod is not None and hasattr(jit_mod, "trace"):
                sample_idx = self._torch.tensor([1, 2], dtype=self._torch.long, device=device)
                self._traced_forward = jit_mod.trace(self._forward_tensor, (sample_idx,))

        elem_size = 4
        total_elems = (
            spec.vocab_size * spec.hidden_dim
            + spec.num_layers * spec.hidden_dim * spec.hidden_dim
            + spec.hidden_dim * spec.vocab_size
        )
        self._footprint_mb = round((total_elems * elem_size) / (1024 * 1024), 4)

    def _forward_tensor(self, idx_tensor: Any) -> Any:
        seq_embeds = self._embeddings[idx_tensor]
        hidden = seq_embeds.mean(dim=0, keepdim=True)
        for weight in self._layers:
            projected = self._torch.matmul(hidden, weight)
            hidden = self._torch.tanh(projected) + hidden
        return self._torch.matmul(hidden, self._lm_head)[0]

    @property
    def is_torchscript(self) -> bool:
        return self._use_torchscript

    @property
    def backend_name(self) -> str:
        prefix = "pytorch_torchscript" if self._use_torchscript else "pytorch"
        suffix = "cuda" if self._device.startswith("cuda") else "cpu"
        return f"{prefix}_{suffix}"

    @property
    def footprint_mb(self) -> float:
        return self._footprint_mb

    def generate(
        self,
        prompt: str,
        max_new_tokens: int,
        temperature: float = 0.7,
    ) -> tuple[str, int, int, float, float]:
        start_ns = time.perf_counter_ns()
        input_ids = tokenize_prompt(prompt, self._spec.vocab_size)
        if len(input_ids) > self._spec.max_context_length:
            raise InferenceError(
                f"Prompt token length {len(input_ids)} exceeds max context {self._spec.max_context_length}",
                "INVALID_MODEL_PARAMETERS",
                False,
            )

        target_tokens = max(1, min(int(max_new_tokens), 512))
        generated: list[int] = []
        context_ids = list(input_ids)
        ttft_ms = 0.0
        temp = max(float(temperature), 1e-3)
        forward_fn = self._traced_forward if self._traced_forward is not None else self._forward_tensor

        with self._torch.no_grad():
            for step in range(target_tokens):
                idx_tensor = self._torch.tensor(context_ids[-64:], dtype=self._torch.long, device=self._device)
                logits = forward_fn(idx_tensor) / temp
                next_token = int(self._torch.argmax(logits).item())
                generated.append(next_token)
                context_ids.append(next_token)
                if step == 0:
                    if self._device.startswith("cuda"):
                        self._torch.cuda.synchronize()
                    ttft_ms = max((time.perf_counter_ns() - start_ns) / 1_000_000, 0.05)

            if self._device.startswith("cuda"):
                self._torch.cuda.synchronize()

        total_ms = max((time.perf_counter_ns() - start_ns) / 1_000_000, ttft_ms, 0.1)
        output_text = decode_tokens(self._spec.model_id, prompt, generated)
        return (
            output_text,
            len(input_ids),
            len(generated),
            round(ttft_ms, 3),
            round(total_ms, 3),
        )


@dataclass(frozen=True)
class LoadedModel:
    """Container holding a loaded model specification, backend instance, and load timing."""

    spec: ModelSpec
    backend: ModelBackend
    load_duration_ms: float


class ModelLoader:
    """Caches and manages loaded inference models across GPU, CPU, and TorchScript backends."""

    def __init__(
        self,
        registry: dict[str, ModelSpec] | None = None,
        torch_module: Any | None = None,
        prefer_device: str = "auto",
    ) -> None:
        self._registry = dict(registry) if registry is not None else dict(DEFAULT_MODEL_REGISTRY)
        self._cache: dict[str, LoadedModel] = {}
        self._prefer_device = prefer_device
        if torch_module is not None:
            self._torch = torch_module
        else:
            try:
                import torch  # type: ignore[import-not-found]

                self._torch = torch
            except Exception:
                self._torch = None

    def resolve_spec(self, model_id: str) -> ModelSpec:
        if model_id in self._registry:
            return self._registry[model_id]
        # Dynamically construct a default spec for custom/unregistered model IDs
        return ModelSpec(
            model_id=model_id,
            hidden_dim=96,
            num_layers=3,
            vocab_size=256,
            max_context_length=4096,
            cost_microcents_per_token=5,
            estimated_vram_mb=8.0,
        )

    def resolve_device(self) -> str:
        if self._prefer_device in ("cpu", "cuda"):
            if self._prefer_device == "cuda" and self._torch is not None and self._torch.cuda.is_available():
                return "cuda"
            return "cpu"
        if self._torch is not None and bool(self._torch.cuda.is_available()):
            return "cuda"
        return "cpu"

    def load(self, model_id: str, use_torchscript: bool = False) -> tuple[LoadedModel, bool]:
        """Load or retrieve a cached model.

        Returns:
            (LoadedModel, is_warm_cache_hit)
        """
        cache_key = f"{model_id}::torchscript={use_torchscript}" if use_torchscript else model_id
        if cache_key in self._cache:
            return self._cache[cache_key], True

        start_ns = time.perf_counter_ns()
        spec = self.resolve_spec(model_id)
        device = self.resolve_device()

        backend: ModelBackend
        if self._torch is not None:
            backend = PyTorchModelBackend(
                spec=spec,
                torch_module=self._torch,
                device=device,
                use_torchscript=use_torchscript,
            )
        else:
            backend = NumpyCpuModelBackend(spec=spec)

        load_ms = round(max((time.perf_counter_ns() - start_ns) / 1_000_000, 0.05), 3)
        loaded = LoadedModel(spec=spec, backend=backend, load_duration_ms=load_ms)
        self._cache[cache_key] = loaded
        return loaded, False

    def clear_cache(self) -> None:
        self._cache.clear()

    def cached_models(self) -> list[str]:
        return list(self._cache.keys())
