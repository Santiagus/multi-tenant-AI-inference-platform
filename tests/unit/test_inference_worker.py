"""Unit and contract tests for M04 Python/PyTorch inference worker, telemetry, and benchmarks."""

from __future__ import annotations

import asyncio
from contextlib import redirect_stdout
import io
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
from typing import Any
import unittest

import numpy as np  # type: ignore[import-not-found]

from apps.worker.artifacts import ArtifactHandler
from apps.worker.consumer import WorkerRuntime, run_cli
from apps.worker.contracts import (
    HardwareTelemetry,
    InferenceError,
    InferenceRequest,
    InferenceResult,
    UsageMetrics,
)
from apps.worker.models import (
    ModelLoader,
    ModelSpec,
    NumpyCpuModelBackend,
    PyTorchModelBackend,
    tokenize_prompt,
)
from apps.worker.providers.local import LocalPyTorchAdapter
from apps.worker.telemetry import TelemetryCollector
from benchmarks.run_inference_benchmark import (
    compute_percentile,
    main as benchmark_main,
    render_markdown_report,
    run_benchmark_suite,
)


class _FakeTorchTensor:
    """Minimal tensor stub wrapping a NumPy array to test PyTorchModelBackend without a full GPU install."""

    def __init__(self, arr: np.ndarray) -> None:
        self.arr = np.asarray(arr, dtype=np.float32)

    def __mul__(self, other: float) -> _FakeTorchTensor:
        return _FakeTorchTensor(self.arr * other)

    def __truediv__(self, other: float) -> _FakeTorchTensor:
        return _FakeTorchTensor(self.arr / other)

    def __add__(self, other: _FakeTorchTensor) -> _FakeTorchTensor:
        return _FakeTorchTensor(self.arr + other.arr)

    def __getitem__(self, idx: Any) -> _FakeTorchTensor:
        if isinstance(idx, _FakeTorchTensor):
            return _FakeTorchTensor(self.arr[idx.arr.astype(np.int64)])
        return _FakeTorchTensor(self.arr[idx])

    def mean(self, dim: int = 0, keepdim: bool = False) -> _FakeTorchTensor:
        return _FakeTorchTensor(np.mean(self.arr, axis=dim, keepdims=keepdim))

    def item(self) -> float:
        return float(self.arr.item())


class _FakeNoGrad:
    def __enter__(self) -> None:
        return None

    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        return None


class _FakeCudaModule:
    def __init__(self, available: bool = True) -> None:
        self._available = available
        self.reset_called = False
        self.sync_called = False

    def is_available(self) -> bool:
        return self._available

    def reset_peak_memory_stats(self) -> None:
        self.reset_called = True

    def synchronize(self) -> None:
        self.sync_called = True

    def get_device_name(self, idx: int = 0) -> str:
        return "NVIDIA GeForce RTX 5070 Ti"

    def memory_allocated(self, idx: int = 0) -> int:
        return 64 * 1024 * 1024

    def memory_reserved(self, idx: int = 0) -> int:
        return 128 * 1024 * 1024

    def max_memory_allocated(self, idx: int = 0) -> int:
        return 96 * 1024 * 1024

    def get_device_properties(self, idx: int = 0) -> Any:
        return SimpleNamespace(total_memory=16 * 1024 * 1024 * 1024)


class _FakeTorchModule:
    """Deterministic stub mimicking torch + torch.cuda APIs for unit testing."""

    long = "int64"
    __version__ = "2.5.0+cu124-stub"

    def __init__(self, cuda_available: bool = True) -> None:
        self.cuda = _FakeCudaModule(available=cuda_available)
        self._rng = np.random.default_rng(42)

    def manual_seed(self, seed: int) -> None:
        self._rng = np.random.default_rng(seed)

    def randn(self, shape: tuple[int, ...], device: str = "cpu") -> _FakeTorchTensor:
        return _FakeTorchTensor(self._rng.standard_normal(shape, dtype=np.float32))

    def tensor(self, data: list[int], dtype: Any = None, device: str = "cpu") -> _FakeTorchTensor:
        return _FakeTorchTensor(np.array(data, dtype=np.float32))

    def matmul(self, a: _FakeTorchTensor, b: _FakeTorchTensor) -> _FakeTorchTensor:
        return _FakeTorchTensor(a.arr @ b.arr)

    def tanh(self, a: _FakeTorchTensor) -> _FakeTorchTensor:
        return _FakeTorchTensor(np.tanh(a.arr))

    def argmax(self, a: _FakeTorchTensor) -> _FakeTorchTensor:
        return _FakeTorchTensor(np.array(np.argmax(a.arr)))

    def no_grad(self) -> _FakeNoGrad:
        return _FakeNoGrad()


class TestInferenceWorkerAndBenchmark(unittest.TestCase):
    """Comprehensive tests for M04 Python worker, PyTorch/CPU backends, telemetry, and benchmarks."""

    def test_contracts_parsing_and_validation(self) -> None:
        req = InferenceRequest.from_dict(
            {
                "job_id": "job-123",
                "tenant_id": "tenant-a",
                "model_id": "meta-llama/Llama-3-8B-Instruct",
                "input": {
                    "prompt": "Explain tensor parallelism.",
                    "parameters": {"max_new_tokens": 16, "temperature": 0.5},
                    "extra_flag": True,
                },
            }
        )
        self.assertEqual(req.job_id, "job-123")
        self.assertEqual(req.tenant_id, "tenant-a")
        self.assertEqual(req.parameters["max_new_tokens"], 16)
        self.assertEqual(req.parameters["extra_flag"], True)

        flat_req = InferenceRequest.from_dict(
            {
                "jobId": "job-456",
                "tenantId": "tenant-b",
                "modelId": "TinyLlama/TinyLlama-1.1B-Chat-v1.0",
                "prompt": "Direct prompt",
                "parameters": {"max_new_tokens": 8},
            }
        )
        self.assertEqual(flat_req.job_id, "job-456")
        self.assertEqual(flat_req.prompt, "Direct prompt")

        with self.assertRaises(InferenceError) as ctx:
            InferenceRequest.from_dict({"job_id": "job-err", "model_id": "   "})
        self.assertEqual(ctx.exception.code, "INVALID_MODEL_ID")
        self.assertFalse(ctx.exception.is_transient)

    def test_numpy_cpu_backend_and_context_limit(self) -> None:
        spec = ModelSpec(
            model_id="test/tiny-model",
            hidden_dim=32,
            num_layers=2,
            vocab_size=64,
            max_context_length=4,
            cost_microcents_per_token=3,
            estimated_vram_mb=1.5,
        )
        backend = NumpyCpuModelBackend(spec)
        self.assertEqual(backend.backend_name, "numpy_cpu_fallback")
        self.assertGreater(backend.footprint_mb, 0.0)

        out_text, tok_in, tok_out, ttft_ms, total_ms = backend.generate(
            prompt="hello world", max_new_tokens=6, temperature=0.7
        )
        self.assertIn("[test/tiny-model]", out_text)
        self.assertEqual(tok_in, 2)
        self.assertEqual(tok_out, 6)
        self.assertGreater(ttft_ms, 0.0)
        self.assertGreaterEqual(total_ms, ttft_ms)

        # Empty prompt tokenization fallback
        self.assertEqual(tokenize_prompt("   "), [1])

        # Exceeding max_context_length raises permanent InferenceError
        with self.assertRaises(InferenceError) as ctx:
            backend.generate(prompt="one two three four five six", max_new_tokens=4)
        self.assertEqual(ctx.exception.code, "INVALID_MODEL_PARAMETERS")

    def test_pytorch_cuda_and_cpu_backend_with_telemetry(self) -> None:
        fake_torch_cuda = _FakeTorchModule(cuda_available=True)
        telemetry = TelemetryCollector(torch_module=fake_torch_cuda)
        self.assertTrue(telemetry.is_cuda_available())
        self.assertTrue(telemetry.is_torch_available())

        loader = ModelLoader(torch_module=fake_torch_cuda, prefer_device="cuda")
        self.assertEqual(loader.resolve_device(), "cuda")

        loaded, is_warm = loader.load("meta-llama/Llama-3-8B-Instruct")
        self.assertFalse(is_warm)
        self.assertIsInstance(loaded.backend, PyTorchModelBackend)
        self.assertEqual(loaded.backend.backend_name, "pytorch_cuda")

        # Second load hits warm cache
        loaded_again, is_warm_again = loader.load("meta-llama/Llama-3-8B-Instruct")
        self.assertTrue(is_warm_again)
        self.assertEqual(loaded, loaded_again)
        self.assertIn("meta-llama/Llama-3-8B-Instruct", loader.cached_models())

        adapter = LocalPyTorchAdapter(model_loader=loader, telemetry_collector=telemetry)
        self.assertTrue(asyncio.run(adapter.is_healthy()))

        req = InferenceRequest(
            job_id="job-cuda-1",
            tenant_id="tenant-gpu",
            model_id="meta-llama/Llama-3-8B-Instruct",
            prompt="Run GPU tensor pass.",
            parameters={"max_new_tokens": 10},
        )
        projected_cost = asyncio.run(adapter.estimate_cost(req))
        self.assertGreater(projected_cost, 0)

        res = asyncio.run(adapter.predict(req))
        self.assertEqual(res.provider_name, "local_pytorch")
        self.assertEqual(res.telemetry.device_type, "cuda")
        self.assertEqual(res.telemetry.device_name, "NVIDIA GeForce RTX 5070 Ti")
        self.assertEqual(res.telemetry.vram_allocated_mb, 64.0)
        self.assertEqual(res.telemetry.vram_peak_mb, 96.0)
        self.assertEqual(res.telemetry.vram_total_mb, 16384.0)
        self.assertTrue(fake_torch_cuda.cuda.reset_called)
        self.assertTrue(fake_torch_cuda.cuda.sync_called)

        # Also test PyTorch CPU device resolution and context limit
        fake_torch_cpu = _FakeTorchModule(cuda_available=False)
        cpu_loader = ModelLoader(torch_module=fake_torch_cpu, prefer_device="cpu")
        self.assertEqual(cpu_loader.resolve_device(), "cpu")
        custom_loaded, _ = cpu_loader.load("custom-org/custom-model")
        self.assertEqual(custom_loaded.backend.backend_name, "pytorch_cpu")

    def test_adapter_error_simulations_and_parameter_validation(self) -> None:
        adapter = LocalPyTorchAdapter()

        with self.assertRaises(InferenceError) as perm_ctx:
            asyncio.run(
                adapter.predict(
                    InferenceRequest(
                        job_id="j1",
                        tenant_id="t1",
                        model_id="meta-llama/Llama-3-8B-Instruct",
                        prompt="test",
                        parameters={"_simulate_failure": "permanent"},
                    )
                )
            )
        self.assertFalse(perm_ctx.exception.is_transient)

        with self.assertRaises(InferenceError) as trans_ctx:
            asyncio.run(
                adapter.predict(
                    InferenceRequest(
                        job_id="j2",
                        tenant_id="t1",
                        model_id="meta-llama/Llama-3-8B-Instruct",
                        prompt="test",
                        parameters={"_simulate_failure": "transient"},
                    )
                )
            )
        self.assertTrue(trans_ctx.exception.is_transient)

        with self.assertRaises(InferenceError) as once_ctx:
            asyncio.run(
                adapter.predict(
                    InferenceRequest(
                        job_id="j3",
                        tenant_id="t1",
                        model_id="meta-llama/Llama-3-8B-Instruct",
                        prompt="test",
                        parameters={"_simulate_failure": "transient_once"},
                        retry_count=0,
                    )
                )
            )
        self.assertTrue(once_ctx.exception.is_transient)

        # Retry count > 0 succeeds for transient_once
        recovered = asyncio.run(
            adapter.predict(
                InferenceRequest(
                    job_id="j3",
                    tenant_id="t1",
                    model_id="meta-llama/Llama-3-8B-Instruct",
                    prompt="test",
                    parameters={"_simulate_failure": "transient_once", "max_new_tokens": 4},
                    retry_count=1,
                )
            )
        )
        self.assertEqual(recovered.usage.completion_tokens, 4)

        with self.assertRaises(InferenceError) as bad_tok_ctx:
            asyncio.run(
                adapter.predict(
                    InferenceRequest(
                        job_id="j4",
                        tenant_id="t1",
                        model_id="meta-llama/Llama-3-8B-Instruct",
                        prompt="test",
                        parameters={"max_new_tokens": 0},
                    )
                )
            )
        self.assertEqual(bad_tok_ctx.exception.code, "INVALID_MODEL_PARAMETERS")

    def test_artifact_handler_and_worker_cli(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_path = Path(tmpdir)
            handler = ArtifactHandler(bucket="test-bucket", local_root=tmp_path)
            runtime = WorkerRuntime(artifact_handler=handler)

            res = asyncio.run(
                runtime.process_job_payload(
                    {
                        "job_id": "job-art-1",
                        "tenant_id": "tenant-z",
                        "model_id": "TinyLlama/TinyLlama-1.1B-Chat-v1.0",
                        "input": {"prompt": "Write artifact", "parameters": {"max_new_tokens": 6}},
                    }
                )
            )
            self.assertTrue(res["ok"])
            self.assertEqual(res["output_uri"], "s3://test-bucket/tenants/tenant-z/outputs/job-art-1/result.json")
            expected_file = tmp_path / "tenants" / "tenant-z" / "outputs" / "job-art-1" / "result.json"
            self.assertTrue(expected_file.is_file())
            stored_json = json.loads(expected_file.read_text(encoding="utf-8"))
            self.assertEqual(stored_json["job_id"], "job-art-1")

        # Test CLI healthcheck
        buf = io.StringIO()
        with redirect_stdout(buf):
            code = run_cli(["--healthcheck"])
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(buf.getvalue())["status"], "ok")

        # Test CLI valid payload
        buf2 = io.StringIO()
        with redirect_stdout(buf2):
            code2 = run_cli(
                [
                    "--payload",
                    json.dumps(
                        {
                            "job_id": "cli-job-1",
                            "tenant_id": "tenant-1",
                            "model_id": "meta-llama/Llama-3-8B-Instruct",
                            "input": {"prompt": "CLI test", "parameters": {"max_new_tokens": 5}},
                        }
                    ),
                ]
            )
        self.assertEqual(code2, 0)
        parsed2 = json.loads(buf2.getvalue())
        self.assertTrue(parsed2["ok"])
        self.assertEqual(parsed2["tokens_out"], 5)

        # Test CLI invalid JSON payload
        buf3 = io.StringIO()
        with redirect_stdout(buf3):
            code3 = run_cli(["--payload", "{not-json"])
        self.assertEqual(code3, 1)
        self.assertEqual(json.loads(buf3.getvalue())["error"]["code"], "INVALID_WORKER_PAYLOAD")

    def test_benchmark_suite_and_report_generation(self) -> None:
        self.assertEqual(compute_percentile([], 50), 0.0)
        self.assertEqual(compute_percentile([10.0, 20.0, 30.0], 50), 20.0)

        with tempfile.TemporaryDirectory() as tmpdir:
            out_dir = Path(tmpdir)
            # Run 1: TinyLlama
            exit_code_1 = benchmark_main(
                [
                    "--model-id",
                    "TinyLlama/TinyLlama-1.1B-Chat-v1.0",
                    "--max-new-tokens",
                    "8",
                    "--samples",
                    "2",
                    "--prompt-tiers",
                    "short,long",
                    "--output-dir",
                    str(out_dir),
                ]
            )
            self.assertEqual(exit_code_1, 0)

            # Run 2: Llama-3-8B
            exit_code_2 = benchmark_main(
                [
                    "--model-id",
                    "meta-llama/Llama-3-8B-Instruct",
                    "--max-new-tokens",
                    "8",
                    "--samples",
                    "2",
                    "--prompt-tiers",
                    "short,medium,long",
                    "--output-dir",
                    str(out_dir),
                ]
            )
            self.assertEqual(exit_code_2, 0)

            json_file = out_dir / "m04_inference_benchmark.json"
            md_file = out_dir / "m04_inference_benchmark.md"
            manifest_file = out_dir / "manifest.json"
            history_file = out_dir / "history.jsonl"
            index_file = out_dir / "index.md"

            self.assertTrue(json_file.is_file())
            self.assertTrue(md_file.is_file())
            self.assertTrue(manifest_file.is_file())
            self.assertTrue(history_file.is_file())
            self.assertTrue(index_file.is_file())

            report = json.loads(json_file.read_text(encoding="utf-8"))
            self.assertEqual(report["schema_version"], "1.0.0")
            self.assertIn("run_id", report)
            self.assertIn("run_date", report)
            self.assertEqual(report["hardware_environment"]["measurement_mode"], "measured")
            self.assertEqual(report["reference_projections_estimated"]["measurement_type"], "estimated")
            self.assertIn("chart_series", report)
            self.assertIn("concurrency_scaling_by_prompt_tier", report["chart_series"])
            self.assertIn("prompt_tier_latency_breakdown_c1", report["chart_series"])
            self.assertEqual(len(report["routing_recommendations_by_prompt_tier"]), 3)
            self.assertEqual(len(report["reference_provider_comparison_estimated"]), 3)

            # Verify manifest.json tracks both dated runs and points to valid per-run report files
            manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
            self.assertEqual(manifest["total_runs"], 2)
            self.assertEqual(len(manifest["runs"]), 2)
            for run_entry in manifest["runs"]:
                self.assertTrue((out_dir / run_entry["report_json_path"]).is_file())
                self.assertTrue((out_dir / run_entry["report_md_path"]).is_file())

            history_lines = [
                line for line in history_file.read_text(encoding="utf-8").splitlines() if line.strip()
            ]
            self.assertEqual(len(history_lines), 2)

            md_text = render_markdown_report(report)
            self.assertIn("`Measured`", md_text)
            self.assertIn("`Estimated`", md_text)
            self.assertIn("Prompt-Size-Aware Provider Routing Reference Matrix", md_text)


if __name__ == "__main__":
    unittest.main()
