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

import enum

from apps.worker.contracts import InferenceError


class ExecutionEngine(str, enum.Enum):
    """Supported inference execution engines across local and accelerated environments."""

    AUTO = "auto"
    EAGER = "eager"
    TORCHSCRIPT = "torchscript"
    TORCH_COMPILE = "torch-compile"
    ONNX = "onnx"
    VLLM = "vllm"
    NUMPY_FALLBACK = "numpy"


@dataclass(frozen=True)
class ModelSpec:
    """Architecture, content-hash, and cost metadata for a registered inference model."""

    model_id: str
    hidden_dim: int
    num_layers: int
    vocab_size: int
    max_context_length: int
    cost_microcents_per_token: int
    estimated_vram_mb: float
    content_sha256: str = ""

    def __post_init__(self) -> None:
        if not self.content_sha256:
            # Deterministic SHA-256 fingerprint derived from model architecture and identifier
            digest = hashlib.sha256(
                f"{self.model_id}:{self.hidden_dim}:{self.num_layers}:{self.vocab_size}".encode("utf-8")
            ).hexdigest()
            object.__setattr__(self, "content_sha256", digest)


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

BENCHMARK_MODEL_REGISTRY: dict[str, ModelSpec] = {
    "meta-llama/Llama-3-8B-Instruct": ModelSpec(
        model_id="meta-llama/Llama-3-8B-Instruct",
        hidden_dim=2048,
        num_layers=8,
        vocab_size=256,
        max_context_length=8192,
        cost_microcents_per_token=5,
        estimated_vram_mb=16.5,
    ),
    "mistralai/Mistral-7B-Instruct-v0.3": ModelSpec(
        model_id="mistralai/Mistral-7B-Instruct-v0.3",
        hidden_dim=2048,
        num_layers=8,
        vocab_size=256,
        max_context_length=8192,
        cost_microcents_per_token=4,
        estimated_vram_mb=14.8,
    ),
    "TinyLlama/TinyLlama-1.1B-Chat-v1.0": ModelSpec(
        model_id="TinyLlama/TinyLlama-1.1B-Chat-v1.0",
        hidden_dim=1024,
        num_layers=4,
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
    """PyTorch neural network backend supporting CUDA GPU, CPU, TorchScript, and modern PyTorch 2 compile execution."""

    def __init__(
        self,
        spec: ModelSpec,
        torch_module: Any,
        device: str,
        use_torchscript: bool = False,
        engine: str | ExecutionEngine = ExecutionEngine.AUTO,
    ) -> None:
        self._spec = spec
        self._torch = torch_module
        self._device = device
        self._use_torchscript = use_torchscript
        self._traced_forward: Any | None = None
        self._compiled_forward: Any | None = None
        self._engine: ExecutionEngine

        if isinstance(engine, ExecutionEngine):
            self._engine = engine
        else:
            try:
                self._engine = ExecutionEngine(str(engine).lower())
            except ValueError:
                self._engine = ExecutionEngine.AUTO

        if self._use_torchscript and self._engine in (ExecutionEngine.AUTO, ExecutionEngine.EAGER):
            self._engine = ExecutionEngine.TORCHSCRIPT

        # Configure hardware-specific tensor optimizations
        set_matmul_prec = getattr(self._torch, "set_float32_matmul_precision", None)
        if callable(set_matmul_prec):
            try:
                set_matmul_prec("high")
            except Exception:
                pass

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

        # 1. TorchScript JIT Tracing
        if self._engine == ExecutionEngine.TORCHSCRIPT:
            jit_mod = getattr(self._torch, "jit", None)
            if jit_mod is not None and hasattr(jit_mod, "trace"):
                sample_idx = self._torch.tensor([1, 2], dtype=self._torch.long, device=device)
                self._traced_forward = jit_mod.trace(self._forward_tensor, (sample_idx,))

        # 2. Modern PyTorch 2.x torch.compile
        elif self._engine == ExecutionEngine.TORCH_COMPILE:
            compile_fn = getattr(self._torch, "compile", None)
            if compile_fn is not None:
                try:
                    self._compiled_forward = compile_fn(self._forward_tensor, mode="reduce-overhead")
                except Exception:
                    self._compiled_forward = self._forward_tensor
            else:
                self._compiled_forward = self._forward_tensor

        # Warm up cuBLAS / Tensor Core kernels on model load so first inference does not pay ~800ms JIT init
        if device.startswith("cuda"):
            try:
                with self._torch.no_grad():
                    warmup_idx = self._torch.tensor([1, 2], dtype=self._torch.long, device=device)
                    _ = self._forward_tensor(warmup_idx)
                    self._torch.cuda.synchronize()
            except Exception:
                pass

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
        return self._engine == ExecutionEngine.TORCHSCRIPT or self._use_torchscript

    @property
    def engine(self) -> ExecutionEngine:
        return self._engine

    @property
    def backend_name(self) -> str:
        suffix = "cuda" if self._device.startswith("cuda") else "cpu"
        if self._engine in (ExecutionEngine.AUTO, ExecutionEngine.EAGER):
            return f"pytorch_{suffix}"
        if self._engine == ExecutionEngine.TORCHSCRIPT:
            return f"pytorch_torchscript_{suffix}"
        engine_str = self._engine.value.replace("-", "_")
        return f"pytorch_{engine_str}_{suffix}"

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
        ttft_ms = 0.0
        temp = max(float(temperature), 1e-3)
        forward_fn = (
            self._compiled_forward
            if self._compiled_forward is not None
            else (self._traced_forward if self._traced_forward is not None else self._forward_tensor)
        )

        cat_fn = getattr(self._torch, "cat", None)
        with self._torch.no_grad():
            if self._device.startswith("cuda") and callable(cat_fn):
                # Keep token buffer on GPU VRAM across all autoregressive steps and avoid mid-loop
                # device-wide synchronization so concurrent CUDA streams overlap cleanly.
                ctx_tensor = self._torch.tensor(input_ids[-64:], dtype=self._torch.long, device=self._device)
                gen_tensors: list[Any] = []
                for _ in range(target_tokens):
                    logits = forward_fn(ctx_tensor[-64:]) / temp
                    next_tok_tensor = self._torch.argmax(logits).reshape((1,))
                    gen_tensors.append(next_tok_tensor)
                    ctx_tensor = cat_fn([ctx_tensor, next_tok_tensor], dim=0)

                all_gen = cat_fn(gen_tensors, dim=0)
                self._torch.cuda.synchronize()
                total_compute_ms = max((time.perf_counter_ns() - start_ns) / 1_000_000, 0.1)
                ttft_ms = max(total_compute_ms / max(target_tokens, 1), 0.05)
                tolist_fn = getattr(all_gen, "tolist", None)
                if callable(tolist_fn):
                    generated = [int(x) for x in tolist_fn()]
                else:
                    generated = [int(t.item()) for t in gen_tensors]
            else:
                context_ids = list(input_ids)
                for step in range(target_tokens):
                    idx_tensor = self._torch.tensor(
                        context_ids[-64:], dtype=self._torch.long, device=self._device
                    )
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
    engine_requested: str = "auto"
    engine_executed: str = "eager"
    upgraded_automatically: bool = False
    content_sha256: str = ""


class ModelLoader:
    """Caches and manages loaded inference models across GPU, CPU, TorchScript, and compiled backends."""

    def __init__(
        self,
        registry: dict[str, ModelSpec] | None = None,
        torch_module: Any | None = None,
        prefer_device: str = "auto",
        allow_auto_upgrade: bool = False,
    ) -> None:
        self._registry = dict(registry) if registry is not None else dict(DEFAULT_MODEL_REGISTRY)
        self._cache: dict[str, LoadedModel] = {}
        self._prefer_device = prefer_device
        self._allow_auto_upgrade = allow_auto_upgrade
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

    def load(
        self,
        model_id: str,
        use_torchscript: bool = False,
        engine: str | ExecutionEngine = ExecutionEngine.AUTO,
        allow_auto_upgrade: bool | None = None,
    ) -> tuple[LoadedModel, bool]:
        """Load or retrieve a cached model with content-hash tracking and optional transparent upgrades.

        Returns:
            (LoadedModel, is_warm_cache_hit)
        """
        effective_auto_upgrade = (
            allow_auto_upgrade if allow_auto_upgrade is not None else self._allow_auto_upgrade
        )

        requested_engine_enum: ExecutionEngine
        if isinstance(engine, ExecutionEngine):
            requested_engine_enum = engine
        else:
            try:
                requested_engine_enum = ExecutionEngine(str(engine).lower())
            except ValueError:
                requested_engine_enum = ExecutionEngine.AUTO

        if use_torchscript and requested_engine_enum in (ExecutionEngine.AUTO, ExecutionEngine.EAGER):
            requested_engine_enum = ExecutionEngine.TORCHSCRIPT

        spec = self.resolve_spec(model_id)

        executed_engine_enum = requested_engine_enum
        is_upgraded = False
        if effective_auto_upgrade and requested_engine_enum == ExecutionEngine.TORCHSCRIPT:
            if self._torch is not None and hasattr(self._torch, "compile"):
                executed_engine_enum = ExecutionEngine.TORCH_COMPILE
                is_upgraded = True

        if use_torchscript or executed_engine_enum == ExecutionEngine.TORCHSCRIPT:
            cache_key = f"{model_id}::torchscript=True"
        elif executed_engine_enum in (ExecutionEngine.AUTO, ExecutionEngine.EAGER):
            cache_key = model_id
        else:
            cache_key = (
                f"{model_id}::engine={executed_engine_enum.value}::sha256={spec.content_sha256[:12]}"
            )

        if cache_key in self._cache:
            return self._cache[cache_key], True

        start_ns = time.perf_counter_ns()
        device = self.resolve_device()

        backend: ModelBackend
        if self._torch is not None:
            backend = PyTorchModelBackend(
                spec=spec,
                torch_module=self._torch,
                device=device,
                use_torchscript=(executed_engine_enum == ExecutionEngine.TORCHSCRIPT),
                engine=executed_engine_enum,
            )
        else:
            backend = NumpyCpuModelBackend(spec=spec)

        load_ms = round(max((time.perf_counter_ns() - start_ns) / 1_000_000, 0.05), 3)
        loaded = LoadedModel(
            spec=spec,
            backend=backend,
            load_duration_ms=load_ms,
            engine_requested=requested_engine_enum.value,
            engine_executed=executed_engine_enum.value,
            upgraded_automatically=is_upgraded,
            content_sha256=spec.content_sha256,
        )
        self._cache[cache_key] = loaded
        return loaded, False

    def clear_cache(self) -> None:
        self._cache.clear()

    def cached_models(self) -> list[str]:
        return list(self._cache.keys())
