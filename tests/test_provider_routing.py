"""Unit tests for deterministic provider routing policy engine in Python."""

from __future__ import annotations

import unittest

from apps.worker.routing import (
    CapacityConstraints,
    DeterministicProviderRouter,
    EconomicsConstraints,
    LatencySlo,
    ProviderProfile,
    RoutingPreference,
    TenantRoutingPolicy,
    WorkloadRequirements,
)


class TestDeterministicProviderRouter(unittest.TestCase):
    """Tests measurable constraints and explainability traces of routing decisions."""

    def setUp(self) -> None:
        self.router = DeterministicProviderRouter()

    def test_local_capacity_optimal_routing(self) -> None:
        """When local VRAM fits and queue is below threshold, routes to local worker."""
        workload = WorkloadRequirements(
            model_id="meta-llama/Llama-3-8B-Instruct",
            prompt_tokens=64,
            max_new_tokens=32,
            estimated_vram_mb=4096.0,
        )
        capacity = CapacityConstraints(
            local_vram_total_mb=16384.0,
            local_vram_allocated_mb=4096.0,
            local_queue_depth=2,
            local_queue_threshold=10,
        )
        decision = self.router.evaluate(workload, capacity)
        self.assertEqual(decision.selected_provider, "local_pytorch")
        self.assertEqual(decision.decisionCode if hasattr(decision, "decisionCode") else decision.decision_code, "LOCAL_CAPACITY_OPTIMAL")
        self.assertIn("local VRAM available", decision.explanation)
        self.assertFalse(decision.slo_risk_detected)
        self.assertFalse(decision.local_queue_saturated)

    def test_slo_risk_queue_spillover_to_external_gpu(self) -> None:
        """When queue depth exceeds threshold, spills over to RunPod with explanation."""
        workload = WorkloadRequirements(
            model_id="meta-llama/Llama-3-8B-Instruct",
            prompt_tokens=128,
            max_new_tokens=64,
            estimated_vram_mb=4096.0,
        )
        capacity = CapacityConstraints(
            local_queue_depth=14,
            local_queue_threshold=10,
            worker_concurrency=4,
            estimated_job_compute_ms=150.0,
        )
        slo = LatencySlo(latency_slo_ms=1500.0)
        tenant_policy = TenantRoutingPolicy(
            routing_preference=RoutingPreference.LOCAL_FIRST,
            billed_rate_microcents_per_token=40,
        )
        economics = EconomicsConstraints(target_gross_margin=0.40)

        decision = self.router.evaluate(
            workload, capacity, slo, tenant_policy, economics
        )

        self.assertEqual(decision.selected_provider, "runpod")
        self.assertEqual(decision.decision_code, "SLO_RISK_SPILLOVER_EXTERNAL_GPU")
        self.assertTrue(decision.local_queue_saturated)
        self.assertTrue(decision.slo_risk_detected)
        self.assertIn("local queue high + SLO risk + provider available + margin acceptable", decision.explanation)

    def test_local_vram_overflow_spillover(self) -> None:
        """When model requires more VRAM than local headroom, spills over to external GPU."""
        workload = WorkloadRequirements(
            model_id="large-model-30b",
            prompt_tokens=256,
            max_new_tokens=64,
            estimated_vram_mb=28000.0,  # Exceeds 16GB local VRAM
        )
        capacity = CapacityConstraints(
            local_vram_total_mb=16384.0,
            local_vram_allocated_mb=2048.0,
            local_queue_depth=1,
            local_queue_threshold=10,
        )
        decision = self.router.evaluate(workload, capacity)
        self.assertEqual(decision.selected_provider, "runpod")
        self.assertEqual(decision.decision_code, "SLO_RISK_SPILLOVER_EXTERNAL_GPU")
        self.assertIn("local VRAM exceeded", decision.explanation)

    def test_proprietary_model_routes_to_bedrock(self) -> None:
        """Proprietary frontier models (Claude) are routed directly to AWS Bedrock."""
        workload = WorkloadRequirements(
            model_id="anthropic.claude-3-sonnet",
            is_proprietary=True,
        )
        decision = self.router.evaluate(workload)
        self.assertEqual(decision.selected_provider, "bedrock")
        self.assertEqual(decision.decision_code, "PROPRIETARY_MODEL_BEDROCK")
        self.assertIn("model proprietary", decision.explanation)

    def test_vpc_isolation_routes_to_sagemaker_when_local_saturated(self) -> None:
        """Enterprise VPC workloads route to SageMaker if local GPU is saturated."""
        workload = WorkloadRequirements(
            model_id="sagemaker-llama3-endpoint",
            requires_vpc=True,
        )
        capacity = CapacityConstraints(
            local_queue_depth=15,
            local_queue_threshold=10,
        )
        decision = self.router.evaluate(workload, capacity)
        self.assertEqual(decision.selected_provider, "sagemaker")
        self.assertEqual(decision.decision_code, "VPC_SAGEMAKER_DISPATCH")
        self.assertIn("VPC isolation required", decision.explanation)

    def test_margin_protection_retains_on_local_queue(self) -> None:
        """If external cloud providers violate target gross margin, request stays local."""
        workload = WorkloadRequirements(
            model_id="meta-llama/Llama-3-8B-Instruct",
            prompt_tokens=100,
            max_new_tokens=50,
        )
        capacity = CapacityConstraints(
            local_queue_depth=12,
            local_queue_threshold=10,
        )
        # Low billed rate so cloud providers cannot achieve 60% gross margin
        tenant_policy = TenantRoutingPolicy(
            billed_rate_microcents_per_token=15,
        )
        economics = EconomicsConstraints(
            target_gross_margin=0.60,
            allow_margin_degradation_for_slo=False,
        )
        decision = self.router.evaluate(
            workload, capacity, tenant_policy=tenant_policy, economics=economics
        )
        self.assertEqual(decision.selected_provider, "local_pytorch")
        self.assertEqual(decision.decision_code, "LOCAL_QUEUE_RETAIN_MARGIN_PROTECTION")
        self.assertIn("retain on local queue", decision.explanation)

    def test_tenant_pinned_provider(self) -> None:
        """Pinned provider setting bypasses dynamic selection."""
        workload = WorkloadRequirements(model_id="m1")
        tenant_policy = TenantRoutingPolicy(
            routing_preference=RoutingPreference.TENANT_PINNED,
            pinned_provider="sagemaker",
        )
        decision = self.router.evaluate(workload, tenant_policy=tenant_policy)
        self.assertEqual(decision.selected_provider, "sagemaker")
        self.assertEqual(decision.decision_code, "TENANT_PINNED_PROVIDER")

    def test_cost_optimized_routing(self) -> None:
        """Cost optimized preference selects lowest cost healthy provider."""
        workload = WorkloadRequirements(model_id="m1")
        tenant_policy = TenantRoutingPolicy(
            routing_preference=RoutingPreference.COST_OPTIMIZED,
        )
        decision = self.router.evaluate(workload, tenant_policy=tenant_policy)
        self.assertEqual(decision.selected_provider, "local_pytorch")
        self.assertEqual(decision.decision_code, "COST_OPTIMIZED_SELECTION")

    def test_latency_optimized_routing(self) -> None:
        """Latency optimized preference selects lowest P95 latency healthy provider."""
        workload = WorkloadRequirements(model_id="m1")
        tenant_policy = TenantRoutingPolicy(
            routing_preference=RoutingPreference.LATENCY_OPTIMIZED,
        )
        decision = self.router.evaluate(workload, tenant_policy=tenant_policy)
        self.assertEqual(decision.selected_provider, "local_pytorch")
        self.assertEqual(decision.decision_code, "LATENCY_OPTIMIZED_SELECTION")

    def test_unhealthy_provider_filtered(self) -> None:
        """Unhealthy provider override is rejected at stage 3."""
        workload = WorkloadRequirements(model_id="m1")
        overrides = {
            "local_pytorch": ProviderProfile(
                name="local_pytorch", healthy=False, latency_p95_ms=100.0, cost_microcents_per_token=5
            ),
        }
        decision = self.router.evaluate(workload, provider_overrides=overrides)
        # Should not select unhealthy local_pytorch
        self.assertNotEqual(decision.selected_provider, "local_pytorch")


if __name__ == "__main__":
    unittest.main()

