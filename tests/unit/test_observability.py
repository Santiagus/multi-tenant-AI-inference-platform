#!/usr/bin/env python3
"""Unit tests for M05 Observability: trace correlation in Python worker and Grafana/Prometheus configs."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
import tempfile
import unittest

from apps.worker.artifacts import ArtifactHandler
from apps.worker.consumer import WorkerRuntime


class TestObservabilityWorkerAndDashboards(unittest.TestCase):
    def setUp(self) -> None:
        self.repo_root = Path(__file__).resolve().parent.parent.parent

    def test_worker_propagates_correlation_id_and_traceparent_to_response_and_artifact(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            artifact_handler = ArtifactHandler(
                bucket="platform-artifacts",
                local_root=Path(tmp_dir),
            )
            runtime = WorkerRuntime(artifact_handler=artifact_handler)

            payload = {
                "job_id": "job-m05-trace-001",
                "tenant_id": "tenant-obs",
                "model_id": "TinyLlama/TinyLlama-1.1B-Chat-v1.0",
                "correlation_id": "corr-py-worker-999",
                "traceparent": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
                "input": {
                    "prompt": "Propagate trace context through Python worker.",
                    "parameters": {"max_new_tokens": 8},
                },
            }

            response = asyncio.run(runtime.process_job_payload(payload))
            self.assertTrue(response["ok"])
            self.assertEqual(response["job_id"], "job-m05-trace-001")
            self.assertEqual(response["correlation_id"], "corr-py-worker-999")
            self.assertEqual(
                response["traceparent"],
                "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
            )
            self.assertEqual(response["metadata"]["correlation_id"], "corr-py-worker-999")
            self.assertEqual(
                response["metadata"]["traceparent"],
                "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
            )

            artifact_path = (
                Path(tmp_dir)
                / "tenants"
                / "tenant-obs"
                / "outputs"
                / "job-m05-trace-001"
                / "result.json"
            )
            self.assertTrue(artifact_path.is_file())
            artifact_json = json.loads(artifact_path.read_text(encoding="utf-8"))
            self.assertEqual(artifact_json["correlation_id"], "corr-py-worker-999")
            self.assertEqual(
                artifact_json["traceparent"],
                "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
            )

    def test_observability_configs_and_grafana_dashboard_exist_and_cover_required_metrics(self) -> None:
        obs_dir = self.repo_root / "deploy" / "observability"
        otel_cfg = obs_dir / "otel-collector-config.yml"
        prom_cfg = obs_dir / "prometheus.yml"
        ds_cfg = obs_dir / "grafana" / "provisioning" / "datasources" / "datasource.yml"
        dash_provider = obs_dir / "grafana" / "provisioning" / "dashboards" / "dashboard.yml"
        dash_json_path = (
            obs_dir
            / "grafana"
            / "provisioning"
            / "dashboards"
            / "json"
            / "inference-operations.json"
        )

        self.assertTrue(otel_cfg.is_file(), "otel-collector-config.yml must exist")
        self.assertTrue(prom_cfg.is_file(), "prometheus.yml must exist")
        self.assertTrue(ds_cfg.is_file(), "Grafana datasource.yml must exist")
        self.assertTrue(dash_provider.is_file(), "Grafana dashboard.yml must exist")
        self.assertTrue(dash_json_path.is_file(), "Grafana inference-operations.json must exist")

        prom_text = prom_cfg.read_text(encoding="utf-8")
        self.assertIn("control-plane-api", prom_text)
        self.assertIn("/metrics", prom_text)

        dash_raw = dash_json_path.read_text(encoding="utf-8")
        dash = json.loads(dash_raw)
        self.assertEqual(dash["uid"], "platform-inference-operations")
        self.assertEqual(len(dash["panels"]), 8)

        for panel in dash["panels"]:
            defaults = panel.get("fieldConfig", {}).get("defaults", {})
            self.assertIn("unit", defaults, f"Panel '{panel['title']}' must specify a display unit")
            self.assertEqual(
                defaults.get("custom", {}).get("thresholdsStyle", {}).get("mode"),
                "dashed",
                f"Panel '{panel['title']}' must render dashed threshold reference lines",
            )

        required_metrics = [
            "http_server_requests_total",
            "queue_messages_visible",
            "queue_wait_duration_seconds_bucket",
            "inference_job_duration_seconds_bucket",
            "inference_tokens_total",
            "inference_job_errors_total",
            "inference_job_retries_total",
            "inference_job_dlq_total",
            "worker_utilization_ratio",
            "worker_cpu_utilization_pct",
            "worker_process_rss_mb",
            "DCGM_FI_DEV_GPU_UTIL",
            "DCGM_FI_DEV_FB_USED",
        ]
        for metric_name in required_metrics:
            self.assertIn(
                metric_name,
                dash_raw,
                f"Grafana dashboard must query metric '{metric_name}'",
            )


if __name__ == "__main__":
    unittest.main()

