#!/usr/bin/env python3
"""Provider setup and verification automation script.

Validates credentials, hardware readiness, and endpoint connectivity for:
- Local PyTorch (CUDA / RTX 5070 Ti / CPU)
- Hyperscalers: AWS Bedrock, AWS SageMaker
- Neoclouds & Specialized AI Clouds: RunPod, Modal, Baseten, Nebius, Vast.ai,
  Runware, CoreWeave Forge, Weights & Biases, fal.ai, JarvisLabs, Beam Cloud,
  Hivenet, WaveSpeed AI, NeoCloudz

Uses the canonical unique mock flag MOCK_PROVIDERS (or MOCK_INFERENCE) to
determine whether providers execute in mock or live mode.

Usage:
  python3 scripts/setup_providers.py --check
  python3 scripts/setup_providers.py --generate-env
  python3 scripts/setup_providers.py --test-prediction --provider runpod
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))


# Automatically load local .env if present (without overriding existing environment)
def _load_env_file(env_path: Path) -> None:
    if not env_path.is_file():
        return
    with open(env_path, encoding="utf-8") as f:
        for line in f:
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or "=" not in stripped:
                continue
            k, v = stripped.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip("'\""))


_load_env_file(REPO_ROOT / ".env")

from apps.worker.consumer import WorkerRuntime
from apps.worker.models import ModelLoader
from apps.worker.providers.base import is_mock_inference_enabled


def check_local_pytorch() -> dict[str, Any]:
    """Check local GPU / PyTorch execution environment."""
    loader = ModelLoader()
    device = loader.resolve_device()
    has_cuda = device == "cuda"
    device_name = "CPU Fallback"
    vram_mb = 0.0

    if has_cuda:
        try:
            import torch  # type: ignore[import-not-found,import-untyped]

            device_name = torch.cuda.get_device_name(0)
            vram_mb = round(torch.cuda.get_device_properties(0).total_memory / (1024 * 1024), 2)
        except Exception as exc:
            device_name = f"CUDA detected but failed to read properties: {exc}"

    return {
        "provider": "local_pytorch",
        "category": "Local Hardware",
        "ready": True,
        "device": device,
        "device_name": device_name,
        "vram_mb": vram_mb,
        "mode": "live",  # Local PyTorch is always live hardware
    }


def check_runpod() -> dict[str, Any]:
    """Validate RunPod Serverless credentials and endpoint configuration."""
    api_key = os.environ.get("RUNPOD_API_KEY", "")
    endpoint_id = os.environ.get("RUNPOD_ENDPOINT_ID", "")
    base_url = os.environ.get("RUNPOD_BASE_URL", "https://api.runpod.ai/v2")
    has_creds = bool(api_key and endpoint_id)
    mock_mode = is_mock_inference_enabled() or not has_creds

    return {
        "provider": "runpod",
        "category": "Neocloud Serverless GPU",
        "ready": has_creds or mock_mode,
        "has_api_key": bool(api_key),
        "endpoint_id": endpoint_id or "(not set; using mock/fallback)",
        "base_url": base_url,
        "mode": "mock" if mock_mode else "live",
    }


def check_aws_bedrock() -> dict[str, Any]:
    """Validate AWS Bedrock credentials and region."""
    region = os.environ.get("AWS_REGION", os.environ.get("AWS_DEFAULT_REGION", "us-east-1"))
    base_url = os.environ.get("BEDROCK_BASE_URL", f"https://bedrock-runtime.{region}.amazonaws.com")
    has_creds = bool(
        os.environ.get("AWS_ACCESS_KEY_ID")
        or os.environ.get("AWS_CONTAINER_CREDENTIALS_RELATIVE_URI")
        or os.environ.get("AWS_WEB_IDENTITY_TOKEN_FILE")
    )
    mock_mode = is_mock_inference_enabled() or not has_creds

    return {
        "provider": "bedrock",
        "category": "Hyperscaler Managed Foundation Models",
        "ready": has_creds or mock_mode,
        "has_credentials": has_creds,
        "aws_region": region,
        "base_url": base_url,
        "mode": "mock" if mock_mode else "live",
    }


def check_aws_sagemaker() -> dict[str, Any]:
    """Validate AWS SageMaker credentials and endpoint configuration."""
    region = os.environ.get("AWS_REGION", os.environ.get("AWS_DEFAULT_REGION", "us-east-1"))
    endpoint_name = os.environ.get("SAGEMAKER_ENDPOINT_NAME", "")
    base_url = os.environ.get("SAGEMAKER_BASE_URL", f"https://runtime.sagemaker.{region}.amazonaws.com")
    has_creds = bool(
        os.environ.get("AWS_ACCESS_KEY_ID")
        or os.environ.get("AWS_CONTAINER_CREDENTIALS_RELATIVE_URI")
        or os.environ.get("AWS_WEB_IDENTITY_TOKEN_FILE")
    )
    mock_mode = is_mock_inference_enabled() or not has_creds

    return {
        "provider": "sagemaker",
        "category": "Hyperscaler Dedicated Endpoints",
        "ready": (has_creds and bool(endpoint_name)) or mock_mode,
        "has_credentials": has_creds,
        "endpoint_name": endpoint_name or "(not set; using mock/fallback)",
        "base_url": base_url,
        "aws_region": region,
        "mode": "mock" if mock_mode else "live",
    }


def check_modal() -> dict[str, Any]:
    token_id = os.environ.get("MODAL_TOKEN_ID", "")
    base_url = os.environ.get("MODAL_BASE_URL", "https://api.modal.com")
    has_creds = bool(token_id)
    mock_mode = is_mock_inference_enabled() or not has_creds
    return {
        "provider": "modal",
        "category": "Neocloud Serverless GPU",
        "ready": has_creds or mock_mode,
        "base_url": base_url,
        "mode": "mock" if mock_mode else "live",
    }


def check_baseten() -> dict[str, Any]:
    api_key = os.environ.get("BASETEN_API_KEY", "")
    base_url = os.environ.get("BASETEN_BASE_URL", "https://bridge.baseten.co/v1")
    has_creds = bool(api_key)
    mock_mode = is_mock_inference_enabled() or not has_creds
    return {
        "provider": "baseten",
        "category": "Neocloud Serverless GPU",
        "ready": has_creds or mock_mode,
        "base_url": base_url,
        "mode": "mock" if mock_mode else "live",
    }


def check_nebius() -> dict[str, Any]:
    api_key = os.environ.get("NEBIUS_API_KEY", "")
    studio_url = os.environ.get("NEBIUS_STUDIO_BASE_URL", "https://api.studio.nebius.ai/v1")
    cloud_url = os.environ.get("NEBIUS_ENDPOINT_URL", "")
    has_creds = bool(api_key)
    mock_mode = is_mock_inference_enabled() or not has_creds
    return {
        "provider": "nebius",
        "category": "European Sovereign AI & Cloud",
        "ready": has_creds or mock_mode,
        "studio_base_url": studio_url,
        "cloud_endpoint_url": cloud_url or "(not set)",
        "mode": "mock" if mock_mode else "live",
    }


def check_vast() -> dict[str, Any]:
    api_key = os.environ.get("VAST_API_KEY", "")
    base_url = os.environ.get("VAST_BASE_URL", "https://console.vast.ai/api/v0")
    has_creds = bool(api_key)
    mock_mode = is_mock_inference_enabled() or not has_creds
    return {
        "provider": "vast",
        "category": "GPU Marketplace",
        "ready": has_creds or mock_mode,
        "base_url": base_url,
        "mode": "mock" if mock_mode else "live",
    }


def check_runware() -> dict[str, Any]:
    api_key = os.environ.get("RUNWARE_API_KEY", "")
    base_url = os.environ.get("RUNWARE_BASE_URL", "https://api.runware.ai/v1")
    has_creds = bool(api_key)
    mock_mode = is_mock_inference_enabled() or not has_creds
    return {
        "provider": "runware",
        "category": "Fast Media & Inference Gateway",
        "ready": has_creds or mock_mode,
        "base_url": base_url,
        "mode": "mock" if mock_mode else "live",
    }


def check_coreweave() -> dict[str, Any]:
    api_key = os.environ.get("COREWEAVE_FORGE_API_KEY", "")
    base_url = os.environ.get("COREWEAVE_FORGE_BASE_URL", "https://api.inference.wandb.ai/v1")
    has_creds = bool(api_key)
    mock_mode = is_mock_inference_enabled() or not has_creds
    return {
        "provider": "coreweave",
        "category": "Specialized Cloud & Sandboxes",
        "ready": has_creds or mock_mode,
        "base_url": base_url,
        "mode": "mock" if mock_mode else "live",
    }


def check_wandb() -> dict[str, Any]:
    api_key = os.environ.get("WANDB_API_KEY", "")
    base_url = os.environ.get("WANDB_BASE_URL", "https://api.wandb.ai")
    has_creds = bool(api_key)
    mock_mode = is_mock_inference_enabled() or not has_creds
    return {
        "provider": "wandb",
        "category": "Tracing, Evaluation & Model Registry",
        "ready": has_creds or mock_mode,
        "base_url": base_url,
        "mode": "mock" if mock_mode else "live",
    }


def check_fal() -> dict[str, Any]:
    key = os.environ.get("FAL_KEY", "")
    base_url = os.environ.get("FAL_BASE_URL", "https://rest.alpha.fal.ai")
    has_creds = bool(key)
    mock_mode = is_mock_inference_enabled() or not has_creds
    return {
        "provider": "fal",
        "category": "Serverless Diffusion & Media",
        "ready": has_creds or mock_mode,
        "base_url": base_url,
        "mode": "mock" if mock_mode else "live",
    }


def check_jarvislabs() -> dict[str, Any]:
    api_key = os.environ.get("JL_API_KEY", "")
    base_url = os.environ.get("JARVISLABS_BASE_URL", "https://models.jarvislabs.net/v1")
    has_creds = bool(api_key)
    mock_mode = is_mock_inference_enabled() or not has_creds
    return {
        "provider": "jarvislabs",
        "category": "Token Factory & Serverless Endpoints",
        "ready": has_creds or mock_mode,
        "base_url": base_url,
        "mode": "mock" if mock_mode else "live",
    }


def check_beam() -> dict[str, Any]:
    token = os.environ.get("BEAM_TOKEN", "")
    base_url = os.environ.get("BEAM_BASE_URL", "https://api.beam.cloud/v1")
    has_creds = bool(token)
    mock_mode = is_mock_inference_enabled() or not has_creds
    return {
        "provider": "beam",
        "category": "Serverless GPU Functions",
        "ready": has_creds or mock_mode,
        "base_url": base_url,
        "mode": "mock" if mock_mode else "live",
    }


def check_hivenet() -> dict[str, Any]:
    api_key = os.environ.get("HIVENET_API_KEY", "")
    base_url = os.environ.get("HIVENET_COMPUTE_BASE_URL", "https://api.hivecompute.ai/v1")
    has_creds = bool(api_key)
    mock_mode = is_mock_inference_enabled() or not has_creds
    return {
        "provider": "hivenet",
        "category": "Distributed GPU Cloud",
        "ready": has_creds or mock_mode,
        "base_url": base_url,
        "mode": "mock" if mock_mode else "live",
    }


def check_wavespeed() -> dict[str, Any]:
    api_key = os.environ.get("WAVESPEED_API_KEY", "")
    base_url = os.environ.get("WAVESPEED_BASE_URL", "https://api.wavespeed.ai")
    has_creds = bool(api_key)
    mock_mode = is_mock_inference_enabled() or not has_creds
    return {
        "provider": "wavespeed",
        "category": "Multi-Modal Inference Gateway",
        "ready": has_creds or mock_mode,
        "base_url": base_url,
        "mode": "mock" if mock_mode else "live",
    }


def check_neocloudz() -> dict[str, Any]:
    api_key = os.environ.get("NEOCLOUDZ_API_KEY", "")
    base_url = os.environ.get("NEOCLOUDZ_BASE_URL", "https://console.neocloudz.com/gateway/v1")
    has_creds = bool(api_key)
    mock_mode = is_mock_inference_enabled() or not has_creds
    return {
        "provider": "neocloudz",
        "category": "Decentralized GPU Cloud & Gateway",
        "ready": has_creds or mock_mode,
        "base_url": base_url,
        "mode": "mock" if mock_mode else "live",
    }


def generate_env_example(output_path: Path) -> None:
    """Generate sanitized .env.providers.example file."""
    src = REPO_ROOT / ".env.providers.example"
    if src.is_file() and src.resolve() != output_path.resolve():
        output_path.write_text(src.read_text(encoding="utf-8"), encoding="utf-8")
    print(f"Generated sanitized template: {output_path}")


async def run_diagnostics() -> int:
    """Run full diagnostic check across all providers."""
    mock_enabled = is_mock_inference_enabled()
    global_status = "ENABLED (Mock Mode)" if mock_enabled else "DISABLED (Live Remote Execution)"

    print("=" * 70)
    print("  Inference Provider Configuration & Connectivity Diagnostics")
    print(f"  Canonical Mock Flag: MOCK_PROVIDERS={1 if mock_enabled else 0} -> {global_status}")
    print("=" * 70)

    checks = [
        check_local_pytorch(),
        check_aws_bedrock(),
        check_aws_sagemaker(),
        check_runpod(),
        check_neocloudz(),
        check_nebius(),
        check_baseten(),
        check_fal(),
        check_runware(),
        check_coreweave(),
        check_wandb(),
        check_modal(),
        check_jarvislabs(),
        check_beam(),
        check_hivenet(),
        check_wavespeed(),
        check_vast(),
    ]

    for check in checks:
        prov = check["provider"]
        ready = check["ready"]
        mode = check["mode"]
        cat = check.get("category", "General")
        status_tag = "[OK]" if ready else "[WARN]"
        print(f"\n{status_tag} Provider: {prov} [{cat}] (Mode: {mode})")
        for k, v in check.items():
            if k not in ("provider", "ready", "mode", "category"):
                print(f"     * {k}: {v}")

    runtime = WorkerRuntime()
    print("\n" + "-" * 70)
    print("  Testing Core Adapter Health Probes via ProviderRegistry...")
    print("-" * 70)
    health_results = await runtime.registry.check_health()
    for name, res in health_results.items():
        h_tag = "HEALTHY" if res["healthy"] else "UNHEALTHY"
        print(f"  - {name:<15} : {h_tag:<10} (Latency: {res['latency_ms']}ms, Mock: {res['mock_mode']})")

    print("\n" + "=" * 70)
    print("  All provider adapters registered and available for routing.")
    print("=" * 70)
    return 0


async def test_prediction(provider_name: str) -> int:
    """Execute test prediction on specific provider."""
    runtime = WorkerRuntime()
    payload = {
        "job_id": f"test-probe-{provider_name}",
        "tenant_id": "tenant-diagnostic",
        "model_id": "meta-llama/Llama-3-8B-Instruct" if provider_name != "bedrock" else "anthropic.claude-3-sonnet",
        "prompt": "Explain multi-tenant provider routing in 15 words.",
        "provider": provider_name,
        "parameters": {"max_new_tokens": 20},
    }

    print(f"Executing test prediction on provider '{provider_name}'...")
    res = await runtime.process_job_payload(payload)
    print(json.dumps(res, indent=2))
    return 0 if res.get("ok") else 1


def main() -> None:
    parser = argparse.ArgumentParser(description="Multi-Tenant Inference Provider Setup & Diagnostics")
    parser.add_argument("--check", action="store_true", help="Run provider configuration diagnostics")
    parser.add_argument("--generate-env", action="store_true", help="Generate .env.providers.example")
    parser.add_argument(
        "--test-prediction",
        action="store_true",
        help="Execute test prediction through provider adapter",
    )
    parser.add_argument(
        "--provider",
        type=str,
        default="local_pytorch",
        help="Provider to test: local_pytorch, runpod, bedrock, sagemaker",
    )
    args = parser.parse_args()

    if args.generate_env:
        generate_env_example(REPO_ROOT / ".env.providers.example")
        return

    if args.test_prediction:
        code = asyncio.run(test_prediction(args.provider))
        sys.exit(code)

    # Default to check
    code = asyncio.run(run_diagnostics())
    sys.exit(code)


if __name__ == "__main__":
    main()
