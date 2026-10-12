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
from typing import Any, TypeVar

from apps.worker.models import ModelLoader, tokenize_prompt

F = TypeVar("F", bound=Callable[..., Any])


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
) -> dict[str, Any]:
    """Stage 1 (CPU Pod): Tokenize prompt / decode media metadata and write intermediate S3 tensor descriptor."""
    token_ids = tokenize_prompt(prompt)
    return {
        "tenant_id": tenant_id,
        "job_id": job_id,
        "model_id": model_id,
        "prompt": prompt,
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
    cost_microcents = (prompt_tokens + completion_tokens) * loaded_model.spec.cost_microcents_per_token

    return {
        "tenant_id": preprocessed["tenant_id"],
        "job_id": preprocessed["job_id"],
        "model_id": preprocessed["model_id"],
        "backend_name": loaded_model.backend.backend_name,
        "torchscript_enabled": True,
        "is_warm_model_cache": is_warm,
        "flyte_stage1_cache_hit": bool(preprocessed.get("flyte_cache_hit", False)),
        "output_text": output_text,
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
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
    """Stage 3 (CPU Pod): Package final S3 artifact, generate CloudFront CDN URL, and emit Kinesis metering record."""
    tenant_id = inference_result["tenant_id"]
    job_id = inference_result["job_id"]
    artifact_key = f"tenants/{tenant_id}/jobs/{job_id}/result.json"

    return {
        "workflow": "multi-stage-inference-workflow",
        "orchestration_path": "Path B (Flyte + Kueue + Kyverno)",
        "tenant_id": tenant_id,
        "job_id": job_id,
        "model_id": inference_result["model_id"],
        "backend_name": inference_result["backend_name"],
        "torchscript_enabled": inference_result["torchscript_enabled"],
        "flyte_stage1_cache_hit": inference_result["flyte_stage1_cache_hit"],
        "s3_artifact_uri": f"s3://inference-artifacts/{artifact_key}",
        "cloudfront_artifact_url": f"https://{cloudfront_domain}/{artifact_key}",
        "usage": {
            "prompt_tokens": inference_result["prompt_tokens"],
            "completion_tokens": inference_result["completion_tokens"],
            "total_tokens": inference_result["prompt_tokens"] + inference_result["completion_tokens"],
            "cost_microcents": inference_result["cost_microcents"],
            "ttft_ms": inference_result["ttft_ms"],
            "total_compute_ms": inference_result["total_compute_ms"],
        },
        "kinesis_metering_event": {
            "stream_name": kinesis_stream_name,
            "partition_key": tenant_id,
            "event_type": "WORKFLOW_STAGE_COMPLETED",
            "job_id": job_id,
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
    loader: ModelLoader | None = None,
) -> dict[str, Any]:
    """Execute the 3-stage Flyte media/inference pipeline (`CPU preprocess -> GPU TorchScript -> CPU S3/CloudFront/Kinesis`)."""
    prep = preprocess_media_asset(
        tenant_id=tenant_id,
        job_id=job_id,
        model_id=model_id,
        prompt=prompt,
        max_new_tokens=max_new_tokens,
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
