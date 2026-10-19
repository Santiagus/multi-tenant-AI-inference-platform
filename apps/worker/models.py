"""Model abstraction, registry, and tensor forward-pass execution engine.

Provides a unified abstraction over:
- PyTorch neural network execution (GPU CUDA or CPU tensors when `torch` is installed)
- Deterministic NumPy tensor forward pass fallback when running in lightweight CPU-only environments
- Realistic Transformer layer geometry (Attention `d_model x d_model` + SwiGLU/FFN `d_model x d_ffn x d_model`)
- Modality-aware compute profiles across `text_to_text`, `text_to_image` (DiT), `media_photo` (ViT), and `media_video` (3D DiT)
"""

from __future__ import annotations

from dataclasses import dataclass, replace
import enum
import hashlib
from pathlib import Path
import time
from typing import Any, Protocol

import numpy as np  # type: ignore[import-not-found]

from apps.worker.contracts import InferenceError

MODALITY_TO_DOMAIN_FOLDER: dict[str, str] = {
    "text_to_text": "text-to-text",
    "text_to_image": "text-to-image",
    "media_photo": "media-photo",
    "media_video": "media-video",
}


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
    """Architecture, modality, content-hash, and cost metadata for a registered inference model."""

    model_id: str
    hidden_dim: int
    num_layers: int
    vocab_size: int
    max_context_length: int
    cost_microcents_per_token: int
    estimated_vram_mb: float
    content_sha256: str = ""
    intermediate_dim: int = 0
    modality: str = "text_to_text"
    num_patches: int = 0
    denoising_steps: int = 0
    production_hidden_dim: int = 0
    production_intermediate_dim: int = 0
    production_layers: int = 0
    leaderboard_tier: str = ""
    quantization: str = "none"

    def __post_init__(self) -> None:
        if not self.content_sha256:
            # Deterministic SHA-256 fingerprint derived from model architecture, identifier, and quantization
            raw = (
                f"{self.model_id}:{self.hidden_dim}:{self.num_layers}:{self.vocab_size}"
                if self.quantization == "none"
                else f"{self.model_id}:{self.hidden_dim}:{self.num_layers}:{self.vocab_size}:{self.quantization}"
            )
            digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()
            object.__setattr__(self, "content_sha256", digest)

    @property
    def effective_intermediate_dim(self) -> int:
        return self.intermediate_dim if self.intermediate_dim > 0 else self.hidden_dim

    @property
    def ffn_expansion_ratio(self) -> float:
        return round(self.effective_intermediate_dim / max(self.hidden_dim, 1), 2)

    @property
    def domain_folder(self) -> str:
        return MODALITY_TO_DOMAIN_FOLDER.get(self.modality, "text-to-text")

    @property
    def model_dir_slug(self) -> str:
        return self.model_id.replace("/", "--")

    def resolve_local_dir(self, store_root: Path | None = None) -> Path:
        root = store_root if store_root is not None else (Path(__file__).resolve().parents[2] / "models")
        return root / self.domain_folder / self.model_dir_slug



# Fast CI / Unit-Test Registry (<10ms CPU execution while preserving exact modality and FFN ratios)
DEFAULT_MODEL_REGISTRY: dict[str, ModelSpec] = {
    # 1. Text-to-Text (Autoregressive Open-Weights LLMs from Artificial Analysis Leaderboard)
    "meta-llama/Llama-3-8B-Instruct": ModelSpec(
        model_id="meta-llama/Llama-3-8B-Instruct",
        hidden_dim=128,
        intermediate_dim=448,
        num_layers=4,
        vocab_size=256,
        max_context_length=8192,
        cost_microcents_per_token=5,
        estimated_vram_mb=16.5,
        modality="text_to_text",
        production_hidden_dim=4096,
        production_intermediate_dim=14336,
        production_layers=32,
        leaderboard_tier="open_weights_llm_baseline",
    ),
    "Qwen/Qwen2.5-7B-Instruct": ModelSpec(
        model_id="Qwen/Qwen2.5-7B-Instruct",
        hidden_dim=128,
        intermediate_dim=576,
        num_layers=4,
        vocab_size=256,
        max_context_length=32768,
        cost_microcents_per_token=4,
        estimated_vram_mb=15.2,
        modality="text_to_text",
        production_hidden_dim=3584,
        production_intermediate_dim=18944,
        production_layers=28,
        leaderboard_tier="open_weights_llm_top_general_coding",
    ),
    "deepseek-ai/DeepSeek-R1-Distill-Qwen-7B": ModelSpec(
        model_id="deepseek-ai/DeepSeek-R1-Distill-Qwen-7B",
        hidden_dim=128,
        intermediate_dim=576,
        num_layers=4,
        vocab_size=256,
        max_context_length=32768,
        cost_microcents_per_token=4,
        estimated_vram_mb=15.2,
        modality="text_to_text",
        production_hidden_dim=3584,
        production_intermediate_dim=18944,
        production_layers=28,
        leaderboard_tier="open_weights_llm_top_reasoning",
    ),
    "google/gemma-2-9b-it": ModelSpec(
        model_id="google/gemma-2-9b-it",
        hidden_dim=128,
        intermediate_dim=512,
        num_layers=5,
        vocab_size=256,
        max_context_length=8192,
        cost_microcents_per_token=5,
        estimated_vram_mb=18.4,
        modality="text_to_text",
        production_hidden_dim=3584,
        production_intermediate_dim=14336,
        production_layers=42,
        leaderboard_tier="open_weights_llm_efficiency_leader",
    ),
    "mistralai/Mistral-7B-Instruct-v0.3": ModelSpec(
        model_id="mistralai/Mistral-7B-Instruct-v0.3",
        hidden_dim=128,
        intermediate_dim=448,
        num_layers=4,
        vocab_size=256,
        max_context_length=32768,
        cost_microcents_per_token=4,
        estimated_vram_mb=14.8,
        modality="text_to_text",
        production_hidden_dim=4096,
        production_intermediate_dim=14336,
        production_layers=32,
        leaderboard_tier="open_weights_llm_low_latency_gqa",
    ),
    "TinyLlama/TinyLlama-1.1B-Chat-v1.0": ModelSpec(
        model_id="TinyLlama/TinyLlama-1.1B-Chat-v1.0",
        hidden_dim=64,
        intermediate_dim=176,
        num_layers=2,
        vocab_size=256,
        max_context_length=4096,
        cost_microcents_per_token=2,
        estimated_vram_mb=2.2,
        modality="text_to_text",
        production_hidden_dim=2048,
        production_intermediate_dim=5632,
        production_layers=22,
        leaderboard_tier="open_weights_slm_edge",
    ),
    # 2. Text-to-Image (Diffusion Transformers / MMDiT on Artificial Analysis Image Arena)
    "black-forest-labs/FLUX.1-schnell": ModelSpec(
        model_id="black-forest-labs/FLUX.1-schnell",
        hidden_dim=128,
        intermediate_dim=512,
        num_layers=3,
        vocab_size=256,
        max_context_length=4096,
        cost_microcents_per_token=8,
        estimated_vram_mb=12.4,
        modality="text_to_image",
        num_patches=16,
        denoising_steps=4,
        production_hidden_dim=3072,
        production_intermediate_dim=12288,
        production_layers=19,
        leaderboard_tier="open_weights_t2i_leader_apache2",
    ),
    "stabilityai/stable-diffusion-3.5-medium": ModelSpec(
        model_id="stabilityai/stable-diffusion-3.5-medium",
        hidden_dim=128,
        intermediate_dim=512,
        num_layers=3,
        vocab_size=256,
        max_context_length=4096,
        cost_microcents_per_token=6,
        estimated_vram_mb=9.8,
        modality="text_to_image",
        num_patches=16,
        denoising_steps=4,
        production_hidden_dim=1536,
        production_intermediate_dim=6144,
        production_layers=24,
        leaderboard_tier="open_weights_t2i_consumer_gpu",
    ),
    # 3. Media Inference - Photo (Vision Transformers & VLMs)
    "Qwen/Qwen2.5-VL-7B-Instruct": ModelSpec(
        model_id="Qwen/Qwen2.5-VL-7B-Instruct",
        hidden_dim=96,
        intermediate_dim=384,
        num_layers=3,
        vocab_size=256,
        max_context_length=16384,
        cost_microcents_per_token=5,
        estimated_vram_mb=15.8,
        modality="media_photo",
        num_patches=24,
        production_hidden_dim=1280,
        production_intermediate_dim=5120,
        production_layers=32,
        leaderboard_tier="open_weights_vlm_photo_leader",
    ),
    "openai/clip-vit-large-patch14": ModelSpec(
        model_id="openai/clip-vit-large-patch14",
        hidden_dim=96,
        intermediate_dim=384,
        num_layers=3,
        vocab_size=256,
        max_context_length=4096,
        cost_microcents_per_token=2,
        estimated_vram_mb=1.7,
        modality="media_photo",
        num_patches=32,
        production_hidden_dim=1024,
        production_intermediate_dim=4096,
        production_layers=24,
        leaderboard_tier="open_weights_vit_photo_encoder",
    ),
    # 4. Media Inference - Video (3D Spatiotemporal Diffusion & Video Understanding)
    "Wan-AI/Wan2.1-T2V-1.3B": ModelSpec(
        model_id="Wan-AI/Wan2.1-T2V-1.3B",
        hidden_dim=96,
        intermediate_dim=384,
        num_layers=3,
        vocab_size=256,
        max_context_length=8192,
        cost_microcents_per_token=9,
        estimated_vram_mb=8.2,
        modality="media_video",
        num_patches=24,
        denoising_steps=3,
        production_hidden_dim=1536,
        production_intermediate_dim=8960,
        production_layers=30,
        leaderboard_tier="open_weights_video_leader_16gb_gpu",
    ),
    "THUDM/CogVideoX-2b": ModelSpec(
        model_id="THUDM/CogVideoX-2b",
        hidden_dim=96,
        intermediate_dim=384,
        num_layers=3,
        vocab_size=256,
        max_context_length=8192,
        cost_microcents_per_token=10,
        estimated_vram_mb=9.6,
        modality="media_video",
        num_patches=24,
        denoising_steps=3,
        production_hidden_dim=1920,
        production_intermediate_dim=7680,
        production_layers=30,
        leaderboard_tier="open_weights_video_3d_dit",
    ),
}

# Tier 2: Unified Production & Benchmarking Registry
# Full Production Geometries using 4-bit quantization (INT4 / GGUF / AWQ / bitsandbytes)
# Memory stays within 0.65 - 6.8 GB on both CPU (AVX-512) and GPU (RTX 5070 Ti Tensor Cores)
PRODUCTION_MODEL_REGISTRY: dict[str, ModelSpec] = {
    # 1. Text-to-Text (Autoregressive Open-Weights LLMs from Artificial Analysis Leaderboard)
    "meta-llama/Llama-3-8B-Instruct": ModelSpec(
        model_id="meta-llama/Llama-3-8B-Instruct",
        hidden_dim=4096,
        intermediate_dim=14336,
        num_layers=32,
        vocab_size=256,
        max_context_length=8192,
        cost_microcents_per_token=5,
        estimated_vram_mb=4800.0,  # ~4.8 GB INT4
        quantization="int4",
        modality="text_to_text",
        production_hidden_dim=4096,
        production_intermediate_dim=14336,
        production_layers=32,
        leaderboard_tier="open_weights_llm_baseline",
    ),
    "Qwen/Qwen2.5-7B-Instruct": ModelSpec(
        model_id="Qwen/Qwen2.5-7B-Instruct",
        hidden_dim=3584,
        intermediate_dim=18944,
        num_layers=28,
        vocab_size=256,
        max_context_length=32768,
        cost_microcents_per_token=4,
        estimated_vram_mb=4500.0,
        quantization="int4",
        modality="text_to_text",
        production_hidden_dim=3584,
        production_intermediate_dim=18944,
        production_layers=28,
        leaderboard_tier="open_weights_llm_top_general_coding",
    ),
    "deepseek-ai/DeepSeek-R1-Distill-Qwen-7B": ModelSpec(
        model_id="deepseek-ai/DeepSeek-R1-Distill-Qwen-7B",
        hidden_dim=3584,
        intermediate_dim=18944,
        num_layers=28,
        vocab_size=256,
        max_context_length=32768,
        cost_microcents_per_token=4,
        estimated_vram_mb=4500.0,
        quantization="int4",
        modality="text_to_text",
        production_hidden_dim=3584,
        production_intermediate_dim=18944,
        production_layers=28,
        leaderboard_tier="open_weights_llm_top_reasoning",
    ),
    "google/gemma-2-9b-it": ModelSpec(
        model_id="google/gemma-2-9b-it",
        hidden_dim=3584,
        intermediate_dim=14336,
        num_layers=42,
        vocab_size=256,
        max_context_length=8192,
        cost_microcents_per_token=5,
        estimated_vram_mb=5400.0,
        quantization="int4",
        modality="text_to_text",
        production_hidden_dim=3584,
        production_intermediate_dim=14336,
        production_layers=42,
        leaderboard_tier="open_weights_llm_efficiency_leader",
    ),
    "mistralai/Mistral-7B-Instruct-v0.3": ModelSpec(
        model_id="mistralai/Mistral-7B-Instruct-v0.3",
        hidden_dim=4096,
        intermediate_dim=14336,
        num_layers=32,
        vocab_size=256,
        max_context_length=32768,
        cost_microcents_per_token=4,
        estimated_vram_mb=4400.0,
        quantization="int4",
        modality="text_to_text",
        production_hidden_dim=4096,
        production_intermediate_dim=14336,
        production_layers=32,
        leaderboard_tier="open_weights_llm_low_latency_gqa",
    ),
    "TinyLlama/TinyLlama-1.1B-Chat-v1.0": ModelSpec(
        model_id="TinyLlama/TinyLlama-1.1B-Chat-v1.0",
        hidden_dim=2048,
        intermediate_dim=5632,
        num_layers=22,
        vocab_size=256,
        max_context_length=4096,
        cost_microcents_per_token=2,
        estimated_vram_mb=650.0,  # ~0.65 GB INT4
        quantization="int4",
        modality="text_to_text",
        production_hidden_dim=2048,
        production_intermediate_dim=5632,
        production_layers=22,
        leaderboard_tier="open_weights_slm_edge",
    ),
    # 2. Text-to-Image (Diffusion Transformers / MMDiT)
    "black-forest-labs/FLUX.1-schnell": ModelSpec(
        model_id="black-forest-labs/FLUX.1-schnell",
        hidden_dim=3072,
        intermediate_dim=12288,
        num_layers=19,
        vocab_size=256,
        max_context_length=4096,
        cost_microcents_per_token=8,
        estimated_vram_mb=6800.0,  # ~6.8 GB NF4/INT4, 4-step MMDiT
        quantization="nf4",
        modality="text_to_image",
        num_patches=64,
        denoising_steps=4,
        production_hidden_dim=3072,
        production_intermediate_dim=12288,
        production_layers=19,
        leaderboard_tier="open_weights_t2i_leader_apache2",
    ),
    "stabilityai/stable-diffusion-3.5-medium": ModelSpec(
        model_id="stabilityai/stable-diffusion-3.5-medium",
        hidden_dim=1536,
        intermediate_dim=6144,
        num_layers=24,
        vocab_size=256,
        max_context_length=4096,
        cost_microcents_per_token=6,
        estimated_vram_mb=4200.0,
        quantization="int4",
        modality="text_to_image",
        num_patches=64,
        denoising_steps=4,
        production_hidden_dim=1536,
        production_intermediate_dim=6144,
        production_layers=24,
        leaderboard_tier="open_weights_t2i_consumer_gpu",
    ),
    # 3. Media Inference - Photo (Vision Transformers & Multimodal VLMs)
    "Qwen/Qwen2.5-VL-7B-Instruct": ModelSpec(
        model_id="Qwen/Qwen2.5-VL-7B-Instruct",
        hidden_dim=1280,
        intermediate_dim=5120,
        num_layers=32,
        vocab_size=256,
        max_context_length=16384,
        cost_microcents_per_token=5,
        estimated_vram_mb=5200.0,  # ~5.2 GB INT4
        quantization="int4",
        modality="media_photo",
        num_patches=196,
        production_hidden_dim=1280,
        production_intermediate_dim=5120,
        production_layers=32,
        leaderboard_tier="open_weights_vlm_photo_leader",
    ),
    "openai/clip-vit-large-patch14": ModelSpec(
        model_id="openai/clip-vit-large-patch14",
        hidden_dim=1024,
        intermediate_dim=4096,
        num_layers=24,
        vocab_size=256,
        max_context_length=4096,
        cost_microcents_per_token=2,
        estimated_vram_mb=900.0,  # ~0.9 GB INT8
        quantization="int8",
        modality="media_photo",
        num_patches=256,
        production_hidden_dim=1024,
        production_intermediate_dim=4096,
        production_layers=24,
        leaderboard_tier="open_weights_vit_photo_encoder",
    ),
    # 4. Media Inference - Video (3D Spatiotemporal Tubelet DiT)
    "Wan-AI/Wan2.1-T2V-1.3B": ModelSpec(
        model_id="Wan-AI/Wan2.1-T2V-1.3B",
        hidden_dim=1536,
        intermediate_dim=8960,
        num_layers=30,
        vocab_size=256,
        max_context_length=8192,
        cost_microcents_per_token=9,
        estimated_vram_mb=1800.0,  # ~1.8 GB INT4
        quantization="int4",
        modality="media_video",
        num_patches=128,
        denoising_steps=4,
        production_hidden_dim=1536,
        production_intermediate_dim=8960,
        production_layers=30,
        leaderboard_tier="open_weights_video_leader_16gb_gpu",
    ),
    "THUDM/CogVideoX-2b": ModelSpec(
        model_id="THUDM/CogVideoX-2b",
        hidden_dim=1920,
        intermediate_dim=7680,
        num_layers=30,
        vocab_size=256,
        max_context_length=8192,
        cost_microcents_per_token=10,
        estimated_vram_mb=2400.0,  # ~2.4 GB INT4
        quantization="int4",
        modality="media_video",
        num_patches=128,
        denoising_steps=6,
        production_hidden_dim=1920,
        production_intermediate_dim=7680,
        production_layers=30,
        leaderboard_tier="open_weights_video_3d_dit",
    ),
}

# Realistic Hardware Benchmark Registry (Exceeds 64 MiB CPU L3 cache while fitting 16 GB RTX 5070 Ti)
BENCHMARK_MODEL_REGISTRY: dict[str, ModelSpec] = {
    # 1. Text-to-Text (Autoregressive LLMs: Attention + SwiGLU FFN)
    "meta-llama/Llama-3-8B-Instruct": ModelSpec(
        model_id="meta-llama/Llama-3-8B-Instruct",
        hidden_dim=1024,
        intermediate_dim=3584,  # 3.5x SwiGLU expansion (matches Llama-3 4096 -> 14336)
        num_layers=4,
        vocab_size=256,
        max_context_length=8192,
        cost_microcents_per_token=5,
        estimated_vram_mb=16.5,
        modality="text_to_text",
        production_hidden_dim=4096,
        production_intermediate_dim=14336,
        production_layers=32,
        leaderboard_tier="open_weights_llm_baseline",
    ),
    "Qwen/Qwen2.5-7B-Instruct": ModelSpec(
        model_id="Qwen/Qwen2.5-7B-Instruct",
        hidden_dim=1024,
        intermediate_dim=4608,  # 4.5x wide SwiGLU expansion (reflects Qwen2.5 3584 -> 18944)
        num_layers=4,
        vocab_size=256,
        max_context_length=32768,
        cost_microcents_per_token=4,
        estimated_vram_mb=15.2,
        modality="text_to_text",
        production_hidden_dim=3584,
        production_intermediate_dim=18944,
        production_layers=28,
        leaderboard_tier="open_weights_llm_top_general_coding",
    ),
    "deepseek-ai/DeepSeek-R1-Distill-Qwen-7B": ModelSpec(
        model_id="deepseek-ai/DeepSeek-R1-Distill-Qwen-7B",
        hidden_dim=1024,
        intermediate_dim=4608,  # 4.5x wide SwiGLU expansion
        num_layers=4,
        vocab_size=256,
        max_context_length=32768,
        cost_microcents_per_token=4,
        estimated_vram_mb=15.2,
        modality="text_to_text",
        production_hidden_dim=3584,
        production_intermediate_dim=18944,
        production_layers=28,
        leaderboard_tier="open_weights_llm_top_reasoning",
    ),
    "google/gemma-2-9b-it": ModelSpec(
        model_id="google/gemma-2-9b-it",
        hidden_dim=1024,
        intermediate_dim=4096,  # 4.0x GeGLU expansion with deeper layer stack
        num_layers=5,
        vocab_size=256,
        max_context_length=8192,
        cost_microcents_per_token=5,
        estimated_vram_mb=18.4,
        modality="text_to_text",
        production_hidden_dim=3584,
        production_intermediate_dim=14336,
        production_layers=42,
        leaderboard_tier="open_weights_llm_efficiency_leader",
    ),
    "mistralai/Mistral-7B-Instruct-v0.3": ModelSpec(
        model_id="mistralai/Mistral-7B-Instruct-v0.3",
        hidden_dim=1024,
        intermediate_dim=3584,  # 3.5x SwiGLU expansion (matches Mistral-7B 4096 -> 14336)
        num_layers=4,
        vocab_size=256,
        max_context_length=32768,
        cost_microcents_per_token=4,
        estimated_vram_mb=14.8,
        modality="text_to_text",
        production_hidden_dim=4096,
        production_intermediate_dim=14336,
        production_layers=32,
        leaderboard_tier="open_weights_llm_low_latency_gqa",
    ),
    "TinyLlama/TinyLlama-1.1B-Chat-v1.0": ModelSpec(
        model_id="TinyLlama/TinyLlama-1.1B-Chat-v1.0",
        hidden_dim=768,
        intermediate_dim=2112,  # 2.75x SwiGLU expansion (matches TinyLlama 2048 -> 5632)
        num_layers=3,
        vocab_size=256,
        max_context_length=4096,
        cost_microcents_per_token=2,
        estimated_vram_mb=2.2,
        modality="text_to_text",
        production_hidden_dim=2048,
        production_intermediate_dim=5632,
        production_layers=22,
        leaderboard_tier="open_weights_slm_edge",
    ),
    # 2. Text-to-Image (Diffusion Transformers / MMDiT: Iterative Spatial Latent Patch GEMM)
    "black-forest-labs/FLUX.1-schnell": ModelSpec(
        model_id="black-forest-labs/FLUX.1-schnell",
        hidden_dim=1024,
        intermediate_dim=4096,  # 4.0x MMDiT MLP expansion
        num_layers=4,
        vocab_size=256,
        max_context_length=4096,
        cost_microcents_per_token=8,
        estimated_vram_mb=12.4,
        modality="text_to_image",
        num_patches=64,
        denoising_steps=4,
        production_hidden_dim=3072,
        production_intermediate_dim=12288,
        production_layers=19,
        leaderboard_tier="open_weights_t2i_leader_apache2",
    ),
    "stabilityai/stable-diffusion-3.5-medium": ModelSpec(
        model_id="stabilityai/stable-diffusion-3.5-medium",
        hidden_dim=1024,
        intermediate_dim=4096,  # 4.0x MMDiT MLP expansion
        num_layers=4,
        vocab_size=256,
        max_context_length=4096,
        cost_microcents_per_token=6,
        estimated_vram_mb=9.8,
        modality="text_to_image",
        num_patches=64,
        denoising_steps=8,
        production_hidden_dim=1536,
        production_intermediate_dim=6144,
        production_layers=24,
        leaderboard_tier="open_weights_t2i_consumer_gpu",
    ),
    # 3. Media Inference - Photo (Vision Transformers & Multimodal VLMs: High-Patch Single-Pass Prefill)
    "Qwen/Qwen2.5-VL-7B-Instruct": ModelSpec(
        model_id="Qwen/Qwen2.5-VL-7B-Instruct",
        hidden_dim=1024,
        intermediate_dim=4096,  # 4.0x ViT MLP expansion
        num_layers=4,
        vocab_size=256,
        max_context_length=16384,
        cost_microcents_per_token=5,
        estimated_vram_mb=15.8,
        modality="media_photo",
        num_patches=196,
        production_hidden_dim=1280,
        production_intermediate_dim=5120,
        production_layers=32,
        leaderboard_tier="open_weights_vlm_photo_leader",
    ),
    "openai/clip-vit-large-patch14": ModelSpec(
        model_id="openai/clip-vit-large-patch14",
        hidden_dim=1024,
        intermediate_dim=4096,  # Exact CLIP ViT-L/14 hidden=1024, ffn=4096 geometry
        num_layers=4,
        vocab_size=256,
        max_context_length=4096,
        cost_microcents_per_token=2,
        estimated_vram_mb=1.7,
        modality="media_photo",
        num_patches=256,
        production_hidden_dim=1024,
        production_intermediate_dim=4096,
        production_layers=24,
        leaderboard_tier="open_weights_vit_photo_encoder",
    ),
    # 4. Media Inference - Video (3D Spatiotemporal Tubelet DiT)
    "Wan-AI/Wan2.1-T2V-1.3B": ModelSpec(
        model_id="Wan-AI/Wan2.1-T2V-1.3B",
        hidden_dim=1024,
        intermediate_dim=4096,
        num_layers=4,
        vocab_size=256,
        max_context_length=8192,
        cost_microcents_per_token=9,
        estimated_vram_mb=8.2,
        modality="media_video",
        num_patches=128,
        denoising_steps=4,
        production_hidden_dim=1536,
        production_intermediate_dim=8960,
        production_layers=30,
        leaderboard_tier="open_weights_video_leader_16gb_gpu",
    ),
    "THUDM/CogVideoX-2b": ModelSpec(
        model_id="THUDM/CogVideoX-2b",
        hidden_dim=1024,
        intermediate_dim=4096,
        num_layers=4,
        vocab_size=256,
        max_context_length=8192,
        cost_microcents_per_token=10,
        estimated_vram_mb=9.6,
        modality="media_video",
        num_patches=128,
        denoising_steps=6,
        production_hidden_dim=1920,
        production_intermediate_dim=7680,
        production_layers=30,
        leaderboard_tier="open_weights_video_3d_dit",
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

    @property
    def quantization(self) -> str: ...

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


def build_step_token_ids(
    spec: ModelSpec,
    context_ids: list[int],
    step: int,
) -> list[int]:
    """Construct the input token/patch sequence for step `step` based on model modality.

    - `text_to_text`: Step 0 runs full prompt prefill `(N_prompt, d_model)` GEMM; subsequent steps run
      KV-cached single-token `(1, d_model)` GEMV decode.
    - `text_to_image`: First `denoising_steps` iterations run dense spatial patch `(N_patches, d_model)`
      MMDiT/DiT GEMM passes; subsequent steps run token readout.
    - `media_photo`: Step 0 runs high-patch-count ViT spatial prefill `(N_patches + N_prompt, d_model)` GEMM;
      subsequent steps run fast classification/caption readout.
    - `media_video`: First `denoising_steps` iterations run 3D spatiotemporal tubelet `(N_patches, d_model)`
      GEMM passes; subsequent steps run temporal metadata readout.
    """
    vocab = max(spec.vocab_size, 2)
    base_tokens = context_ids[-64:] if context_ids else [1]
    modality = spec.modality

    if modality == "text_to_image":
        patches = max(spec.num_patches, 16)
        steps = max(spec.denoising_steps, 2)
        if step < steps:
            return [(base_tokens[i % len(base_tokens)] + i + step) % vocab for i in range(patches)]
        return [(base_tokens[-1] + step) % vocab]

    if modality == "media_photo":
        if step == 0:
            patches = max(spec.num_patches, 16)
            visual_tokens = [(base_tokens[i % len(base_tokens)] + i) % vocab for i in range(patches)]
            return visual_tokens + base_tokens[-32:]
        return [(base_tokens[-1] + step) % vocab]

    if modality == "media_video":
        patches = max(spec.num_patches, 24)
        steps = max(spec.denoising_steps, 2)
        if step < steps:
            return [(base_tokens[i % len(base_tokens)] + i * 3 + step) % vocab for i in range(patches)]
        return [(base_tokens[-1] + step) % vocab]

    # Default: text_to_text (Step 0 = full prompt prefill GEMM; Step >= 1 = single-token KV-cached decode GEMV)
    if step == 0:
        return base_tokens
    return [(base_tokens[-1] + step) % vocab]


class NumpyCpuModelBackend:
    """Real multi-layer Attention + FFN matrix-multiplication backend using NumPy."""

    def __init__(self, spec: ModelSpec) -> None:
        self._spec = spec
        self._is_quantized = spec.quantization in ("int4", "nf4", "awq", "int8")
        self._quantization = spec.quantization

        seed = int.from_bytes(hashlib.sha256(spec.model_id.encode("utf-8")).digest()[:4], "little")
        rng = np.random.default_rng(seed)

        d_model = spec.hidden_dim
        d_ffn = spec.effective_intermediate_dim
        scale_model = np.sqrt(d_model, dtype=np.float32)
        scale_ffn = np.sqrt(d_ffn, dtype=np.float32)

        self._embeddings = rng.standard_normal((spec.vocab_size, d_model), dtype=np.float32) * 0.08
        if self._is_quantized:
            q_bits = 8 if spec.quantization == "int8" else 4
            q_min, q_max = (-128, 127) if q_bits == 8 else (-8, 7)
            elem_size = 1.0 if q_bits == 8 else 0.5

            self._attn_layers = [
                rng.integers(q_min, q_max, size=(d_model, d_model), dtype=np.int8)
                for _ in range(spec.num_layers)
            ]
            self._ffn_up_layers = [
                rng.integers(q_min, q_max, size=(d_model, d_ffn), dtype=np.int8)
                for _ in range(spec.num_layers)
            ]
            self._ffn_down_layers = [
                rng.integers(q_min, q_max, size=(d_ffn, d_model), dtype=np.int8)
                for _ in range(spec.num_layers)
            ]
            self._attn_scales = [
                rng.standard_normal((d_model,), dtype=np.float32) * 0.05 / scale_model
                for _ in range(spec.num_layers)
            ]
            self._ffn_up_scales = [
                rng.standard_normal((d_ffn,), dtype=np.float32) * 0.05 / scale_model
                for _ in range(spec.num_layers)
            ]
            self._ffn_down_scales = [
                rng.standard_normal((d_model,), dtype=np.float32) * 0.05 / scale_ffn
                for _ in range(spec.num_layers)
            ]
            self._footprint_mb = (
                spec.estimated_vram_mb
                if spec.estimated_vram_mb > 0
                else round((spec.num_layers * (d_model * d_model + 2 * d_model * d_ffn) * elem_size) / (1024 * 1024), 4)
            )
        else:
            self._attn_layers = [
                rng.standard_normal((d_model, d_model), dtype=np.float32) / scale_model
                for _ in range(spec.num_layers)
            ]
            self._ffn_up_layers = [
                rng.standard_normal((d_model, d_ffn), dtype=np.float32) / scale_model
                for _ in range(spec.num_layers)
            ]
            self._ffn_down_layers = [
                rng.standard_normal((d_ffn, d_model), dtype=np.float32) / scale_ffn
                for _ in range(spec.num_layers)
            ]
            layer_bytes = sum(w.nbytes for w in self._attn_layers) + sum(
                u.nbytes + d.nbytes for u, d in zip(self._ffn_up_layers, self._ffn_down_layers)
            )
            total_bytes = self._embeddings.nbytes + layer_bytes
            self._footprint_mb = round(total_bytes / (1024 * 1024), 4)

        self._lm_head = (
            rng.standard_normal((d_model, spec.vocab_size), dtype=np.float32) / scale_model
        )

    @property
    def backend_name(self) -> str:
        if self._is_quantized:
            return f"numpy_{self._quantization}_cpu"
        return "numpy_cpu_fallback"

    @property
    def footprint_mb(self) -> float:
        return self._footprint_mb

    @property
    def quantization(self) -> str:
        return self._quantization

    def _forward_step(self, token_ids: list[int]) -> np.ndarray:
        hidden = self._embeddings[token_ids]
        if self._is_quantized:
            for idx in range(self._spec.num_layers):
                w_attn = self._attn_layers[idx].astype(np.float32) * self._attn_scales[idx]
                attn_proj = hidden @ w_attn
                hidden = np.tanh(attn_proj) + hidden
                w_up = self._ffn_up_layers[idx].astype(np.float32) * self._ffn_up_scales[idx]
                ffn_up = np.tanh(hidden @ w_up)
                w_down = self._ffn_down_layers[idx].astype(np.float32) * self._ffn_down_scales[idx]
                ffn_down = ffn_up @ w_down
                hidden = ffn_down + hidden
        else:
            for idx, w_attn in enumerate(self._attn_layers):
                attn_proj = hidden @ w_attn
                hidden = np.tanh(attn_proj) + hidden
                ffn_up = np.tanh(hidden @ self._ffn_up_layers[idx])
                ffn_down = ffn_up @ self._ffn_down_layers[idx]
                hidden = ffn_down + hidden
        pooled = np.mean(hidden, axis=0, keepdims=True)
        logits = (pooled @ self._lm_head)[0]
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
            step_ids = build_step_token_ids(self._spec, context_ids, step)
            logits = self._forward_step(step_ids)
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
    """PyTorch neural network backend supporting CUDA GPU, CPU, TorchScript, and PyTorch 2 compile execution."""

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
        self._is_quantized = spec.quantization in ("int4", "nf4", "awq", "int8")
        self._quantization = spec.quantization

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

        d_model = spec.hidden_dim
        d_ffn = spec.effective_intermediate_dim
        scale_model = float(d_model) ** 0.5
        scale_ffn = float(d_ffn) ** 0.5

        self._embeddings = (
            self._torch.randn((spec.vocab_size, d_model), device=device) * 0.08
        )

        elem_size = 4
        per_layer_elems = (d_model * d_model) + (2 * d_model * d_ffn)
        total_elems = (
            spec.vocab_size * d_model
            + spec.num_layers * per_layer_elems
            + d_model * spec.vocab_size
        )

        if self._is_quantized:
            q_bits = 8 if spec.quantization == "int8" else 4
            q_elem_size = 1.0 if q_bits == 8 else 0.5
            randint_fn = getattr(self._torch, "randint", None)
            int8_dtype = getattr(self._torch, "int8", None)
            if randint_fn is not None and int8_dtype is not None:
                q_min, q_max = (-128, 127) if q_bits == 8 else (-8, 7)
                self._attn_layers = [
                    randint_fn(q_min, q_max, (d_model, d_model), device=device, dtype=int8_dtype)
                    for _ in range(spec.num_layers)
                ]
                self._ffn_up_layers = [
                    randint_fn(q_min, q_max, (d_model, d_ffn), device=device, dtype=int8_dtype)
                    for _ in range(spec.num_layers)
                ]
                self._ffn_down_layers = [
                    randint_fn(q_min, q_max, (d_ffn, d_model), device=device, dtype=int8_dtype)
                    for _ in range(spec.num_layers)
                ]
            else:
                self._attn_layers = [
                    self._torch.randn((d_model, d_model), device=device) / scale_model
                    for _ in range(spec.num_layers)
                ]
                self._ffn_up_layers = [
                    self._torch.randn((d_model, d_ffn), device=device) / scale_model
                    for _ in range(spec.num_layers)
                ]
                self._ffn_down_layers = [
                    self._torch.randn((d_ffn, d_model), device=device) / scale_ffn
                    for _ in range(spec.num_layers)
                ]

            self._attn_scales = [
                self._torch.randn((d_model,), device=device) * 0.05 / scale_model
                for _ in range(spec.num_layers)
            ]
            self._ffn_up_scales = [
                self._torch.randn((d_ffn,), device=device) * 0.05 / scale_model
                for _ in range(spec.num_layers)
            ]
            self._ffn_down_scales = [
                self._torch.randn((d_model,), device=device) * 0.05 / scale_ffn
                for _ in range(spec.num_layers)
            ]
            self._footprint_mb = (
                spec.estimated_vram_mb
                if spec.estimated_vram_mb > 0
                else round((total_elems * q_elem_size) / (1024 * 1024), 4)
            )
        else:
            self._attn_layers = [
                self._torch.randn((d_model, d_model), device=device) / scale_model
                for _ in range(spec.num_layers)
            ]
            self._ffn_up_layers = [
                self._torch.randn((d_model, d_ffn), device=device) / scale_model
                for _ in range(spec.num_layers)
            ]
            self._ffn_down_layers = [
                self._torch.randn((d_ffn, d_model), device=device) / scale_ffn
                for _ in range(spec.num_layers)
            ]
            self._footprint_mb = round((total_elems * elem_size) / (1024 * 1024), 4)

        self._lm_head = (
            self._torch.randn((d_model, spec.vocab_size), device=device) / scale_model
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
                    self._compiled_forward = compile_fn(self._forward_tensor, dynamic=True)
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

    def _forward_tensor(self, idx_tensor: Any) -> Any:
        hidden = self._embeddings[idx_tensor]
        if self._is_quantized:
            for idx in range(self._spec.num_layers):
                w_attn = self._attn_layers[idx]
                w_attn_f = w_attn.float() * self._attn_scales[idx] if hasattr(w_attn, "float") else w_attn
                attn_proj = self._torch.matmul(hidden, w_attn_f)
                hidden = self._torch.tanh(attn_proj) + hidden

                w_up = self._ffn_up_layers[idx]
                w_up_f = w_up.float() * self._ffn_up_scales[idx] if hasattr(w_up, "float") else w_up
                ffn_up = self._torch.tanh(self._torch.matmul(hidden, w_up_f))

                w_down = self._ffn_down_layers[idx]
                w_down_f = w_down.float() * self._ffn_down_scales[idx] if hasattr(w_down, "float") else w_down
                ffn_down = self._torch.matmul(ffn_up, w_down_f)
                hidden = ffn_down + hidden
        else:
            for idx, w_attn in enumerate(self._attn_layers):
                attn_proj = self._torch.matmul(hidden, w_attn)
                hidden = self._torch.tanh(attn_proj) + hidden
                ffn_up = self._torch.tanh(self._torch.matmul(hidden, self._ffn_up_layers[idx]))
                ffn_down = self._torch.matmul(ffn_up, self._ffn_down_layers[idx])
                hidden = ffn_down + hidden
        pooled = hidden.mean(dim=0, keepdim=True)
        return self._torch.matmul(pooled, self._lm_head)[0]

    @property
    def is_torchscript(self) -> bool:
        return self._engine == ExecutionEngine.TORCHSCRIPT or self._use_torchscript

    @property
    def engine(self) -> ExecutionEngine:
        return self._engine

    @property
    def backend_name(self) -> str:
        suffix = "cuda" if self._device.startswith("cuda") else "cpu"
        q_prefix = f"{self._quantization}_" if self._is_quantized else ""
        if self._engine in (ExecutionEngine.AUTO, ExecutionEngine.EAGER):
            return f"pytorch_{q_prefix}{suffix}"
        if self._engine == ExecutionEngine.TORCHSCRIPT:
            return f"pytorch_{q_prefix}torchscript_{suffix}"
        engine_str = self._engine.value.replace("-", "_")
        return f"pytorch_{q_prefix}{engine_str}_{suffix}"

    @property
    def footprint_mb(self) -> float:
        return self._footprint_mb

    @property
    def quantization(self) -> str:
        return self._spec.quantization

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
                # Step 0: Prefill / spatial patch pass on GPU, synchronized once to capture authentic TTFT
                gen_tensors: list[Any] = []
                step0_ids = build_step_token_ids(self._spec, input_ids, 0)
                step0_tensor = self._torch.tensor(step0_ids, dtype=self._torch.long, device=self._device)
                logits0 = forward_fn(step0_tensor) / temp
                next_tok0 = self._torch.argmax(logits0).reshape((1,))
                gen_tensors.append(next_tok0)
                self._torch.cuda.synchronize()
                ttft_ms = max((time.perf_counter_ns() - start_ns) / 1_000_000, 0.05)

                # Steps 1..N-1: Queue remaining decode / denoising passes on GPU stream without mid-loop sync
                for step in range(1, target_tokens):
                    step_ids = build_step_token_ids(self._spec, input_ids, step)
                    step_tensor = self._torch.tensor(step_ids, dtype=self._torch.long, device=self._device)
                    logits = forward_fn(step_tensor) / temp
                    next_tok_tensor = self._torch.argmax(logits).reshape((1,))
                    gen_tensors.append(next_tok_tensor)

                all_gen = cat_fn(gen_tensors, dim=0)
                self._torch.cuda.synchronize()
                tolist_fn = getattr(all_gen, "tolist", None)
                if callable(tolist_fn):
                    generated = [int(x) for x in tolist_fn()]
                else:
                    generated = [int(t.item()) for t in gen_tensors]
            else:
                context_ids = list(input_ids)
                for step in range(target_tokens):
                    step_ids = build_step_token_ids(self._spec, context_ids, step)
                    idx_tensor = self._torch.tensor(
                        step_ids, dtype=self._torch.long, device=self._device
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
        tier: int | str = 1,
    ) -> None:
        self._tier = tier
        if registry is not None:
            self._registry = dict(registry)
        elif tier in ("benchmark", 3, "bench"):
            self._registry = dict(BENCHMARK_MODEL_REGISTRY)
        elif tier == 2:
            self._registry = dict(PRODUCTION_MODEL_REGISTRY)
        else:
            self._registry = dict(DEFAULT_MODEL_REGISTRY)
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

    def resolve_spec(
        self,
        model_id: str,
        tier: int | str | None = None,
        quantization: str | None = None,
    ) -> ModelSpec:
        eff_tier = tier if tier is not None else self._tier
        if quantization:
            eff_tier = 2
        spec: ModelSpec
        if eff_tier in ("benchmark", 3, "bench") and model_id in BENCHMARK_MODEL_REGISTRY:
            spec = BENCHMARK_MODEL_REGISTRY[model_id]
        elif eff_tier == 2 and model_id in PRODUCTION_MODEL_REGISTRY:
            spec = PRODUCTION_MODEL_REGISTRY[model_id]
        elif model_id in self._registry:
            spec = self._registry[model_id]
        elif model_id in BENCHMARK_MODEL_REGISTRY:
            spec = BENCHMARK_MODEL_REGISTRY[model_id]
        elif model_id in PRODUCTION_MODEL_REGISTRY:
            spec = PRODUCTION_MODEL_REGISTRY[model_id]
        else:
            # Dynamically construct a default spec for custom/unregistered model IDs
            spec = ModelSpec(
                model_id=model_id,
                hidden_dim=96,
                intermediate_dim=288,
                num_layers=3,
                vocab_size=256,
                max_context_length=4096,
                cost_microcents_per_token=5,
                estimated_vram_mb=8.0,
            )
        if quantization and spec.quantization != quantization:
            return replace(spec, quantization=quantization)
        return spec

    def resolve_device(self, prefer_device: str | None = None) -> str:
        target = (prefer_device or self._prefer_device).lower()
        if target == "cpu":
            return "cpu"
        if target in ("cuda", "gpu"):
            if self._torch is not None and bool(self._torch.cuda.is_available()):
                return "cuda"
            raise InferenceError(
                "CUDA GPU device requested ('local/gpu'), but no CUDA device is available",
                "CUDA_DEVICE_UNAVAILABLE",
                False,
            )
        if self._torch is not None and bool(self._torch.cuda.is_available()):
            return "cuda"
        return "cpu"

    def load(
        self,
        model_id: str,
        use_torchscript: bool = False,
        engine: str | ExecutionEngine = ExecutionEngine.AUTO,
        allow_auto_upgrade: bool | None = None,
        device: str | None = None,
        tier: int | str | None = None,
        quantization: str | None = None,
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
            raw_engine = str(engine).lower().replace("_", "-")
            try:
                requested_engine_enum = ExecutionEngine(raw_engine)
            except ValueError:
                requested_engine_enum = ExecutionEngine.AUTO

        if use_torchscript and requested_engine_enum in (ExecutionEngine.AUTO, ExecutionEngine.EAGER):
            requested_engine_enum = ExecutionEngine.TORCHSCRIPT

        eff_tier = tier if tier is not None else self._tier
        if quantization in ("int4", "int8", "nf4", "awq"):
            eff_tier = 2

        spec = self.resolve_spec(model_id, tier=eff_tier)
        if quantization and spec.quantization != quantization:
            spec = ModelSpec(
                model_id=spec.model_id,
                hidden_dim=spec.hidden_dim,
                intermediate_dim=spec.intermediate_dim,
                num_layers=spec.num_layers,
                vocab_size=spec.vocab_size,
                max_context_length=spec.max_context_length,
                cost_microcents_per_token=spec.cost_microcents_per_token,
                estimated_vram_mb=spec.estimated_vram_mb,
                modality=spec.modality,
                num_patches=spec.num_patches,
                denoising_steps=spec.denoising_steps,
                production_hidden_dim=spec.production_hidden_dim,
                production_intermediate_dim=spec.production_intermediate_dim,
                production_layers=spec.production_layers,
                leaderboard_tier=spec.leaderboard_tier,
                quantization=quantization,
            )

        executed_engine_enum = requested_engine_enum
        is_upgraded = False
        if effective_auto_upgrade and requested_engine_enum == ExecutionEngine.TORCHSCRIPT:
            if self._torch is not None and hasattr(self._torch, "compile"):
                executed_engine_enum = ExecutionEngine.TORCH_COMPILE
                is_upgraded = True

        effective_device = self.resolve_device(prefer_device=device)

        cache_key = (
            f"{model_id}::tier={eff_tier}::q={spec.quantization}::device={effective_device}::"
            f"engine={executed_engine_enum.value}::"
            f"torchscript={executed_engine_enum == ExecutionEngine.TORCHSCRIPT}::"
            f"sha256={spec.content_sha256[:12]}"
        )

        if cache_key in self._cache:
            return self._cache[cache_key], True

        # Evict oldest entry if cache exceeds 4 items to maintain zero swap thrashing
        if len(self._cache) >= 4:
            first_key = next(iter(self._cache))
            del self._cache[first_key]

        start_ns = time.perf_counter_ns()

        backend: ModelBackend
        if self._torch is not None and executed_engine_enum != ExecutionEngine.NUMPY_FALLBACK:
            backend = PyTorchModelBackend(
                spec=spec,
                torch_module=self._torch,
                device=effective_device,
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
        keys = list(self._cache.keys())
        base_models = [k.split("::")[0] for k in keys]
        return list(dict.fromkeys(base_models + keys))
