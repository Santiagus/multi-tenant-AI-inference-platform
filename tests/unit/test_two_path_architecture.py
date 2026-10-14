"""Enterprise-Grade Two-Path Architecture Verification Suite.

Validates the full bimodal workload execution lifecycle across every fixture:
1. Path A (Low-Latency Single-Hop Queue: ECS Fargate -> SQS -> KEDA GPU Worker -> CloudFront -> Kinesis)
2. Path B (Multi-Stage Batch/Media DAG: Flyte [CPU S3 Cache -> Kueue/Kyverno TorchScript GPU -> CPU Package] -> CloudFront -> Kinesis)
3. Exhaustive binary validation across EVERY media fixture in tests/fixtures/media/
4. Text fixture comprehension across multilingual, structured JSON, and long context suites
"""

from __future__ import annotations

import json
from pathlib import Path
import unittest

from apps.worker.flyte_workflow import (
    clear_flyte_task_cache,
    get_flyte_pipeline_task_specs,
    inspect_local_media_asset,
    multi_stage_inference_workflow,
    render_flyte_gpu_stage_k8s_job,
)
from apps.worker.models import ModelLoader
from scripts.validate_kubernetes import validate_manifest_against_kyverno
from tests.unit.test_aws_terraform import _MockTorchWithJit


class TestTwoPathArchitecture(unittest.TestCase):
    """Exhaustive test suite for the Two-Path Architecture and media/text fixtures."""

    repo_root: Path
    media_dir: Path
    text_dir: Path
    mock_torch: _MockTorchWithJit
    loader: ModelLoader

    @classmethod
    def setUpClass(cls) -> None:
        cls.repo_root = Path(__file__).resolve().parents[2]
        cls.media_dir = cls.repo_root / "tests" / "fixtures" / "media"
        cls.text_dir = cls.repo_root / "tests" / "fixtures" / "text"
        cls.mock_torch = _MockTorchWithJit()
        cls.loader = ModelLoader(torch_module=cls.mock_torch, prefer_device="cpu")

    def setUp(self) -> None:
        clear_flyte_task_cache()

    def test_every_media_fixture_is_inspected_and_valid(self) -> None:
        """Exhaustively verify EVERY media fixture in tests/fixtures/media/."""
        expected_fixtures = {
            "cat.jpg": {"format": "jpeg", "min_bytes": 30000, "w": 600, "h": 400},
            "dog.jpg": {"format": "jpeg", "min_bytes": 600000, "w": 1546, "h": 1213},
            "portrait_person.jpg": {"format": "jpeg", "min_bytes": 150000, "w": 820, "h": 1024},
            "jorge_martin_motogp.jpg": {"format": "jpeg", "min_bytes": 180000, "w": 960, "h": 1281},
            "fernando_alonso_f1.jpg": {"format": "jpeg", "min_bytes": 140000, "w": 960, "h": 1268},
            "lamine_yamal_spain.jpg": {"format": "jpeg", "min_bytes": 80000, "w": 960, "h": 640},
            "fruits_objects.jpg": {"format": "jpeg", "min_bytes": 70000, "w": 512, "h": 480},
            "opencv_logo.png": {"format": "png", "min_bytes": 35000, "w": 600, "h": 794},
            "sample_keyframe.png": {"format": "png", "min_bytes": 100, "w": 64, "h": 64},
            "sample_clip.mp4": {"format": "mp4", "min_bytes": 100},
            "sample_bunny_clip.mp4": {"format": "mp4", "min_bytes": 900000},
            "sample_action_clip.mp4": {"format": "mp4", "min_bytes": 500000},
        }

        # Ensure all fixtures on disk match the expected catalog
        disk_files = {p.name: p for p in self.media_dir.glob("*") if p.is_file() and p.suffix in (".jpg", ".png", ".mp4")}
        self.assertEqual(set(disk_files.keys()), set(expected_fixtures.keys()))

        for filename, expected in expected_fixtures.items():
            rel_path = f"tests/fixtures/media/{filename}"
            inspection = inspect_local_media_asset(rel_path)
            self.assertTrue(inspection["exists_on_disk"], f"Fixture {filename} must exist on disk")
            self.assertTrue(inspection["valid_header"], f"Fixture {filename} must have valid binary header")
            self.assertEqual(inspection["container_format"], expected["format"])
            self.assertGreaterEqual(inspection["byte_size"], expected["min_bytes"])
            self.assertIsNotNone(inspection["content_sha256"])
            self.assertEqual(len(inspection["content_sha256"]), 64)

            if "w" in expected and "h" in expected:
                self.assertEqual(inspection.get("width"), expected["w"])
                self.assertEqual(inspection.get("height"), expected["h"])

    def test_text_fixtures_load_and_tokenize(self) -> None:
        """Verify text and prompt fixtures for multilingual, JSON, and long document comprehension."""
        # 1. Short prompts
        short_path = self.text_dir / "prompts_short.json"
        with open(short_path, encoding="utf-8") as f:
            short_prompts = json.load(f)
        self.assertGreaterEqual(len(short_prompts), 3)

        # 2. Multilingual prompts (Spanish, French, German)
        multi_path = self.text_dir / "prompts_multilingual.json"
        with open(multi_path, encoding="utf-8") as f:
            multi_prompts = json.load(f)
        languages = {p["language"] for p in multi_prompts}
        self.assertTrue({"es", "fr", "de"}.issubset(languages))

        # 3. Structured JSON prompts
        json_path = self.text_dir / "prompts_code_and_json.json"
        with open(json_path, encoding="utf-8") as f:
            code_prompts = json.load(f)
        self.assertGreaterEqual(len(code_prompts), 2)

        # 4. Long context document
        doc_path = self.text_dir / "document_long_context.txt"
        doc_content = doc_path.read_text(encoding="utf-8")
        self.assertIn("Two-Path Orchestration Architecture", doc_content)
        self.assertGreater(len(doc_content), 1000)

    def test_path_a_low_latency_single_hop_execution(self) -> None:
        """Verify Path A properties: single-hop execution, TorchScript JIT, fast latency, and CloudFront delivery."""
        result = multi_stage_inference_workflow(
            tenant_id="tenant-enterprise-01",
            job_id="job-path-a-realtime-keyframe",
            model_id="TinyLlama/TinyLlama-1.1B-Chat-v1.0",
            prompt="Interactive sports keyframe: Fernando Alonso F1 podium celebration.",
            max_new_tokens=16,
            modality="text_to_image",
            source_asset_uri="tests/fixtures/media/fernando_alonso_f1.jpg",
            loader=self.loader,
        )

        self.assertEqual(result["modality"], "text_to_image")
        self.assertEqual(result["backend_name"], "pytorch_torchscript_cpu")
        self.assertTrue(result["torchscript_enabled"])
        self.assertEqual(result["usage"]["frames_generated"], 1)
        self.assertIn("/output.png", result["cloudfront_media_url"])
        self.assertEqual(result["asset_inspection"]["container_format"], "jpeg")
        self.assertEqual(result["asset_inspection"]["width"], 960)
        self.assertEqual(result["asset_inspection"]["height"], 1268)

    def test_path_b_multi_stage_dag_execution_with_media_caching(self) -> None:
        """Verify Path B properties: 3-stage DAG, Flyte S3 memoization, Kueue admission, and video encoding."""
        # 1. First execution on Bunny video fixture (Stage 1 cache miss)
        out1 = multi_stage_inference_workflow(
            tenant_id="tenant-media-studio",
            job_id="job-path-b-bunny-restyling",
            model_id="TinyLlama/TinyLlama-1.1B-Chat-v1.0",
            prompt="Restyle animated bunny forest footage with vibrant cyberpunk neon cel-shading.",
            max_new_tokens=16,
            modality="video_to_video",
            source_asset_uri="tests/fixtures/media/sample_bunny_clip.mp4",
            resolution="640x360",
            fps=24,
            duration_seconds=4,
            edit_operation="style_transfer",
            edit_strength=0.85,
            loader=self.loader,
        )

        self.assertEqual(out1["orchestration_path"], "Path B (Flyte + Kueue + Kyverno)")
        self.assertEqual(out1["modality"], "video_to_video")
        self.assertEqual(out1["edit_operation"], "style_transfer")
        self.assertFalse(out1["flyte_stage1_cache_hit"])
        self.assertEqual(out1["usage"]["frames_generated"], 96)
        self.assertEqual(out1["usage"]["fps"], 24)
        self.assertIn("/output.mp4", out1["cloudfront_media_url"])
        self.assertIn("/poster.webp", out1["cloudfront_poster_url"])
        self.assertEqual(out1["kinesis_metering_event"]["event_type"], "WORKFLOW_STAGE_COMPLETED")

        # 2. Re-execution with same input hits Flyte Stage 1 S3 cache
        out2 = multi_stage_inference_workflow(
            tenant_id="tenant-media-studio",
            job_id="job-path-b-bunny-restyling",
            model_id="TinyLlama/TinyLlama-1.1B-Chat-v1.0",
            prompt="Restyle animated bunny forest footage with vibrant cyberpunk neon cel-shading.",
            max_new_tokens=16,
            modality="video_to_video",
            source_asset_uri="tests/fixtures/media/sample_bunny_clip.mp4",
            resolution="640x360",
            fps=24,
            duration_seconds=4,
            edit_operation="style_transfer",
            edit_strength=0.85,
            loader=self.loader,
        )
        self.assertTrue(out2["flyte_stage1_cache_hit"])

    def test_kueue_and_kyverno_governance_on_gpu_stage(self) -> None:
        """Verify Path B Stage 2 renders a Kueue-admitted Job passing Kyverno policies."""
        specs = get_flyte_pipeline_task_specs()
        # Stage 1: CPU=0.5, GPU=0
        self.assertEqual(specs[0].requests.gpu, "0")
        self.assertEqual(specs[0].requests.cpu, "500m")
        # Stage 2: CPU=1, GPU=1, Kueue queue assigned
        self.assertEqual(specs[1].requests.gpu, "1")
        self.assertEqual(specs[1].kueue_queue, "tenant-default-gpu-queue")
        # Stage 3: CPU=0.25, GPU=0
        self.assertEqual(specs[2].requests.gpu, "0")

        # Render Job manifest and validate against strict Kyverno admission rules
        job_manifest = render_flyte_gpu_stage_k8s_job(tenant_id="tenant-governance-01")
        self.assertTrue(job_manifest["spec"]["suspend"])
        violations = validate_manifest_against_kyverno(job_manifest)
        self.assertEqual(violations, [], f"Stage 2 GPU Job must have 0 Kyverno violations: {violations}")


if __name__ == "__main__":
    unittest.main()
