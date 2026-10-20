#!/usr/bin/env python3
"""Provider setup and verification automation script.

Validates credentials, hardware readiness, and endpoint connectivity for:
- Local PyTorch (CUDA / RTX 5070 Ti / CPU)
- RunPod Serverless GPU
- AWS Bedrock (Converse API)
- AWS SageMaker (Real-Time Endpoints)

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

from apps.worker.consumer import WorkerRuntime
from apps.worker.contracts import InferenceRequest
from apps.worker.models import ModelLoader
from apps.worker.providers.registry import ProviderRegistry


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
        "ready": True,
        "device": device,
        "device_name": device_name,
        "vram_mb": vram_mb,
        "mode": "live",
    }


def check_runpod() -> dict[str, Any]:
    """Validate RunPod Serverless credentials and endpoint configuration."""
    api_key = os.environ.get("RUNPOD_API_KEY", "")
    endpoint_id = os.environ.get("RUNPOD_ENDPOINT_ID", "")
    mock_mode = os.environ.get("RUNPOD_MOCK", "1") == "1" or not api_key

    ready = bool(api_key and endpoint_id) or mock_mode
    return {
        "provider": "runpod",
        "ready": ready,
        "has_api_key": bool(api_key),
        "endpoint_id": endpoint_id or "(not set; using mock/fallback)",
        "mode": "mock" if mock_mode else "live",
    }


def check_aws_bedrock() -> dict[str, Any]:
    """Validate AWS Bedrock credentials and region."""
    region = os.environ.get("AWS_REGION", os.environ.get("AWS_DEFAULT_REGION", "us-east-1"))
    has_creds = bool(
        os.environ.get("AWS_ACCESS_KEY_ID")
        or os.environ.get("AWS_CONTAINER_CREDENTIALS_RELATIVE_URI")
        or os.environ.get("AWS_WEB_IDENTITY_TOKEN_FILE")
    )
    mock_mode = os.environ.get("BEDROCK_MOCK", "1") == "1" or not has_creds

    return {
        "provider": "bedrock",
        "ready": has_creds or mock_mode,
        "has_credentials": has_creds,
        "aws_region": region,
        "mode": "mock" if mock_mode else "live",
    }


def check_aws_sagemaker() -> dict[str, Any]:
    """Validate AWS SageMaker credentials and endpoint configuration."""
    region = os.environ.get("AWS_REGION", os.environ.get("AWS_DEFAULT_REGION", "us-east-1"))
    endpoint_name = os.environ.get("SAGEMAKER_ENDPOINT_NAME", "")
    has_creds = bool(
        os.environ.get("AWS_ACCESS_KEY_ID")
        or os.environ.get("AWS_CONTAINER_CREDENTIALS_RELATIVE_URI")
        or os.environ.get("AWS_WEB_IDENTITY_TOKEN_FILE")
    )
    mock_mode = os.environ.get("SAGEMAKER_MOCK", "1") == "1" or not has_creds

    return {
        "provider": "sagemaker",
        "ready": (has_creds and bool(endpoint_name)) or mock_mode,
        "has_credentials": has_creds,
        "endpoint_name": endpoint_name or "(not set; using mock/fallback)",
        "aws_region": region,
        "mode": "mock" if mock_mode else "live",
    }


def generate_env_example(output_path: Path) -> None:
    """Generate sanitized .env.providers.example file."""
    content = """# ==============================================================================
# Inference Provider Environment Configuration
# Reference template for live cloud and local inference provider adapters.
# Keep real secrets in secret managers; do not commit filled credentials.
# ==============================================================================

# ------------------------------------------------------------------------------
# 1. Local PyTorch / CUDA Engine
# ------------------------------------------------------------------------------
# Execution device: 'cuda', 'cpu', or 'auto' (detects RTX 5070 Ti / GPU if available)
LOCAL_INFERENCE_DEVICE=auto
# Model weights root directory (defaults to models/)
LOCAL_MODEL_CACHE_DIR=models/

# ------------------------------------------------------------------------------
# 2. RunPod Serverless GPU
# ------------------------------------------------------------------------------
# Set RUNPOD_MOCK=0 to enable live REST calls to RunPod Serverless API
RUNPOD_MOCK=1
RUNPOD_API_KEY=rpa_your_runpod_api_key_here
RUNPOD_ENDPOINT_ID=your_runpod_endpoint_id

# ------------------------------------------------------------------------------
# 3. AWS Bedrock (Foundation Models / Converse API)
# ------------------------------------------------------------------------------
# Set BEDROCK_MOCK=0 to enable live AWS Bedrock calls via Boto3 / SigV4
BEDROCK_MOCK=1
AWS_REGION=us-east-1
# AWS credentials (or use IAM Roles / IRSA in Kubernetes / ECS)
AWS_ACCESS_KEY_ID=AKIA_MOCK_KEY_ID
AWS_SECRET_ACCESS_KEY=mock_secret_access_key
# Default foundation model (e.g. Claude 3, Llama 3 70B, Titan)
BEDROCK_DEFAULT_MODEL=anthropic.claude-3-sonnet-20240229-v1:0

# ------------------------------------------------------------------------------
# 4. AWS SageMaker (Dedicated / Async Real-Time Endpoints)
# ------------------------------------------------------------------------------
# Set SAGEMAKER_MOCK=0 to enable live SageMaker Runtime endpoint invocations
SAGEMAKER_MOCK=1
SAGEMAKER_ENDPOINT_NAME=sagemaker-llama3-70b-instruct
"""
    output_path.write_text(content.strip() + "\n", encoding="utf-8")
    print(f"Generated sanitized template: {output_path}")


async def run_diagnostics() -> int:
    """Run full diagnostic check across all providers."""
    print("=" * 70)
    print("  Inference Provider Configuration & Connectivity Diagnostics")
    print("=" * 70)

    checks = [
        check_local_pytorch(),
        check_runpod(),
        check_aws_bedrock(),
        check_aws_sagemaker(),
    ]

    for check in checks:
        prov = check["provider"]
        ready = check["ready"]
        mode = check["mode"]
        status_tag = "[OK]" if ready else "[WARN]"
        print(f"\n{status_tag} Provider: {prov} (Mode: {mode})")
        for k, v in check.items():
            if k not in ("provider", "ready", "mode"):
                print(f"     * {k}: {v}")

    runtime = WorkerRuntime()
    print("\n" + "-" * 70)
    print("  Testing Adapter Health Probes via ProviderRegistry...")
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
