# ADR-0002: Use Python and PyTorch for Inference Workers

- **Status**: Accepted
- **Date**: 2026-10-09
- **Deciders**: Architecture Team

---

## Context & Problem Statement

The platform requires a dedicated worker runtime capable of executing heavy machine learning inference workloads locally, managing GPU memory allocations (VRAM), loading Hugging Face models, and communicating with external AI inference APIs.

## Decision Drivers

- Deep integration with NVIDIA CUDA, ROCm, and modern GPU hardware acceleration.
- Native compatibility with state-of-the-art open weights (Llama, Mistral, Stable Diffusion, Whisper).
- Support for optimized inference engines, tensor parallelism, and quantization formats (BitsAndBytes, AWQ, GGUF, vLLM).
- Fast modern packaging and environment reproducibility.

## Considered Options

1. **Python with PyTorch and `uv`**
2. **C++ / LibTorch standalone binary**
3. **Rust with Candle / Burn**
4. **Triton Inference Server / ONNX Runtime**

## Decision Outcome

**Chosen option: Python with PyTorch and `uv`**.

### Rationale

- **Ecosystem Standard**: PyTorch is the uncontested standard for model definitions, weights format (`safetensors`), and tokenization. Nearly all open-source models originate in PyTorch.
- **Hardware Telemetry Access**: PyTorch provides direct programmatic access to CUDA memory allocators, device caches, and stream synchronization essential for VRAM budgeting and benchmarking.
- **Tooling Speed with `uv`**: Using Astral's `uv` resolves previous Python package management and virtualenv performance issues, achieving sub-second dependency installation and deterministic lockfiles.
- **Extensibility**: Allows seamless integration of future specialized inference backends (e.g., `vLLM` or `TensorRT-LLM`) as Python modules without re-architecting the worker loop.

## Consequences

- **Positive**:
  - Immediate compatibility with any modern open-source neural network checkpoint.
  - Straightforward integration with local NVIDIA RTX 5070 Ti drivers and cloud GPU instances.
  - Fast iteration and benchmarking cycles.
- **Negative / Trade-offs**:
  - Python Global Interpreter Lock (GIL) requires worker isolation to run as separate processes or container pods rather than multi-threaded shared memory execution.

