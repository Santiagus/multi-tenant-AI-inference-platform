"""Locust load test suite for multi-tenant AI inference platform API.

Simulates realistic multi-tenant traffic profiles across interactive chat,
code generation, document summarization, and multimodal media synthesis workloads.
Measures request throughput, queue wait time, E2E service latency (P50/P95/P99),
error rates, and saturation points in accordance with .agents/skills/load-testing/SKILL.md.

Usage:
    locust -f benchmarks/locustfile.py --host=http://localhost:3000 --users=50 --spawn-rate=5 --run-time=60s --headless
    locust -f benchmarks/locustfile.py --host=http://localhost:3000 (for Web UI)
"""

from __future__ import annotations

import json
import random
import time
from typing import Any

try:
    from locust import HttpUser, between, task  # type: ignore[import-not-found]
except ImportError:
    # Fallback dummy class if locust is not installed in the current environment
    class HttpUser:  # type: ignore[no-redef]
        wait_time: Any = None
        client: Any = None

    def task(weight: int = 1) -> Any:  # type: ignore[no-redef]
        def decorator(f: Any) -> Any:
            f.locust_task_weight = weight
            return f

        return decorator

    def between(min_v: float, max_v: float) -> Any:  # type: ignore[no-redef]
        return lambda: random.uniform(min_v, max_v)


TENANTS = ["tenant-alpha", "tenant-beta", "tenant-gamma"]
API_KEYS = {
    "tenant-alpha": "ak_live_alpha_000000000000000000000000",
    "tenant-beta": "ak_live_beta_000000000000000000000000",
    "tenant-gamma": "ak_live_gamma_000000000000000000000000",
}

MODELS = [
    ("TinyLlama/TinyLlama-1.1B-Chat-v1.0", "short"),
    ("TinyLlama/TinyLlama-1.1B-Chat-v1.0", "medium"),
    ("meta-llama/Llama-3-8B-Instruct", "short"),
    ("meta-llama/Llama-3-8B-Instruct", "medium"),
    ("openai/clip-vit-large-patch14", "image"),
]

SAMPLE_PROMPTS = {
    "short": [
        "Explain mutual exclusion vs semaphore in modern Linux kernel synchronization.",
        "What is the time complexity of top-k sampling with KV-cache attention?",
        "Write a Python function to compute moving average over streaming telemetry.",
    ],
    "medium": [
        "Summarize the trade-offs between SQS+KEDA low latency inference and Flyte+Kueue multi-stage DAG pipelines.",
        "Analyze the following architectural specification for multi-tenant GPU memory isolation and quota enforcement.",
    ],
    "image": [
        "Formula 1 race car crossing the finish line in heavy rain at Spa-Francorchamps.",
        "High-resolution architectural diagram of distributed microservices with event streaming.",
    ],
}


class PlatformTenantUser(HttpUser):
    """Simulates a tenant client issuing inference and query workloads."""

    wait_time = between(0.1, 1.0)

    def on_start(self) -> None:
        """Initialize tenant identity and API credentials."""
        self.tenant_id = random.choice(TENANTS)
        self.api_key = API_KEYS[self.tenant_id]
        self.default_headers = {
            "x-tenant-id": self.tenant_id,
            "authorization": f"Bearer {self.api_key}",
            "content-type": "application/json",
        }

    @task(60)
    def submit_interactive_inference_job(self) -> None:
        """60% of traffic: Interactive short/medium text inference jobs."""
        model_id, prompt_tier = random.choice(
            [
                ("TinyLlama/TinyLlama-1.1B-Chat-v1.0", "short"),
                ("TinyLlama/TinyLlama-1.1B-Chat-v1.0", "medium"),
                ("meta-llama/Llama-3-8B-Instruct", "short"),
            ]
        )
        prompt = random.choice(SAMPLE_PROMPTS[prompt_tier])

        payload = {
            "model_id": model_id,
            "routing_preference": "auto",
            "priority": random.choice([1, 5, 10]),
            "max_retries": 3,
            "input": {
                "prompt": prompt,
                "parameters": {
                    "temperature": 0.7,
                    "max_new_tokens": 32 if prompt_tier == "short" else 64,
                },
            },
        }

        start_time = time.time()
        with self.client.post(
            "/v1/jobs",
            data=json.dumps(payload),
            headers=self.default_headers,
            catch_response=True,
            name="POST /v1/jobs (Submit Inference)",
        ) as response:
            if response.status_code in (200, 202):
                data = response.json()
                job_id = data.get("job_id") or data.get("id")
                response.success()
                if job_id and random.random() < 0.3:
                    # Poll job completion 30% of the time to simulate asynchronous polling
                    self._poll_job(job_id)
            elif response.status_code == 429:
                response.success()  # Rate limiting is expected under extreme saturation
            else:
                response.failure(f"Unexpected status: {response.status_code}")

    @task(20)
    def submit_multimodal_vision_job(self) -> None:
        """20% of traffic: Vision/multimodal embedding inference jobs."""
        prompt = random.choice(SAMPLE_PROMPTS["image"])
        payload = {
            "model_id": "openai/clip-vit-large-patch14",
            "routing_preference": "auto",
            "priority": 5,
            "input": {
                "prompt": prompt,
                "parameters": {"modality": "image_embedding"},
            },
        }

        with self.client.post(
            "/v1/jobs",
            data=json.dumps(payload),
            headers=self.default_headers,
            catch_response=True,
            name="POST /v1/jobs (Vision Transformer)",
        ) as response:
            if response.status_code in (200, 202, 429):
                response.success()
            else:
                response.failure(f"Vision job error: {response.status_code}")

    @task(10)
    def query_provider_routing_evaluation(self) -> None:
        """10% of traffic: Pre-flight provider routing explainability evaluation."""
        payload = {
            "model_id": "meta-llama/Llama-3-8B-Instruct",
            "max_tokens": 128,
            "max_latency_ms": 250,
            "require_vpc": False,
        }
        with self.client.post(
            "/v1/routing/evaluate",
            data=json.dumps(payload),
            headers=self.default_headers,
            catch_response=True,
            name="POST /v1/routing/evaluate",
        ) as response:
            if response.status_code == 200:
                response.success()
            else:
                response.failure(f"Routing evaluation failed: {response.status_code}")

    @task(5)
    def inspect_tenant_jobs_and_analytics(self) -> None:
        """5% of traffic: Tenant analytics & job list inspection."""
        with self.client.get(
            "/v1/jobs?limit=10",
            headers=self.default_headers,
            catch_response=True,
            name="GET /v1/jobs",
        ) as response:
            if response.status_code == 200:
                response.success()
            else:
                response.failure(f"Job query failed: {response.status_code}")

    @task(5)
    def health_check(self) -> None:
        """5% of traffic: Standard liveness & readiness probes."""
        self.client.get("/readyz", headers={"x-tenant-id": self.tenant_id}, name="GET /readyz")

    def _poll_job(self, job_id: str) -> None:
        """Poll job until completion or timeout (simulates client backoff)."""
        for _ in range(5):
            time.sleep(0.1)
            res = self.client.get(
                f"/v1/jobs/{job_id}",
                headers=self.default_headers,
                name="GET /v1/jobs/:id (Poll)",
            )
            if res.status_code == 200:
                body = res.json()
                if body.get("status") in ("SUCCEEDED", "FAILED", "CANCELLED"):
                    break
