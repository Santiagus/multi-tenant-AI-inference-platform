#!/usr/bin/env python3
"""Unit tests for M06 Kubernetes: Helm charts, KEDA, Kueue, Kyverno policies, and DCGM exporter."""

from __future__ import annotations

import copy
import unittest
from pathlib import Path

import yaml  # type: ignore[import-untyped]

from scripts.validate_kubernetes import (
    render_helm_chart,
    simulate_keda_and_kueue,
    validate_manifest_against_kyverno,
    validate_repository_kubernetes,
)


class TestKubernetesHelmAndPolicies(unittest.TestCase):
    def setUp(self) -> None:
        self.repo_root = Path(__file__).resolve().parent.parent.parent
        self.chart_dir = self.repo_root / "deploy" / "helm" / "inference-platform"

    def test_repository_kubernetes_validation_passes(self) -> None:
        report, errors = validate_repository_kubernetes(self.repo_root)
        self.assertEqual(errors, [], f"Expected zero Kubernetes validation errors, got: {errors}")
        self.assertEqual(report["local_manifest_count"], 22)
        self.assertEqual(report["gpu_manifest_count"], 24)

    def test_local_profile_renders_cpu_worker_and_omits_dcgm_exporter(self) -> None:
        docs = render_helm_chart(self.chart_dir, self.chart_dir / "values-local.yaml")
        by_kind_name = {(d["kind"], d["metadata"]["name"]): d for d in docs}

        self.assertNotIn(("DaemonSet", "dcgm-exporter"), by_kind_name)
        worker = by_kind_name[("Deployment", "inference-worker")]
        container = worker["spec"]["template"]["spec"]["containers"][0]
        limits = container["resources"]["limits"]
        self.assertNotIn("nvidia.com/gpu", limits)
        self.assertEqual(
            worker["metadata"]["labels"]["platform.ai/execution-mode"],
            "cpu-fallback",
        )

        api_svc = by_kind_name[("Service", "inference-api")]
        self.assertEqual(api_svc["spec"]["type"], "NodePort")
        self.assertEqual(api_svc["spec"]["ports"][0]["nodePort"], 30080)

    def test_gpu_profile_renders_nvidia_worker_dcgm_exporter_and_prometheus_scrape(self) -> None:
        docs = render_helm_chart(self.chart_dir, self.chart_dir / "values-gpu.yaml")
        by_kind_name = {(d["kind"], d["metadata"]["name"]): d for d in docs}

        worker = by_kind_name[("Deployment", "inference-worker")]
        pod_spec = worker["spec"]["template"]["spec"]
        self.assertEqual(pod_spec["runtimeClassName"], "nvidia")
        self.assertEqual(pod_spec["nodeSelector"]["nvidia.com/gpu.present"], "true")
        self.assertEqual(
            worker["metadata"]["labels"]["kueue.x-k8s.io/queue-name"],
            "tenant-default-gpu-queue",
        )
        container = pod_spec["containers"][0]
        self.assertEqual(container["resources"]["limits"]["nvidia.com/gpu"], "1")

        dcgm_ds = by_kind_name[("DaemonSet", "dcgm-exporter")]
        self.assertEqual(dcgm_ds["spec"]["template"]["spec"]["runtimeClassName"], "nvidia")
        self.assertEqual(
            dcgm_ds["spec"]["template"]["spec"]["nodeSelector"]["nvidia.com/gpu.present"],
            "true",
        )

        prom_cm = by_kind_name[("ConfigMap", "platform-prometheus-config")]
        self.assertIn("nvidia-dcgm-exporter", prom_cm["data"]["prometheus.yml"])

    def test_keda_scaledobject_and_kueue_cluster_queue_contracts(self) -> None:
        docs = render_helm_chart(self.chart_dir)
        by_kind_name = {(d["kind"], d["metadata"]["name"]): d for d in docs}

        scaled_obj = by_kind_name[("ScaledObject", "inference-worker-queue-scaler")]
        self.assertEqual(scaled_obj["spec"]["minReplicaCount"], 0)
        self.assertEqual(scaled_obj["spec"]["maxReplicaCount"], 8)
        self.assertEqual(scaled_obj["spec"]["scaleTargetRef"]["name"], "inference-worker")
        trigger_types = [t["type"] for t in scaled_obj["spec"]["triggers"]]
        self.assertEqual(trigger_types, ["aws-sqs-queue", "prometheus"])

        cq = by_kind_name[("ClusterQueue", "gpu-inference-cluster-queue")]
        self.assertEqual(cq["spec"]["cohort"], "tenant-shared-gpu-cohort")
        self.assertEqual(cq["spec"]["queueingStrategy"], "BestEffortFIFO")

        batch_job = by_kind_name[("Job", "batch-gpu-inference-template")]
        self.assertTrue(batch_job["spec"]["suspend"])
        self.assertEqual(
            batch_job["metadata"]["labels"]["kueue.x-k8s.io/queue-name"],
            "tenant-default-gpu-queue",
        )

    def test_kyverno_validator_rejects_non_compliant_manifests(self) -> None:
        docs = render_helm_chart(self.chart_dir)
        by_kind_name = {(d["kind"], d["metadata"]["name"]): d for d in docs}
        valid_job = by_kind_name[("Job", "batch-gpu-inference-template")]
        self.assertEqual(validate_manifest_against_kyverno(valid_job), [])

        bad_job = copy.deepcopy(valid_job)
        bad_job["spec"]["suspend"] = False
        bad_job["metadata"]["labels"].pop("platform.ai/tenant", None)
        bad_job["spec"]["template"]["spec"]["containers"][0]["securityContext"]["allowPrivilegeEscalation"] = True
        bad_job["spec"]["template"]["spec"]["containers"][0]["resources"]["limits"].pop("memory", None)

        violations = validate_manifest_against_kyverno(bad_job)
        self.assertGreaterEqual(len(violations), 4)

    def test_keda_and_kueue_simulation_wave_and_kind_cluster_topology(self) -> None:
        sim = simulate_keda_and_kueue()
        wave = sim["keda_wave"]
        self.assertEqual([step["desired_replicas"] for step in wave], [0, 1, 4, 8, 8, 0])
        self.assertEqual(wave[-2]["action"], "cooldown_hold")
        self.assertEqual(wave[-1]["action"], "scale_to_zero")

        kueue_sim = sim["kueue_simulation"]
        self.assertIn("batch-gpu-realtime-high-3", kueue_sim["admitted_after_first_release"])

        kind_cfg = yaml.safe_load(
            (self.repo_root / "deploy" / "kubernetes" / "kind-cluster.yaml").read_text(encoding="utf-8")
        )
        self.assertEqual(kind_cfg["kind"], "Cluster")
        self.assertEqual(len(kind_cfg["nodes"]), 3)

    def test_kubernetes_grafana_dashboard_panels_and_metrics(self) -> None:
        import json

        dash_path = (
            self.repo_root
            / "deploy"
            / "observability"
            / "grafana"
            / "provisioning"
            / "dashboards"
            / "json"
            / "kubernetes-scheduling.json"
        )
        self.assertTrue(dash_path.is_file(), "kubernetes-scheduling.json must exist")
        raw = dash_path.read_text(encoding="utf-8")
        dash = json.loads(raw)
        self.assertEqual(dash["uid"], "platform-kubernetes-scheduling")
        self.assertEqual(len(dash["panels"]), 4)

        for panel in dash["panels"]:
            defaults = panel.get("fieldConfig", {}).get("defaults", {})
            self.assertIn("unit", defaults)
            self.assertEqual(
                defaults.get("custom", {}).get("thresholdsStyle", {}).get("mode"),
                "dashed",
            )

        all_exprs = " ".join(t.get("expr", "") for p in dash["panels"] for t in p.get("targets", []))
        required_metrics = [
            'up{job="control-plane-api"}',
            "keda_scaler_desired_replicas",
            "keda_scaler_active_replicas",
            "kueue_cluster_queue_gpu_quota_used",
            "kueue_cluster_queue_gpu_quota_nominal",
            "kueue_pending_workloads",
            "kueue_admitted_workloads_total",
            "kyverno_policy_evaluations_total",
        ]
        for metric in required_metrics:
            self.assertIn(metric, all_exprs)


if __name__ == "__main__":
    unittest.main()
