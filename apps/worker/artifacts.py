"""Artifact serialization and storage handling for inference worker outputs."""

from __future__ import annotations

from datetime import datetime, timezone
import json
from pathlib import Path
from typing import Any

from apps.worker.contracts import InferenceRequest, InferenceResult


class ArtifactHandler:
    """Formats and optionally persists tenant-partitioned inference output artifacts."""

    def __init__(self, bucket: str = "platform-artifacts", local_root: Path | None = None) -> None:
        self._bucket = bucket
        self._local_root = local_root

    def build_artifact_key(self, tenant_id: str, job_id: str) -> str:
        return f"tenants/{tenant_id}/outputs/{job_id}/result.json"

    def build_s3_uri(self, tenant_id: str, job_id: str) -> str:
        key = self.build_artifact_key(tenant_id, job_id)
        return f"s3://{self._bucket}/{key}"

    def serialize_result_artifact(
        self,
        request: InferenceRequest,
        result: InferenceResult,
    ) -> dict[str, Any]:
        """Build the canonical result artifact dictionary stored in object storage."""
        return {
            "job_id": request.job_id,
            "tenant_id": request.tenant_id,
            "correlation_id": request.correlation_id,
            "traceparent": request.traceparent,
            "model_id": request.model_id,
            "provider": result.provider_name,
            "output_text": result.output_text,
            "finish_reason": result.finish_reason,
            "usage": result.usage.to_dict(),
            "telemetry": result.telemetry.to_dict(),
            "metadata": result.metadata,
            "completed_at": datetime.now(timezone.utc).isoformat(),
        }

    def write_local_artifact(
        self,
        request: InferenceRequest,
        result: InferenceResult,
    ) -> str:
        """Persist serialized artifact to local filesystem when local_root is configured."""
        payload = self.serialize_result_artifact(request, result)
        key = self.build_artifact_key(request.tenant_id, request.job_id)
        if self._local_root is not None:
            target = self._local_root / key
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        return self.build_s3_uri(request.tenant_id, request.job_id)

