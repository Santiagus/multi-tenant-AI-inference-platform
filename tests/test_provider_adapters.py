"""Unit and contract tests for multi-tenant inference provider adapters."""

from __future__ import annotations

import asyncio
import os
import unittest

from apps.worker.consumer import WorkerRuntime, run_cli
from apps.worker.contracts import InferenceError, InferenceRequest
from apps.worker.providers.bedrock import BedrockAdapter
from apps.worker.providers.local import LocalPyTorchAdapter
from apps.worker.providers.registry import ProviderRegistry, get_default_registry
from apps.worker.providers.runpod import RunPodAdapter
from apps.worker.providers.sagemaker import SageMakerAdapter


class TestProviderAdapters(unittest.IsolatedAsyncioTestCase):
    """Verifies all provider adapters conform to InferenceProvider contracts."""

    async def test_local_pytorch_adapter(self) -> None:
        adapter = LocalPyTorchAdapter()
        self.assertEqual(adapter.name, "local_pytorch")
        is_healthy = await adapter.is_healthy()
        self.assertTrue(is_healthy)

        request = InferenceRequest(
            job_id="job-local-01",
            tenant_id="tenant-test",
            model_id="TinyLlama/TinyLlama-1.1B-Chat-v1.0",
            prompt="Hello from local test",
            parameters={"max_new_tokens": 16},
        )
        cost = await adapter.estimate_cost(request)
        self.assertGreater(cost, 0)

        result = await adapter.predict(request)
        self.assertEqual(result.provider_name, "local_pytorch")
        self.assertIn("TinyLlama/TinyLlama-1.1B-Chat-v1.0", result.output_text)
        self.assertGreaterEqual(result.usage.completion_tokens, 1)
        self.assertIn(result.telemetry.device_type, ("cuda", "cpu"))

    async def test_runpod_adapter_mock_and_errors(self) -> None:
        adapter = RunPodAdapter(endpoint_id="test-runpod-endpoint", mock_mode=True)
        self.assertEqual(adapter.name, "runpod")
        self.assertTrue(await adapter.is_healthy())

        request = InferenceRequest(
            job_id="job-runpod-01",
            tenant_id="tenant-test",
            model_id="meta-llama/Llama-3-8B-Instruct",
            prompt="Hello from RunPod",
            parameters={"max_new_tokens": 20},
        )
        cost = await adapter.estimate_cost(request)
        self.assertEqual(cost, (len("Hello from RunPod".split()) + 20) * 12)

        result = await adapter.predict(request)
        self.assertEqual(result.provider_name, "runpod")
        self.assertEqual(result.metadata.get("provider_type"), "external_gpu")
        self.assertEqual(result.telemetry.device_name, "NVIDIA A100-SXM4-80GB")
        self.assertEqual(result.telemetry.vram_total_mb, 81920.0)

        # Permanent error simulation
        perm_req = InferenceRequest(
            job_id="job-err-1",
            tenant_id="tenant-test",
            model_id="meta-llama/Llama-3-8B-Instruct",
            prompt="Error prompt",
            parameters={"_simulate_failure": "permanent"},
        )
        with self.assertRaises(InferenceError) as ctx:
            await adapter.predict(perm_req)
        self.assertFalse(ctx.exception.is_transient)
        self.assertEqual(ctx.exception.code, "RUNPOD_INVALID_PAYLOAD")

        # Transient timeout simulation
        trans_req = InferenceRequest(
            job_id="job-err-2",
            tenant_id="tenant-test",
            model_id="meta-llama/Llama-3-8B-Instruct",
            prompt="Error prompt",
            parameters={"_simulate_failure": "transient"},
        )
        with self.assertRaises(InferenceError) as ctx:
            await adapter.predict(trans_req)
        self.assertTrue(ctx.exception.is_transient)
        self.assertEqual(ctx.exception.code, "RUNPOD_WORKER_TIMEOUT")

        # Capacity exhausted simulation
        cap_req = InferenceRequest(
            job_id="job-err-3",
            tenant_id="tenant-test",
            model_id="meta-llama/Llama-3-8B-Instruct",
            prompt="Error prompt",
            parameters={"_simulate_failure": "capacity_unavailable"},
        )
        with self.assertRaises(InferenceError) as ctx:
            await adapter.predict(cap_req)
        self.assertTrue(ctx.exception.is_transient)
        self.assertEqual(ctx.exception.code, "RUNPOD_CAPACITY_EXHAUSTED")

        # Unhealthy check
        adapter.set_healthy(False)
        self.assertFalse(await adapter.is_healthy())
        with self.assertRaises(InferenceError) as ctx:
            await adapter.predict(request)
        self.assertEqual(ctx.exception.code, "RUNPOD_PROVIDER_UNHEALTHY")

    async def test_bedrock_adapter_mock_and_errors(self) -> None:
        adapter = BedrockAdapter(aws_region="us-east-1", mock_mode=True)
        self.assertEqual(adapter.name, "bedrock")
        self.assertEqual(adapter.aws_region, "us-east-1")
        self.assertTrue(await adapter.is_healthy())

        request = InferenceRequest(
            job_id="job-bedrock-01",
            tenant_id="tenant-test",
            model_id="anthropic.claude-3-sonnet",
            prompt="Hello Bedrock Converse",
            parameters={"max_new_tokens": 16},
        )
        cost = await adapter.estimate_cost(request)
        self.assertGreater(cost, 0)

        result = await adapter.predict(request)
        self.assertEqual(result.provider_name, "bedrock")
        self.assertEqual(result.metadata.get("provider_type"), "managed_cloud_api")
        self.assertEqual(result.telemetry.device_type, "cloud_managed")
        self.assertEqual(result.telemetry.measurement_mode, "provider_reported")

        # Permanent validation error
        with self.assertRaises(InferenceError) as ctx:
            await adapter.predict(
                InferenceRequest(
                    job_id="job-err-b1",
                    tenant_id="t1",
                    model_id="m1",
                    prompt="p",
                    parameters={"_simulate_failure": "permanent"},
                )
            )
        self.assertFalse(ctx.exception.is_transient)
        self.assertEqual(ctx.exception.code, "BEDROCK_VALIDATION_EXCEPTION")

        # Transient throttling error
        with self.assertRaises(InferenceError) as ctx:
            await adapter.predict(
                InferenceRequest(
                    job_id="job-err-b2",
                    tenant_id="t1",
                    model_id="m1",
                    prompt="p",
                    parameters={"_simulate_failure": "throttled"},
                )
            )
        self.assertTrue(ctx.exception.is_transient)
        self.assertEqual(ctx.exception.code, "BEDROCK_THROTTLING_EXCEPTION")

        # Timeout error
        with self.assertRaises(InferenceError) as ctx:
            await adapter.predict(
                InferenceRequest(
                    job_id="job-err-b3",
                    tenant_id="t1",
                    model_id="m1",
                    prompt="p",
                    parameters={"_simulate_failure": "timeout"},
                )
            )
        self.assertTrue(ctx.exception.is_transient)
        self.assertEqual(ctx.exception.code, "BEDROCK_TIMEOUT")

        # Unhealthy check
        adapter.set_healthy(False)
        self.assertFalse(await adapter.is_healthy())
        with self.assertRaises(InferenceError) as ctx:
            await adapter.predict(request)
        self.assertEqual(ctx.exception.code, "BEDROCK_PROVIDER_UNHEALTHY")

    async def test_sagemaker_adapter_mock_and_errors(self) -> None:
        adapter = SageMakerAdapter(endpoint_name="test-sagemaker-ep", mock_mode=True)
        self.assertEqual(adapter.name, "sagemaker")
        self.assertEqual(adapter.endpoint_name, "test-sagemaker-ep")
        self.assertTrue(await adapter.is_healthy())

        request = InferenceRequest(
            job_id="job-sagemaker-01",
            tenant_id="tenant-test",
            model_id="sagemaker-llama3-endpoint",
            prompt="Hello SageMaker Real-Time",
            parameters={"max_new_tokens": 16},
        )
        cost = await adapter.estimate_cost(request)
        self.assertGreater(cost, 0)

        result = await adapter.predict(request)
        self.assertEqual(result.provider_name, "sagemaker")
        self.assertEqual(result.metadata.get("provider_type"), "dedicated_cloud_endpoint")
        self.assertTrue(result.metadata.get("vpc_isolated"))
        self.assertEqual(result.telemetry.device_name, "AWS SageMaker ml.g5.2xlarge (A10G)")

        # Permanent error
        with self.assertRaises(InferenceError) as ctx:
            await adapter.predict(
                InferenceRequest(
                    job_id="job-err-s1",
                    tenant_id="t1",
                    model_id="m1",
                    prompt="p",
                    parameters={"_simulate_failure": "permanent"},
                )
            )
        self.assertFalse(ctx.exception.is_transient)
        self.assertEqual(ctx.exception.code, "SAGEMAKER_MODEL_ERROR")

        # Transient scaling / warming error
        with self.assertRaises(InferenceError) as ctx:
            await adapter.predict(
                InferenceRequest(
                    job_id="job-err-s2",
                    tenant_id="t1",
                    model_id="m1",
                    prompt="p",
                    parameters={"_simulate_failure": "transient"},
                )
            )
        self.assertTrue(ctx.exception.is_transient)
        self.assertEqual(ctx.exception.code, "SAGEMAKER_MODEL_NOT_READY")

        # Timeout error
        with self.assertRaises(InferenceError) as ctx:
            await adapter.predict(
                InferenceRequest(
                    job_id="job-err-s3",
                    tenant_id="t1",
                    model_id="m1",
                    prompt="p",
                    parameters={"_simulate_failure": "timeout"},
                )
            )
        self.assertTrue(ctx.exception.is_transient)
        self.assertEqual(ctx.exception.code, "SAGEMAKER_TIMEOUT")

        # Unhealthy check
        adapter.set_healthy(False)
        self.assertFalse(await adapter.is_healthy())
        with self.assertRaises(InferenceError) as ctx:
            await adapter.predict(request)
        self.assertEqual(ctx.exception.code, "SAGEMAKER_ENDPOINT_UNHEALTHY")

    async def test_provider_registry(self) -> None:
        registry = ProviderRegistry()
        providers = registry.list_providers()
        self.assertIn("local_pytorch", providers)
        self.assertIn("runpod", providers)
        self.assertIn("bedrock", providers)
        self.assertIn("sagemaker", providers)

        self.assertTrue(registry.has("runpod"))
        self.assertFalse(registry.has("unknown_provider"))

        with self.assertRaises(InferenceError) as ctx:
            registry.get("unknown_provider")
        self.assertEqual(ctx.exception.code, "UNKNOWN_INFERENCE_PROVIDER")

        health_map = await registry.check_health()
        self.assertEqual(len(health_map), 4)
        for name, data in health_map.items():
            self.assertTrue(data["healthy"])
            self.assertIn("latency_ms", data)

    async def test_worker_runtime_multi_provider_dispatch(self) -> None:
        runtime = WorkerRuntime()

        # Dispatch with explicit provider in payload
        res_runpod = await runtime.process_job_payload(
            {
                "job_id": "test-runtime-rp",
                "tenant_id": "tenant-test",
                "model_id": "meta-llama/Llama-3-8B-Instruct",
                "prompt": "Test RunPod runtime dispatch",
                "provider": "runpod",
            }
        )
        self.assertTrue(res_runpod["ok"])
        self.assertEqual(res_runpod["provider"], "runpod")

        # Dispatch with explicit provider in parameters
        res_bedrock = await runtime.process_job_payload(
            {
                "job_id": "test-runtime-br",
                "tenant_id": "tenant-test",
                "model_id": "anthropic.claude-3-sonnet",
                "prompt": "Test Bedrock runtime dispatch",
                "parameters": {"provider": "bedrock"},
            }
        )
        self.assertTrue(res_bedrock["ok"])
        self.assertEqual(res_bedrock["provider"], "bedrock")

        # Dispatch with invalid provider
        res_err = await runtime.process_job_payload(
            {
                "job_id": "test-runtime-err",
                "tenant_id": "tenant-test",
                "model_id": "m1",
                "prompt": "p",
                "provider": "non_existent_provider",
            }
        )
        self.assertFalse(res_err["ok"])
        self.assertEqual(res_err["error"]["code"], "UNKNOWN_INFERENCE_PROVIDER")


if __name__ == "__main__":
    unittest.main()
