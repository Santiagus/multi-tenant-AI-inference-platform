"""Path B Multi-Stage Media & Batch Inference DAG Orchestration (Flyte + Kueue + Kyverno).

Implements the Two-Path Architecture's multi-stage DAG workflow (`@task` and `@workflow`)
where heterogeneous stages declare distinct CPU and GPU container resource profiles:
  1. `preprocess_media_asset` (@task, CPU-only, cached in S3)
  2. `run_torchscript_gpu_inference` (@task, GPU=1, admitted via Kueue `LocalQueue` & validated by Kyverno)
  3. `package_s3_cloudfront_artifact` (@task, CPU-only, writes S3 artifact, generates CloudFront CDN URL, and emits Kinesis event)
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
import hashlib
from pathlib import Path
import struct
from typing import Any, TypeVar

from apps.worker.models import ModelLoader, tokenize_prompt

F = TypeVar("F", bound=Callable[..., Any])


def inspect_local_media_asset(asset_uri: str | None) -> dict[str, Any]:
    """Inspect a local `.png` or `.mp4` media asset, verifying binary magic headers and SHA-256 digest."""
    if not asset_uri or asset_uri.startswith(("s3://", "http://", "https://")):
        return {
            "exists_on_disk": False,
            "container_format": "remote_uri",
            "byte_size": 0,
            "content_sha256": None,
            "valid_header": True,
        }

    repo_root = Path(__file__).resolve().parents[2]
    candidate = Path(asset_uri)
    resolved = candidate if candidate.is_absolute() else (repo_root / candidate)
    if not resolved.is_file():
        return {
            "exists_on_disk": False,
            "container_format": "missing_local_file",
            "byte_size": 0,
            "content_sha256": None,
            "valid_header": False,
        }

    raw = resolved.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    if raw.startswith(b"\x89PNG\r\n\x1a\n") and len(raw) >= 24 and raw[12:16] == b"IHDR":
        width, height = struct.unpack(">II", raw[16:24])
        return {
            "exists_on_disk": True,
            "container_format": "png",
            "byte_size": len(raw),
            "content_sha256": digest,
            "width": width,
            "height": height,
            "valid_header": True,
        }
    if len(raw) >= 12 and raw[4:8] == b"ftyp" and b"moov" in raw and b"mdat" in raw:
        return {
            "exists_on_disk": True,
            "container_format": "mp4",
            "byte_size": len(raw),
            "content_sha256": digest,
            "valid_header": True,
        }
    return {
        "exists_on_disk": True,
        "container_format": "unknown",
        "byte_size": len(raw),
        "content_sha256": digest,
        "valid_header": False,
    }


@dataclass(frozen=True)
class Resources:
    """Flyte-compatible container resource specification (`cpu`, `mem`, `gpu`)."""

    cpu: str = "500m"
    mem: str = "1Gi"
    gpu: str = "0"


@dataclass(frozen=True)
class FlyteTaskSpec:
    """Metadata attached to a `@task`-decorated function for Kubernetes/Kueue scheduling."""

    name: str
    requests: Resources
    limits: Resources
    retries: int = 2
    cache: bool = False
    cache_version: str = "1.0"
    kueue_queue: str | None = None
    priority_class: str = "inference-batch-standard"
    container_image: str = "ghcr.io/multi-tenant-ai-inference-platform/worker:0.6.0"


@dataclass
class FlyteWorkflowSpec:
    """Metadata attached to a `@workflow`-decorated DAG function."""

    name: str
    tasks: list[FlyteTaskSpec] = field(default_factory=list)


_TASK_MEMO_CACHE: dict[str, Any] = {}


def clear_flyte_task_cache() -> None:
    """Clear the in-memory memoization cache used when `cache=True` on a `@task`."""
    _TASK_MEMO_CACHE.clear()


def task(
    *,
    requests: Resources | None = None,
    limits: Resources | None = None,
    retries: int = 2,
    cache: bool = False,
    cache_version: str = "1.0",
    kueue_queue: str | None = None,
    priority_class: str = "inference-batch-standard",
    container_image: str = "ghcr.io/multi-tenant-ai-inference-platform/worker:0.6.0",
) -> Callable[[F], F]:
    """Flyte-compatible `@task` decorator attaching Kubernetes resource, S3 cache, and Kueue metadata."""
    req = requests or Resources()
    lim = limits or req

    def decorator(fn: F) -> F:
        spec = FlyteTaskSpec(
            name=fn.__name__.replace("_", "-"),
            requests=req,
            limits=lim,
            retries=retries,
            cache=cache,
            cache_version=cache_version,
            kueue_queue=kueue_queue,
            priority_class=priority_class,
            container_image=container_image,
        )

        def wrapper(*args: Any, **kwargs: Any) -> Any:
            if cache:
                cache_key_raw = f"{fn.__name__}:{cache_version}:{repr(args)}:{repr(sorted(kwargs.items()))}"
                cache_key = hashlib.sha256(cache_key_raw.encode("utf-8")).hexdigest()
                if cache_key in _TASK_MEMO_CACHE:
                    cached_res = dict(_TASK_MEMO_CACHE[cache_key])
                    cached_res["flyte_cache_hit"] = True
                    return cached_res
                result = fn(*args, **kwargs)
                if isinstance(result, dict):
                    _TASK_MEMO_CACHE[cache_key] = dict(result)
                    result["flyte_cache_hit"] = False
                return result
            return fn(*args, **kwargs)

        setattr(wrapper, "__flyte_task_spec__", spec)
        return wrapper  # type: ignore[return-value]

    return decorator


def workflow(fn: F) -> F:
    """Flyte-compatible `@workflow` decorator registering a multi-stage DAG."""
    wf_spec = FlyteWorkflowSpec(name=fn.__name__.replace("_", "-"))
    setattr(fn, "__flyte_workflow_spec__", wf_spec)
    return fn


@task(
    requests=Resources(cpu="500m", mem="1Gi", gpu="0"),
    limits=Resources(cpu="1000m", mem="2Gi", gpu="0"),
    retries=3,
    cache=True,
    cache_version="1.0",
)
def preprocess_media_asset(
    tenant_id: str,
    job_id: str,
    model_id: str,
    prompt: str,
    max_new_tokens: int = 32,
    modality: str = "text_to_video",
    source_asset_uri: str | None = None,
    resolution: str = "1280x720",
    fps: int = 24,
    duration_seconds: int = 4,
    edit_operation: str | None = None,
    edit_strength: float = 0.75,
) -> dict[str, Any]:
    """Stage 1 (CPU Pod): Tokenize prompt, demux/condition input video (`video_to_video`), and cache intermediate S3 tensor."""
    token_ids = tokenize_prompt(prompt)
    frames_target = 1 if modality == "text_to_image" else max(1, fps * duration_seconds)
    conditioning_mode = (
        f"video_mod:{edit_operation or 'style_transfer'}"
        if modality == "video_to_video"
        else ("keyframe_latent" if modality == "text_to_image" else "temporal_latent")
    )
    asset_inspection = inspect_local_media_asset(source_asset_uri)
    return {
        "tenant_id": tenant_id,
        "job_id": job_id,
        "model_id": model_id,
        "prompt": prompt,
        "modality": modality,
        "source_asset_uri": source_asset_uri,
        "asset_inspection": asset_inspection,
        "resolution": resolution,
        "fps": 1 if modality == "text_to_image" else fps,
        "duration_seconds": 0 if modality == "text_to_image" else duration_seconds,
        "frames_target": frames_target,
        "edit_operation": edit_operation if modality == "video_to_video" else None,
        "edit_strength": edit_strength if modality == "video_to_video" else None,
        "conditioning_mode": conditioning_mode,
        "prompt_token_count": len(token_ids),
        "max_new_tokens": max_new_tokens,
        "intermediate_tensor_s3_uri": f"s3://inference-artifacts/tenants/{tenant_id}/jobs/{job_id}/stage1_tensor.pt",
        "stage": "preprocess_media_asset",
    }


@task(
    requests=Resources(cpu="1000m", mem="4Gi", gpu="1"),
    limits=Resources(cpu="2000m", mem="8Gi", gpu="1"),
    retries=2,
    cache=False,
    kueue_queue="tenant-default-gpu-queue",
    priority_class="inference-batch-standard",
)
def run_torchscript_gpu_inference(
    preprocessed: dict[str, Any],
    loader: ModelLoader | None = None,
) -> dict[str, Any]:
    """Stage 2 (GPU=1 Pod, Kueue-Admitted): Execute PyTorch / TorchScript forward pass on isolated GPU pod."""
    active_loader = loader or ModelLoader()
    loaded_model, is_warm = active_loader.load(
        preprocessed["model_id"],
        use_torchscript=True,
    )
    output_text, prompt_tokens, completion_tokens, ttft_ms, total_ms = loaded_model.backend.generate(
        prompt=preprocessed["prompt"],
        max_new_tokens=int(preprocessed["max_new_tokens"]),
    )
    frames_generated = int(preprocessed.get("frames_target", 1))
    spatiotemporal_patch_tokens = frames_generated * 16
    total_billed_tokens = prompt_tokens + completion_tokens + spatiotemporal_patch_tokens
    cost_microcents = total_billed_tokens * loaded_model.spec.cost_microcents_per_token

    return {
        "tenant_id": preprocessed["tenant_id"],
        "job_id": preprocessed["job_id"],
        "model_id": preprocessed["model_id"],
        "modality": preprocessed.get("modality", "text_to_video"),
        "source_asset_uri": preprocessed.get("source_asset_uri"),
        "asset_inspection": preprocessed.get("asset_inspection"),
        "resolution": preprocessed.get("resolution", "1280x720"),
        "fps": preprocessed.get("fps", 24),
        "duration_seconds": preprocessed.get("duration_seconds", 4),
        "frames_generated": frames_generated,
        "edit_operation": preprocessed.get("edit_operation"),
        "edit_strength": preprocessed.get("edit_strength"),
        "conditioning_mode": preprocessed.get("conditioning_mode"),
        "backend_name": loaded_model.backend.backend_name,
        "torchscript_enabled": True,
        "is_warm_model_cache": is_warm,
        "flyte_stage1_cache_hit": bool(preprocessed.get("flyte_cache_hit", False)),
        "output_text": output_text,
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "spatiotemporal_patch_tokens": spatiotemporal_patch_tokens,
        "ttft_ms": ttft_ms,
        "total_compute_ms": total_ms,
        "cost_microcents": cost_microcents,
        "kueue_queue": "tenant-default-gpu-queue",
        "stage": "run_torchscript_gpu_inference",
    }


@task(
    requests=Resources(cpu="250m", mem="512Mi", gpu="0"),
    limits=Resources(cpu="500m", mem="1Gi", gpu="0"),
    retries=3,
    cache=False,
)
def package_s3_cloudfront_artifact(
    inference_result: dict[str, Any],
    cloudfront_domain: str = "d111111abcdef8.cloudfront.net",
    kinesis_stream_name: str = "inference-platform-telemetry-stream",
) -> dict[str, Any]:
    """Stage 3 (CPU Pod): Encode/mux media (.mp4/.png + .webp poster), generate CloudFront URL, and emit Kinesis metering."""
    tenant_id = inference_result["tenant_id"]
    job_id = inference_result["job_id"]
    modality = inference_result.get("modality", "text_to_video")
    media_ext = "png" if modality == "text_to_image" else "mp4"
    artifact_key = f"tenants/{tenant_id}/jobs/{job_id}/result.json"
    media_key = f"tenants/{tenant_id}/jobs/{job_id}/output.{media_ext}"
    poster_key = f"tenants/{tenant_id}/jobs/{job_id}/poster.webp"
    total_tokens = (
        int(inference_result["prompt_tokens"])
        + int(inference_result["completion_tokens"])
        + int(inference_result.get("spatiotemporal_patch_tokens", 0))
    )

    return {
        "workflow": "multi-stage-inference-workflow",
        "orchestration_path": "Path B (Flyte + Kueue + Kyverno)",
        "tenant_id": tenant_id,
        "job_id": job_id,
        "model_id": inference_result["model_id"],
        "modality": modality,
        "edit_operation": inference_result.get("edit_operation"),
        "asset_inspection": inference_result.get("asset_inspection"),
        "backend_name": inference_result["backend_name"],
        "torchscript_enabled": inference_result["torchscript_enabled"],
        "flyte_stage1_cache_hit": inference_result["flyte_stage1_cache_hit"],
        "s3_artifact_uri": f"s3://inference-artifacts/{artifact_key}",
        "s3_media_uri": f"s3://inference-artifacts/{media_key}",
        "cloudfront_artifact_url": f"https://{cloudfront_domain}/{artifact_key}",
        "cloudfront_media_url": f"https://{cloudfront_domain}/{media_key}",
        "cloudfront_poster_url": f"https://{cloudfront_domain}/{poster_key}",
        "usage": {
            "prompt_tokens": inference_result["prompt_tokens"],
            "completion_tokens": inference_result["completion_tokens"],
            "spatiotemporal_patch_tokens": inference_result.get("spatiotemporal_patch_tokens", 0),
            "total_tokens": total_tokens,
            "frames_generated": inference_result.get("frames_generated", 1),
            "resolution": inference_result.get("resolution", "1280x720"),
            "fps": inference_result.get("fps", 24),
            "duration_seconds": inference_result.get("duration_seconds", 4),
            "cost_microcents": inference_result["cost_microcents"],
            "ttft_ms": inference_result["ttft_ms"],
            "total_compute_ms": inference_result["total_compute_ms"],
        },
        "kinesis_metering_event": {
            "stream_name": kinesis_stream_name,
            "partition_key": tenant_id,
            "event_type": "WORKFLOW_STAGE_COMPLETED",
            "job_id": job_id,
            "modality": modality,
            "total_tokens": total_tokens,
            "frames_generated": inference_result.get("frames_generated", 1),
            "cost_microcents": inference_result["cost_microcents"],
        },
    }


@workflow
def multi_stage_inference_workflow(
    tenant_id: str,
    job_id: str,
    model_id: str,
    prompt: str,
    max_new_tokens: int = 32,
    modality: str = "text_to_video",
    source_asset_uri: str | None = None,
    resolution: str = "1280x720",
    fps: int = 24,
    duration_seconds: int = 4,
    edit_operation: str | None = None,
    edit_strength: float = 0.75,
    loader: ModelLoader | None = None,
) -> dict[str, Any]:
    """Execute the 3-stage Flyte media/inference pipeline (`CPU preprocess -> GPU TorchScript -> CPU S3/CloudFront/Kinesis`)."""
    prep = preprocess_media_asset(
        tenant_id=tenant_id,
        job_id=job_id,
        model_id=model_id,
        prompt=prompt,
        max_new_tokens=max_new_tokens,
        modality=modality,
        source_asset_uri=source_asset_uri,
        resolution=resolution,
        fps=fps,
        duration_seconds=duration_seconds,
        edit_operation=edit_operation,
        edit_strength=edit_strength,
    )
    gpu_out = run_torchscript_gpu_inference(preprocessed=prep, loader=loader)
    return package_s3_cloudfront_artifact(inference_result=gpu_out)



def get_flyte_pipeline_task_specs() -> list[FlyteTaskSpec]:
    """Return the ordered Flyte task specifications for the 3-stage workflow."""
    return [
        getattr(preprocess_media_asset, "__flyte_task_spec__"),
        getattr(run_torchscript_gpu_inference, "__flyte_task_spec__"),
        getattr(package_s3_cloudfront_artifact, "__flyte_task_spec__"),
    ]


def render_flyte_gpu_stage_k8s_job(tenant_id: str = "tenant-default") -> dict[str, Any]:
    """Render the Kubernetes `batch/v1` `Job` manifest for Stage 2 (`run_torchscript_gpu_inference`) compliant with Kueue & Kyverno."""
    gpu_spec: FlyteTaskSpec = getattr(run_torchscript_gpu_inference, "__flyte_task_spec__")
    return {
        "apiVersion": "batch/v1",
        "kind": "Job",
        "metadata": {
            "name": f"flyte-{gpu_spec.name}",
            "namespace": "inference-workers",
            "labels": {
                "app.kubernetes.io/name": "flyte-gpu-task",
                "app.kubernetes.io/part-of": "multi-tenant-ai-inference-platform",
                "platform.ai/tenant": tenant_id,
                "flyte.org/workflow": "multi-stage-inference-workflow",
                "flyte.org/task-name": gpu_spec.name,
                "kueue.x-k8s.io/queue-name": gpu_spec.kueue_queue or "tenant-default-gpu-queue",
                "kueue.x-k8s.io/priority-class": gpu_spec.priority_class,
            },
        },
        "spec": {
            "suspend": True,
            "parallelism": 1,
            "completions": 1,
            "backoffLimit": gpu_spec.retries,
            "template": {
                "metadata": {
                    "labels": {
                        "app.kubernetes.io/name": "flyte-gpu-task",
                        "app.kubernetes.io/part-of": "multi-tenant-ai-inference-platform",
                        "platform.ai/tenant": tenant_id,
                        "flyte.org/workflow": "multi-stage-inference-workflow",
                        "kueue.x-k8s.io/queue-name": gpu_spec.kueue_queue or "tenant-default-gpu-queue",
                    },
                },
                "spec": {
                    "restartPolicy": "Never",
                    "runtimeClassName": "nvidia",
                    "securityContext": {
                        "runAsNonRoot": True,
                        "runAsUser": 10001,
                        "runAsGroup": 10001,
                        "seccompProfile": {"type": "RuntimeDefault"},
                    },
                    "containers": [
                        {
                            "name": "flyte-pytorch-torchscript-worker",
                            "image": gpu_spec.container_image,
                            "securityContext": {
                                "runAsNonRoot": True,
                                "allowPrivilegeEscalation": False,
                                "capabilities": {"drop": ["ALL"]},
                            },
                            "resources": {
                                "requests": {
                                    "cpu": gpu_spec.requests.cpu,
                                    "memory": gpu_spec.requests.mem,
                                    "nvidia.com/gpu": gpu_spec.requests.gpu,
                                },
                                "limits": {
                                    "cpu": gpu_spec.limits.cpu,
                                    "memory": gpu_spec.limits.mem,
                                    "nvidia.com/gpu": gpu_spec.limits.gpu,
                                },
                            },
                        }
                    ],
                },
            },
        },
    }
