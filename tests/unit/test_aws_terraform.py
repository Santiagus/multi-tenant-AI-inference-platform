#!/usr/bin/env python3
"""Unit tests for M07 AWS Platform, Two-Path Flyte/Kueue/Kyverno DAGs, TorchScript, and Terraform modules."""

from __future__ import annotations

import copy
from pathlib import Path
import subprocess
from typing import Any
import unittest

import numpy as np  # type: ignore[import-not-found]

from apps.worker.flyte_workflow import (
    clear_flyte_task_cache,
    get_flyte_pipeline_task_specs,
    multi_stage_inference_workflow,
    render_flyte_gpu_stage_k8s_job,
)
from apps.worker.models import ModelLoader
from scripts.validate_kubernetes import (
    render_helm_chart,
    validate_manifest_against_kyverno,
)
from scripts.validate_terraform import (
    check_hcl_formatting_and_balance,
    generate_plan_summary,
    parse_terraform_directory,
    simulate_ephemeral_deploy_destroy,
    validate_cost_guardrails_and_environments,
    validate_module_structure,
    validate_security_and_iam_policies,
    validate_terraform_repository,
)


class _MockJitModule:
    def trace(self, fn: Any, example_inputs: tuple[Any, ...]) -> Any:
        # Execute once with example inputs to verify trace compatibility
        _ = fn(*example_inputs)
        return fn


class _MockTensor:
    def __init__(self, shape_or_data: Any) -> None:
        if isinstance(shape_or_data, np.ndarray):
            self.arr = shape_or_data.astype(np.float32)
        elif isinstance(shape_or_data, tuple):
            self.arr = np.zeros(shape_or_data, dtype=np.float32)
        elif isinstance(shape_or_data, list):
            self.arr = np.array(shape_or_data, dtype=np.float32)
        else:
            self.arr = np.array([shape_or_data], dtype=np.float32)
        self.shape = self.arr.shape

    def __mul__(self, other: Any) -> _MockTensor:
        factor = other.arr if isinstance(other, _MockTensor) else float(other)
        return _MockTensor(self.arr * factor)

    def __truediv__(self, other: Any) -> _MockTensor:
        denom = other.arr if isinstance(other, _MockTensor) else float(other)
        return _MockTensor(self.arr / denom)

    def __add__(self, other: Any) -> _MockTensor:
        addend = other.arr if isinstance(other, _MockTensor) else float(other)
        return _MockTensor(self.arr + addend)

    def __getitem__(self, idx: Any) -> _MockTensor:
        if isinstance(idx, _MockTensor):
            indices = idx.arr.astype(np.int64)
            return _MockTensor(self.arr[indices])
        return _MockTensor(self.arr[idx])

    def mean(self, dim: int = 0, keepdim: bool = True) -> _MockTensor:
        return _MockTensor(np.mean(self.arr, axis=dim, keepdims=keepdim))

    def item(self) -> float:
        return float(self.arr.item())


class _MockNoGrad:
    def __enter__(self) -> None:
        return None

    def __exit__(self, *args: Any) -> None:
        return None


class _MockCuda:
    def is_available(self) -> bool:
        return False

    def synchronize(self) -> None:
        return None


class _MockTorchWithJit:
    long = "int64"

    def __init__(self) -> None:
        self.jit = _MockJitModule()
        self.cuda = _MockCuda()
        self._rng = np.random.default_rng(42)

    def manual_seed(self, seed: int) -> None:
        self._rng = np.random.default_rng(seed)

    def randn(self, shape: tuple[int, ...], device: str = "cpu") -> _MockTensor:
        _ = device
        return _MockTensor(self._rng.standard_normal(shape, dtype=np.float32))

    def tensor(self, data: Any, dtype: Any = None, device: str = "cpu") -> _MockTensor:
        _ = (dtype, device)
        return _MockTensor(data)

    def matmul(self, a: _MockTensor, b: _MockTensor) -> _MockTensor:
        return _MockTensor(a.arr @ b.arr)

    def tanh(self, a: _MockTensor) -> _MockTensor:
        return _MockTensor(np.tanh(a.arr))

    def argmax(self, a: _MockTensor) -> _MockTensor:
        return _MockTensor(np.array(np.argmax(a.arr)))

    def no_grad(self) -> _MockNoGrad:
        return _MockNoGrad()

    def compile(self, fn: Any, mode: str = "default") -> Any:
        _ = mode
        return fn


class TestAwsTerraformAndEphemeralPlatform(unittest.TestCase):
    def setUp(self) -> None:
        self.repo_root = Path(__file__).resolve().parent.parent.parent
        self.tf_root = self.repo_root / "infrastructure" / "terraform"
        self.modules_dir = self.tf_root / "modules"
        self.envs_dir = self.tf_root / "environments"
        clear_flyte_task_cache()

    def test_repository_terraform_validation_passes(self) -> None:
        report = validate_terraform_repository(self.repo_root)
        self.assertTrue(
            report["valid"],
            f"Expected zero Terraform validation errors, got: {report['errors']}",
        )
        self.assertEqual(
            report["modules_validated"],
            [
                "s3-artifacts",
                "sqs-async-queue",
                "iam-least-privilege",
                "ecs-fargate-api",
                "kinesis-event-stream",
                "cost-guardrails",
                "eks-cluster",
            ],
        )
        self.assertEqual(
            report["environments_validated"],
            ["ephemeral", "production"],
        )

    def test_hcl_formatting_and_balance_detector_catches_errors(self) -> None:
        dummy_path = Path("dummy.tf")
        tab_err = check_hcl_formatting_and_balance(dummy_path, 'resource "x" "y" {\n\tfoo = "bar"\n}\n')
        self.assertTrue(any("Tab character" in e for e in tab_err))

        unbalanced_brace = check_hcl_formatting_and_balance(dummy_path, 'resource "x" "y" {\n  foo = "bar"\n')
        self.assertTrue(any("Unbalanced braces" in e for e in unbalanced_brace))

        unterminated_str = check_hcl_formatting_and_balance(dummy_path, 'variable "x" {\n  default = "unclosed\n}\n')
        self.assertTrue(any("Unterminated string" in e for e in unterminated_str))

    def test_module_structure_validator_catches_missing_variable_metadata(self) -> None:
        s3_parsed = parse_terraform_directory(self.modules_dir / "s3-artifacts")
        self.assertEqual(validate_module_structure("s3-artifacts", s3_parsed), [])

        mutated = copy.deepcopy(s3_parsed)
        mutated["blocks"].append(
            {
                "type": "variable",
                "label_1": "undocumented_var",
                "label_2": None,
                "body": 'default = "x"',
            }
        )
        errs = validate_module_structure("s3-artifacts", mutated)
        self.assertTrue(any("missing `description`" in e for e in errs))
        self.assertTrue(any("missing `type`" in e for e in errs))

    def test_security_validator_rejects_wildcard_iam_and_static_keys(self) -> None:
        modules_map = {
            name: parse_terraform_directory(self.modules_dir / name)
            for name in (
                "s3-artifacts",
                "sqs-async-queue",
                "iam-least-privilege",
                "ecs-fargate-api",
                "kinesis-event-stream",
                "cost-guardrails",
                "eks-cluster",
            )
        }
        self.assertEqual(validate_security_and_iam_policies(modules_map), [])

        bad_iam = copy.deepcopy(modules_map)
        bad_iam["iam-least-privilege"]["text"] += '\nresource "aws_iam_access_key" "leaked" {}\nAction = ["s3:*"]\n'
        errs = validate_security_and_iam_policies(bad_iam)
        self.assertTrue(any("aws_iam_access_key" in e for e in errs))
        self.assertTrue(any('"s3:*"' in e for e in errs))

    def test_cost_guardrails_reject_permanent_eks_or_nonzero_gpu_min(self) -> None:
        modules_map = {
            name: parse_terraform_directory(self.modules_dir / name)
            for name in (
                "s3-artifacts",
                "sqs-async-queue",
                "iam-least-privilege",
                "ecs-fargate-api",
                "kinesis-event-stream",
                "cost-guardrails",
                "eks-cluster",
            )
        }
        envs_map = {
            name: parse_terraform_directory(self.envs_dir / name)
            for name in ("ephemeral", "production")
        }
        self.assertEqual(validate_cost_guardrails_and_environments(modules_map, envs_map), [])

        bad_envs = copy.deepcopy(envs_map)
        for blk in bad_envs["ephemeral"]["blocks"]:
            if blk["type"] == "variable" and blk["label_1"] == "enable_eks":
                blk["body"] = blk["body"].replace("default     = false", "default     = true")
        errs = validate_cost_guardrails_and_environments(modules_map, bad_envs)
        self.assertTrue(any("enable_eks" in e for e in errs))

    def test_ephemeral_plan_and_lifecycle_simulation_leave_zero_surviving_resources(self) -> None:
        default_plan = generate_plan_summary("ephemeral", enable_eks=False)
        self.assertFalse(default_plan["enable_eks"])
        self.assertFalse(default_plan["permanent_gpu_or_eks_dependency"])
        self.assertEqual(default_plan["resource_count"], 18)
        self.assertEqual(default_plan["cost_estimation"]["hourly_fixed_usd"], 0.0)
        self.assertTrue(default_plan["cost_estimation"]["within_budget_guardrail"])

        eks_plan = generate_plan_summary(
            "ephemeral", enable_eks=True, enable_gpu_node_group=True
        )
        self.assertEqual(eks_plan["resource_count"], 21)
        self.assertEqual(eks_plan["cost_estimation"]["hourly_fixed_usd"], 0.133)

        lifecycle = simulate_ephemeral_deploy_destroy("test-run-99", enable_eks=False)
        self.assertEqual(lifecycle["resources_created"], 18)
        self.assertEqual(lifecycle["resources_destroyed"], 18)
        self.assertEqual(lifecycle["surviving_resources"], 0)
        self.assertEqual(lifecycle["post_destroy_hourly_cost_usd"], 0.0)

    def test_ephemeral_lifecycle_shell_script_validate_and_production_gate(self) -> None:
        script_path = self.tf_root / "scripts" / "ephemeral-lifecycle.sh"
        res_val = subprocess.run(
            [str(script_path), "validate"],
            cwd=self.repo_root,
            capture_output=True,
            text=True,
        )
        self.assertEqual(res_val.returncode, 0, res_val.stderr)
        self.assertIn("Terraform Validation PASSED", res_val.stdout)

        res_prod = subprocess.run(
            [str(script_path), "deploy", "production"],
            cwd=self.repo_root,
            capture_output=True,
            text=True,
        )
        self.assertNotEqual(res_prod.returncode, 0)
        self.assertIn("CONFIRM_PRODUCTION_APPLY=yes", res_prod.stderr)

    def test_helm_aws_ephemeral_values_render_and_pass_kyverno(self) -> None:
        chart_dir = self.repo_root / "deploy" / "helm" / "inference-platform"
        docs = render_helm_chart(chart_dir, chart_dir / "values-aws-ephemeral.yaml")
        self.assertEqual(len(docs), 22)
        for doc in docs:
            violations = validate_manifest_against_kyverno(doc)
            self.assertEqual(violations, [], f"Kyverno violation in {doc.get('kind')}: {violations}")

    def test_torchscript_jit_trace_and_flyte_kueue_kyverno_multi_stage_workflow(self) -> None:
        mock_torch = _MockTorchWithJit()
        loader = ModelLoader(torch_module=mock_torch, prefer_device="cpu")
        loaded, is_warm = loader.load("TinyLlama/TinyLlama-1.1B-Chat-v1.0", use_torchscript=True)
        self.assertFalse(is_warm)
        self.assertEqual(loaded.backend.backend_name, "pytorch_torchscript_cpu")

        # Execute full 3-stage Flyte workflow for text_to_video and video_to_video modification using local MP4 fixture
        out1 = multi_stage_inference_workflow(
            tenant_id="tenant-runway",
            job_id="job-flyte-01",
            model_id="TinyLlama/TinyLlama-1.1B-Chat-v1.0",
            prompt="Generate multi-stage keyframes and optical flow metadata.",
            max_new_tokens=8,
            modality="video_to_video",
            source_asset_uri="tests/fixtures/media/sample_clip.mp4",
            fps=24,
            duration_seconds=4,
            edit_operation="style_transfer",
            edit_strength=0.8,
            loader=loader,
        )
        self.assertEqual(out1["orchestration_path"], "Path B (Flyte + Kueue + Kyverno)")
        self.assertEqual(out1["modality"], "video_to_video")
        self.assertEqual(out1["edit_operation"], "style_transfer")
        self.assertTrue(out1["asset_inspection"]["exists_on_disk"])
        self.assertEqual(out1["asset_inspection"]["container_format"], "mp4")
        self.assertTrue(out1["asset_inspection"]["valid_header"])
        self.assertGreater(out1["asset_inspection"]["byte_size"], 100)
        self.assertEqual(out1["backend_name"], "pytorch_torchscript_cpu")
        self.assertFalse(out1["flyte_stage1_cache_hit"])
        self.assertIn("cloudfront.net/tenants/tenant-runway/jobs/job-flyte-01/result.json", out1["cloudfront_artifact_url"])
        self.assertIn("cloudfront.net/tenants/tenant-runway/jobs/job-flyte-01/output.mp4", out1["cloudfront_media_url"])
        self.assertEqual(out1["usage"]["frames_generated"], 96)
        self.assertGreater(out1["usage"]["total_tokens"], 96 * 16)
        self.assertEqual(out1["kinesis_metering_event"]["event_type"], "WORKFLOW_STAGE_COMPLETED")
        self.assertEqual(out1["kinesis_metering_event"]["modality"], "video_to_video")

        # Second invocation with identical Stage 1 inputs hits Flyte task memoization cache
        out2 = multi_stage_inference_workflow(
            tenant_id="tenant-runway",
            job_id="job-flyte-01",
            model_id="TinyLlama/TinyLlama-1.1B-Chat-v1.0",
            prompt="Generate multi-stage keyframes and optical flow metadata.",
            max_new_tokens=8,
            modality="video_to_video",
            source_asset_uri="tests/fixtures/media/sample_clip.mp4",
            fps=24,
            duration_seconds=4,
            edit_operation="style_transfer",
            edit_strength=0.8,
            loader=loader,
        )
        self.assertTrue(out2["flyte_stage1_cache_hit"])

        # Also verify PNG keyframe fixture inspection
        out_png = multi_stage_inference_workflow(
            tenant_id="tenant-runway",
            job_id="job-flyte-png-01",
            model_id="TinyLlama/TinyLlama-1.1B-Chat-v1.0",
            prompt="Keyframe conditioning pass.",
            max_new_tokens=8,
            modality="text_to_image",
            source_asset_uri="tests/fixtures/media/sample_keyframe.png",
            loader=loader,
        )
        self.assertEqual(out_png["asset_inspection"]["container_format"], "png")
        self.assertEqual(out_png["asset_inspection"]["width"], 64)
        self.assertEqual(out_png["asset_inspection"]["height"], 64)
        self.assertTrue(out_png["asset_inspection"]["valid_header"])

        # Verify pet JPEG fixture inspection (cat.jpg)
        out_cat = multi_stage_inference_workflow(
            tenant_id="tenant-runway",
            job_id="job-flyte-cat-01",
            model_id="TinyLlama/TinyLlama-1.1B-Chat-v1.0",
            prompt="Identify domestic cat and extract segmentation mask.",
            max_new_tokens=8,
            modality="text_to_image",
            source_asset_uri="tests/fixtures/media/cat.jpg",
            loader=loader,
        )
        self.assertEqual(out_cat["asset_inspection"]["container_format"], "jpeg")
        self.assertEqual(out_cat["asset_inspection"]["width"], 600)
        self.assertEqual(out_cat["asset_inspection"]["height"], 400)
        self.assertTrue(out_cat["asset_inspection"]["valid_header"])

        # Verify person portrait fixture inspection (portrait_person.jpg for background removal)
        out_portrait = multi_stage_inference_workflow(
            tenant_id="tenant-runway",
            job_id="job-flyte-portrait-01",
            model_id="TinyLlama/TinyLlama-1.1B-Chat-v1.0",
            prompt="Remove background from human selfie portrait.",
            max_new_tokens=8,
            modality="text_to_image",
            source_asset_uri="tests/fixtures/media/portrait_person.jpg",
            loader=loader,
        )
        self.assertEqual(out_portrait["asset_inspection"]["container_format"], "jpeg")
        self.assertEqual(out_portrait["asset_inspection"]["width"], 820)
        self.assertEqual(out_portrait["asset_inspection"]["height"], 1024)
        self.assertTrue(out_portrait["asset_inspection"]["valid_header"])

        # Verify full MP4 video clip inspection (sample_bunny_clip.mp4)
        out_bunny = multi_stage_inference_workflow(
            tenant_id="tenant-runway",
            job_id="job-flyte-bunny-01",
            model_id="TinyLlama/TinyLlama-1.1B-Chat-v1.0",
            prompt="Apply stylized neural render to bunny video clip.",
            max_new_tokens=8,
            modality="video_to_video",
            source_asset_uri="tests/fixtures/media/sample_bunny_clip.mp4",
            loader=loader,
        )
        self.assertEqual(out_bunny["asset_inspection"]["container_format"], "mp4")
        self.assertTrue(out_bunny["asset_inspection"]["valid_header"])
        self.assertGreater(out_bunny["asset_inspection"]["byte_size"], 900000)

        # Verify athlete fixtures (Jorge Martin MotoGP, Fernando Alonso F1, Lamine Yamal Spain)
        out_martin = multi_stage_inference_workflow(
            tenant_id="tenant-runway",
            job_id="job-flyte-martin-01",
            model_id="TinyLlama/TinyLlama-1.1B-Chat-v1.0",
            prompt="Segment MotoGP world champion rider Jorge Martin with helmet.",
            max_new_tokens=8,
            modality="text_to_image",
            source_asset_uri="tests/fixtures/media/jorge_martin_motogp.jpg",
            loader=loader,
        )
        self.assertEqual(out_martin["asset_inspection"]["container_format"], "jpeg")
        self.assertEqual(out_martin["asset_inspection"]["width"], 960)
        self.assertEqual(out_martin["asset_inspection"]["height"], 1281)

        out_alonso = multi_stage_inference_workflow(
            tenant_id="tenant-runway",
            job_id="job-flyte-alonso-01",
            model_id="TinyLlama/TinyLlama-1.1B-Chat-v1.0",
            prompt="Isolate F1 champion Fernando Alonso race suit and background.",
            max_new_tokens=8,
            modality="text_to_image",
            source_asset_uri="tests/fixtures/media/fernando_alonso_f1.jpg",
            loader=loader,
        )
        self.assertEqual(out_alonso["asset_inspection"]["container_format"], "jpeg")
        self.assertEqual(out_alonso["asset_inspection"]["width"], 960)
        self.assertEqual(out_alonso["asset_inspection"]["height"], 1268)

        out_yamal = multi_stage_inference_workflow(
            tenant_id="tenant-runway",
            job_id="job-flyte-yamal-01",
            model_id="TinyLlama/TinyLlama-1.1B-Chat-v1.0",
            prompt="Detect Spain national team player Lamine Yamal in match action.",
            max_new_tokens=8,
            modality="text_to_image",
            source_asset_uri="tests/fixtures/media/lamine_yamal_spain.jpg",
            loader=loader,
        )
        self.assertEqual(out_yamal["asset_inspection"]["container_format"], "jpeg")
        self.assertEqual(out_yamal["asset_inspection"]["width"], 960)
        self.assertEqual(out_yamal["asset_inspection"]["height"], 640)

        # Verify Flyte task specs and rendered K8s GPU Job compliance with Kyverno & Kueue
        specs = get_flyte_pipeline_task_specs()
        self.assertEqual([s.requests.gpu for s in specs], ["0", "1", "0"])
        self.assertEqual(specs[1].kueue_queue, "tenant-default-gpu-queue")

        flyte_k8s_job = render_flyte_gpu_stage_k8s_job("tenant-runway")
        self.assertEqual(validate_manifest_against_kyverno(flyte_k8s_job), [])


if __name__ == "__main__":
    unittest.main()
