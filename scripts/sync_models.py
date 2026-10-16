#!/usr/bin/env python3
"""Enterprise Local Model Store Synchronizer (`models/` organized by domain).

Follows the NVIDIA Triton / KServe / BentoML / Hugging Face Enterprise Model Repository pattern:
- Tracked in Git:
  * `models/README.md` (architecture, empirical GPU vs CPU benchmark table & operational guide)
  * `models/manifest.json` (declarative lockfile with SHA-256 digests, layer dimensions, and HF Hub URIs)
- Gitignored on local disk (`models/<domain>/<org>--<model>/`):
  * `models/text-to-text/`
  * `models/text-to-image/`
  * `models/media-photo/`
  * `models/media-video/`
  Each model directory contains:
  * `config.json` (Hugging Face / Triton compatible architecture & modality config)
  * `hf_upstream/` (downloaded upstream Hugging Face `config.json`, `tokenizer_config.json`, `model.safetensors.index.json`, or `model_index.json`)
  * `weights.npz` (serialized Attention `W_attn` + SwiGLU/FFN `W_up`, `W_down` weight tensors)
  * `artifact_metadata.json` (local provenance, file byte size, and SHA-256 checksum)
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
from typing import Any
import urllib.request

import numpy as np  # type: ignore[import-not-found]

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from apps.worker.models import (  # noqa: E402
    BENCHMARK_MODEL_REGISTRY,
    DEFAULT_MODEL_REGISTRY,
    ModelSpec,
)

# Public ungated Hugging Face Hub mirrors for gated base repositories so upstream configs/indexes
# can always be downloaded without requiring a paid/gated HF_TOKEN.
UNGATED_HF_MIRRORS: dict[str, str] = {
    "meta-llama/Llama-3-8B-Instruct": "NousResearch/Meta-Llama-3-8B-Instruct",
    "google/gemma-2-9b-it": "unsloth/gemma-2-9b-it",
    "black-forest-labs/FLUX.1-schnell": "black-forest-labs/FLUX.1-schnell",
    "stabilityai/stable-diffusion-3.5-medium": "stabilityai/stable-diffusion-3-medium-diffusers",
}

HF_METADATA_FILES: tuple[str, ...] = (
    "config.json",
    "tokenizer_config.json",
    "model.safetensors.index.json",
    "model_index.json",
    "transformer/config.json",
)


def _download_hf_json_files(
    model_id: str,
    target_dir: Path,
    timeout_sec: float = 5.0,
) -> tuple[dict[str, Any] | None, list[str]]:
    """Download available upstream Hugging Face JSON config/index files into `target_dir/hf_upstream/`."""
    hf_dir = target_dir / "hf_upstream"
    hf_dir.mkdir(parents=True, exist_ok=True)

    candidates = [model_id]
    if model_id in UNGATED_HF_MIRRORS and UNGATED_HF_MIRRORS[model_id] != model_id:
        candidates.append(UNGATED_HF_MIRRORS[model_id])

    headers = {"User-Agent": "multi-tenant-ai-inference-platform/1.0"}
    hf_token = os.environ.get("HF_TOKEN")
    if hf_token:
        headers["Authorization"] = f"Bearer {hf_token}"

    primary_config: dict[str, Any] | None = None
    downloaded_files: list[str] = []

    for repo_id in candidates:
        for rel_file in HF_METADATA_FILES:
            url = f"https://huggingface.co/{repo_id}/resolve/main/{rel_file}"
            req = urllib.request.Request(url, headers=headers)
            try:
                with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
                    if resp.status == 200:
                        raw_bytes = resp.read()
                        parsed = json.loads(raw_bytes.decode("utf-8"))
                        safe_name = rel_file.replace("/", "_")
                        out_file = hf_dir / safe_name
                        out_file.write_text(json.dumps(parsed, indent=2) + "\n", encoding="utf-8")
                        if safe_name not in downloaded_files:
                            downloaded_files.append(safe_name)
                        if primary_config is None and isinstance(parsed, dict):
                            primary_config = parsed
            except Exception:
                continue
        if downloaded_files:
            break

    return primary_config, downloaded_files


def materialize_model_directory(
    default_spec: ModelSpec,
    bench_spec: ModelSpec,
    store_root: Path,
    fetch_hf: bool = False,
    materialize_profile: str = "benchmark",
) -> dict[str, Any]:
    """Create or update `models/<domain>/<org>--<model>/` with `config.json`, `hf_upstream/`, `weights.npz`, and metadata."""
    active_spec = bench_spec if materialize_profile == "benchmark" else default_spec
    model_dir = active_spec.resolve_local_dir(store_root)
    model_dir.mkdir(parents=True, exist_ok=True)

    upstream_cfg: dict[str, Any] | None = None
    downloaded_hf_files: list[str] = []
    if fetch_hf:
        upstream_cfg, downloaded_hf_files = _download_hf_json_files(active_spec.model_id, model_dir)

    config_payload: dict[str, Any] = {
        "model_id": active_spec.model_id,
        "domain_folder": active_spec.domain_folder,
        "modality": active_spec.modality,
        "leaderboard_tier": active_spec.leaderboard_tier,
        "huggingface_hub_url": f"https://huggingface.co/{active_spec.model_id}",
        "production_architecture": {
            "hidden_size": active_spec.production_hidden_dim,
            "intermediate_size": active_spec.production_intermediate_dim,
            "num_hidden_layers": active_spec.production_layers,
            "ffn_expansion_ratio": round(
                active_spec.production_intermediate_dim / max(active_spec.production_hidden_dim, 1), 2
            ),
            "vocab_size": active_spec.vocab_size,
            "max_position_embeddings": active_spec.max_context_length,
            "estimated_fp16_vram_gb": active_spec.estimated_vram_mb,
        },
        "benchmark_architecture": {
            "hidden_size": bench_spec.hidden_dim,
            "intermediate_size": bench_spec.effective_intermediate_dim,
            "num_hidden_layers": bench_spec.num_layers,
            "ffn_expansion_ratio": bench_spec.ffn_expansion_ratio,
            "num_patches": bench_spec.num_patches,
            "denoising_steps": bench_spec.denoising_steps,
            "content_sha256": bench_spec.content_sha256,
        },
        "ci_fixture_architecture": {
            "hidden_size": default_spec.hidden_dim,
            "intermediate_size": default_spec.effective_intermediate_dim,
            "num_hidden_layers": default_spec.num_layers,
            "ffn_expansion_ratio": default_spec.ffn_expansion_ratio,
            "num_patches": default_spec.num_patches,
            "denoising_steps": default_spec.denoising_steps,
            "content_sha256": default_spec.content_sha256,
        },
        "upstream_hf_config_fetched": upstream_cfg is not None,
        "upstream_hf_files_downloaded": downloaded_hf_files,
    }
    if upstream_cfg is not None:
        config_payload["upstream_hf_config_excerpt"] = {
            k: upstream_cfg[k]
            for k in (
                "architectures",
                "model_type",
                "_class_name",
                "hidden_size",
                "intermediate_size",
                "num_hidden_layers",
                "num_attention_heads",
                "num_key_value_heads",
                "vocab_size",
                "torch_dtype",
            )
            if k in upstream_cfg
        }

    config_path = model_dir / "config.json"
    config_path.write_text(json.dumps(config_payload, indent=2) + "\n", encoding="utf-8")

    # Materialize deterministic Attention + SwiGLU/FFN weight tensors into weights.npz
    seed = int.from_bytes(hashlib.sha256(active_spec.model_id.encode("utf-8")).digest()[:4], "little")
    rng = np.random.default_rng(seed)
    d_model = active_spec.hidden_dim
    d_ffn = active_spec.effective_intermediate_dim
    scale_model = np.sqrt(d_model, dtype=np.float32)
    scale_ffn = np.sqrt(d_ffn, dtype=np.float32)

    tensors: dict[str, np.ndarray] = {
        "embeddings": rng.standard_normal((active_spec.vocab_size, d_model), dtype=np.float32) * 0.08,
        "lm_head": rng.standard_normal((d_model, active_spec.vocab_size), dtype=np.float32) / scale_model,
    }
    for layer_idx in range(active_spec.num_layers):
        tensors[f"layer_{layer_idx}_attn"] = (
            rng.standard_normal((d_model, d_model), dtype=np.float32) / scale_model
        )
        tensors[f"layer_{layer_idx}_ffn_up"] = (
            rng.standard_normal((d_model, d_ffn), dtype=np.float32) / scale_model
        )
        tensors[f"layer_{layer_idx}_ffn_down"] = (
            rng.standard_normal((d_ffn, d_model), dtype=np.float32) / scale_ffn
        )

    weights_path = model_dir / "weights.npz"
    savez_fn: Any = np.savez
    savez_fn(weights_path, **tensors)
    weights_bytes = weights_path.read_bytes()
    weights_sha256 = hashlib.sha256(weights_bytes).hexdigest()
    weights_size_mb = round(len(weights_bytes) / (1024 * 1024), 4)

    rel_dir = f"models/{active_spec.domain_folder}/{active_spec.model_dir_slug}"
    meta_payload = {
        "model_id": active_spec.model_id,
        "domain_folder": active_spec.domain_folder,
        "modality": active_spec.modality,
        "local_relative_dir": rel_dir,
        "materialized_profile": materialize_profile,
        "weights_file": "weights.npz",
        "weights_sha256": weights_sha256,
        "weights_size_mb": weights_size_mb,
        "architecture_sha256": active_spec.content_sha256,
        "tensor_count": len(tensors),
        "upstream_hf_files": downloaded_hf_files,
    }
    meta_path = model_dir / "artifact_metadata.json"
    meta_path.write_text(json.dumps(meta_payload, indent=2) + "\n", encoding="utf-8")

    return {
        "model_id": active_spec.model_id,
        "domain": active_spec.domain_folder,
        "modality": active_spec.modality,
        "leaderboard_tier": active_spec.leaderboard_tier,
        "local_dir": rel_dir,
        "huggingface_url": f"https://huggingface.co/{active_spec.model_id}",
        "production_geometry": {
            "hidden_dim": active_spec.production_hidden_dim,
            "intermediate_dim": active_spec.production_intermediate_dim,
            "num_layers": active_spec.production_layers,
            "ffn_expansion_ratio": round(
                active_spec.production_intermediate_dim / max(active_spec.production_hidden_dim, 1), 2
            ),
            "estimated_fp16_vram_gb": active_spec.estimated_vram_mb,
        },
        "benchmark_geometry": {
            "hidden_dim": bench_spec.hidden_dim,
            "intermediate_dim": bench_spec.effective_intermediate_dim,
            "num_layers": bench_spec.num_layers,
            "ffn_expansion_ratio": bench_spec.ffn_expansion_ratio,
            "num_patches": bench_spec.num_patches,
            "denoising_steps": bench_spec.denoising_steps,
            "content_sha256": bench_spec.content_sha256,
        },
        "ci_fixture_geometry": {
            "hidden_dim": default_spec.hidden_dim,
            "intermediate_dim": default_spec.effective_intermediate_dim,
            "num_layers": default_spec.num_layers,
            "ffn_expansion_ratio": default_spec.ffn_expansion_ratio,
            "content_sha256": default_spec.content_sha256,
        },
    }


def sync_all_models(
    store_root: Path | None = None,
    fetch_hf: bool = False,
    profile: str = "default",
) -> dict[str, Any]:
    """Synchronize all 12 registered models into `models/<domain>/<org>--<model>/` and write `models/manifest.json`."""
    root = store_root if store_root is not None else (REPO_ROOT / "models")
    root.mkdir(parents=True, exist_ok=True)

    entries: list[dict[str, Any]] = []
    domains_summary: dict[str, list[str]] = {}

    for model_id, default_spec in DEFAULT_MODEL_REGISTRY.items():
        bench_spec = BENCHMARK_MODEL_REGISTRY[model_id]
        entry = materialize_model_directory(
            default_spec=default_spec,
            bench_spec=bench_spec,
            store_root=root,
            fetch_hf=fetch_hf,
            materialize_profile=profile,
        )
        entries.append(entry)
        domains_summary.setdefault(default_spec.domain_folder, []).append(model_id)

    manifest = {
        "schema_version": "1.0.0",
        "repository_pattern": "NVIDIA Triton / KServe / Hugging Face Enterprise Domain Model Store",
        "store_root": "models",
        "total_models": len(entries),
        "domains": domains_summary,
        "models": entries,
    }
    manifest_path = root / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return manifest


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Synchronize local domain-organized AI model store (`models/`).")
    parser.add_argument(
        "--profile",
        choices=["default", "benchmark"],
        default="benchmark",
        help="Weight tensor profile to materialize on disk (`benchmark` for full benchmark tensors, `default` for fast CI).",
    )
    parser.add_argument(
        "--fetch-hf",
        action="store_true",
        help="Fetch live upstream `config.json`, `tokenizer_config.json`, and `model.safetensors.index.json` from Hugging Face Hub.",
    )
    parser.add_argument(
        "--store-root",
        default=str(REPO_ROOT / "models"),
        help="Target directory for the model store (default: `models/`).",
    )
    args = parser.parse_args(argv)

    manifest = sync_all_models(
        store_root=Path(args.store_root),
        fetch_hf=bool(args.fetch_hf),
        profile=str(args.profile),
    )
    print(
        f"Synchronized {manifest['total_models']} models across {len(manifest['domains'])} domains in `{args.store_root}` (profile={args.profile})."
    )
    for m in manifest["models"]:
        print(
            f"  - [{m['domain']}] {m['model_id']} -> {m['local_dir']} "
            f"(bench: d_model={m['benchmark_geometry']['hidden_dim']}, d_ffn={m['benchmark_geometry']['intermediate_dim']})"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
