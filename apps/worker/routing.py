"""Deterministic provider routing policy engine and explainability formatter in Python."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
import enum
from typing import Any, Mapping


class RoutingPreference(str, enum.Enum):
    LOCAL_FIRST = "local_first"
    COST_OPTIMIZED = "cost_optimized"
    LATENCY_OPTIMIZED = "latency_optimized"
    TENANT_PINNED = "tenant_pinned"


@dataclass(frozen=True)
class WorkloadRequirements:
    model_id: str
    prompt_tokens: int = 16
    max_new_tokens: int = 32
    estimated_vram_mb: float = 8192.0
    modality: str = "text_to_text"
    requires_vpc: bool = False
    is_proprietary: bool = False


@dataclass(frozen=True)
class CapacityConstraints:
    local_vram_total_mb: float = 16384.0
    local_vram_allocated_mb: float = 4096.0
    local_queue_depth: int = 0
    local_queue_threshold: int = 10
    worker_concurrency: int = 4
    estimated_job_compute_ms: float = 150.0


@dataclass(frozen=True)
class LatencySlo:
    latency_slo_ms: float = 1500.0


@dataclass(frozen=True)
class ProviderProfile:
    name: str
    healthy: bool = True
    latency_p95_ms: float = 200.0
    cost_microcents_per_token: int = 12
    is_external_gpu: bool = False
    is_cloud_api: bool = False
    supports_vpc: bool = False


@dataclass(frozen=True)
class TenantRoutingPolicy:
    tenant_id: str = "tenant-default"
    tenant_tier: str = "standard"  # free, standard, pro, enterprise
    routing_preference: RoutingPreference = RoutingPreference.LOCAL_FIRST
    pinned_provider: str | None = None
    allowed_providers: tuple[str, ...] = ("local_pytorch", "runpod", "bedrock", "sagemaker")
    disallowed_providers: tuple[str, ...] = ()
    max_cost_microcents: int = 500_000
    billed_rate_microcents_per_token: int = 40


@dataclass(frozen=True)
class EconomicsConstraints:
    target_gross_margin: float = 0.40  # 40% margin
    allow_margin_degradation_for_slo: bool = False


@dataclass(frozen=True)
class RoutingStageTrace:
    stage: str
    passed: list[str]
    rejected: list[dict[str, Any]]


@dataclass(frozen=True)
class RoutingDecision:
    selected_provider: str
    routing_preference: RoutingPreference
    decision_code: str
    explanation: str
    stages: list[RoutingStageTrace]
    candidate_margins: dict[str, float]
    candidate_costs: dict[str, int]
    projected_revenue_microcents: int
    slo_risk_detected: bool
    local_queue_saturated: bool

    def to_dict(self) -> dict[str, Any]:
        return {
            "selected_provider": self.selected_provider,
            "routing_preference": self.routing_preference.value,
            "decision_code": self.decision_code,
            "explanation": self.explanation,
            "stages": [asdict(s) for s in self.stages],
            "candidate_margins": self.candidate_margins,
            "candidate_costs": self.candidate_costs,
            "projected_revenue_microcents": self.projected_revenue_microcents,
            "slo_risk_detected": self.slo_risk_detected,
            "local_queue_saturated": self.local_queue_saturated,
        }


DEFAULT_PROVIDER_PROFILES: dict[str, ProviderProfile] = {
    "local_pytorch": ProviderProfile(
        name="local_pytorch",
        healthy=True,
        latency_p95_ms=120.0,
        cost_microcents_per_token=5,
        is_external_gpu=False,
        is_cloud_api=False,
        supports_vpc=True,
    ),
    "runpod": ProviderProfile(
        name="runpod",
        healthy=True,
        latency_p95_ms=180.0,
        cost_microcents_per_token=12,
        is_external_gpu=True,
        is_cloud_api=False,
        supports_vpc=False,
    ),
    "bedrock": ProviderProfile(
        name="bedrock",
        healthy=True,
        latency_p95_ms=350.0,
        cost_microcents_per_token=25,
        is_external_gpu=False,
        is_cloud_api=True,
        supports_vpc=False,
    ),
    "sagemaker": ProviderProfile(
        name="sagemaker",
        healthy=True,
        latency_p95_ms=220.0,
        cost_microcents_per_token=20,
        is_external_gpu=True,
        is_cloud_api=False,
        supports_vpc=True,
    ),
}


class DeterministicProviderRouter:
    """Evaluates measurable constraints to route workloads between local and external providers."""

    def __init__(
        self,
        provider_profiles: Mapping[str, ProviderProfile] | None = None,
    ) -> None:
        self._profiles = dict(provider_profiles or DEFAULT_PROVIDER_PROFILES)

    def evaluate(
        self,
        workload: WorkloadRequirements,
        capacity: CapacityConstraints = CapacityConstraints(),
        slo: LatencySlo = LatencySlo(),
        tenant_policy: TenantRoutingPolicy = TenantRoutingPolicy(),
        economics: EconomicsConstraints = EconomicsConstraints(),
        provider_overrides: Mapping[str, ProviderProfile] | None = None,
    ) -> RoutingDecision:
        profiles = dict(self._profiles)
        if provider_overrides:
            profiles.update(provider_overrides)

        stages: list[RoutingStageTrace] = []
        candidates = list(profiles.keys())

        # Stage 1: Tenant Policy & Workload Model Constraints
        tenant_passed: list[str] = []
        tenant_rejected: list[dict[str, Any]] = []

        is_claude = "claude" in workload.model_id.lower() or workload.model_id.startswith("anthropic.")
        effective_proprietary = workload.is_proprietary or is_claude

        for name in candidates:
            if name in tenant_policy.disallowed_providers:
                tenant_rejected.append({"provider": name, "reason": "tenant_disallowed_provider"})
                continue
            if name not in tenant_policy.allowed_providers:
                tenant_rejected.append({"provider": name, "reason": "tenant_unauthorized_provider"})
                continue
            if tenant_policy.pinned_provider and name != tenant_policy.pinned_provider:
                tenant_rejected.append(
                    {"provider": name, "reason": f"pinned_to_{tenant_policy.pinned_provider}"}
                )
                continue
            if effective_proprietary and name != "bedrock":
                tenant_rejected.append({"provider": name, "reason": "proprietary_model_requires_bedrock"})
                continue
            if workload.requires_vpc and not profiles[name].supports_vpc:
                tenant_rejected.append({"provider": name, "reason": "vpc_isolation_required"})
                continue
            tenant_passed.append(name)

        stages.append(RoutingStageTrace("tenant_policy", tenant_passed, tenant_rejected))

        # Stage 2: Hardware Capacity & Local VRAM / Queue Evaluation
        cap_passed: list[str] = []
        cap_rejected: list[dict[str, Any]] = []

        local_headroom_mb = max(0.0, capacity.local_vram_total_mb - capacity.local_vram_allocated_mb)
        vram_exceeded = (
            workload.estimated_vram_mb > local_headroom_mb
            or workload.estimated_vram_mb > capacity.local_vram_total_mb
        )

        effective_concurrency = max(1, capacity.worker_concurrency)
        est_queue_wait_ms = (capacity.local_queue_depth / effective_concurrency) * capacity.estimated_job_compute_ms
        total_est_local_ms = est_queue_wait_ms + capacity.estimated_job_compute_ms

        local_queue_saturated = capacity.local_queue_depth >= capacity.local_queue_threshold
        slo_risk_detected = total_est_local_ms > slo.latency_slo_ms or local_queue_saturated

        for name in tenant_passed:
            if name == "local_pytorch":
                if vram_exceeded:
                    cap_rejected.append(
                        {
                            "provider": name,
                            "reason": "local_vram_exceeded",
                            "details": f"req={workload.estimated_vram_mb}MB > headroom={local_headroom_mb}MB",
                        }
                    )
                    continue
                if slo_risk_detected and len(tenant_passed) > 1:
                    # Note: marked for spillover, but still viable if external fails
                    cap_rejected.append(
                        {
                            "provider": name,
                            "reason": "local_queue_saturated_and_slo_risk",
                            "details": (
                                f"queue_depth={capacity.local_queue_depth} >= thresh={capacity.local_queue_threshold}, "
                                f"est_latency={round(total_est_local_ms)}ms > slo={round(slo.latency_slo_ms)}ms"
                            ),
                        }
                    )
                    continue
            cap_passed.append(name)

        stages.append(RoutingStageTrace("hardware_capacity", cap_passed, cap_rejected))

        # Stage 3: Provider Availability & Health Check
        health_passed: list[str] = []
        health_rejected: list[dict[str, Any]] = []

        pool_to_check = cap_passed if cap_passed else tenant_passed
        for name in pool_to_check:
            prof = profiles.get(name)
            if not prof or not prof.healthy:
                health_rejected.append({"provider": name, "reason": "provider_unhealthy"})
            else:
                health_passed.append(name)

        stages.append(RoutingStageTrace("provider_health", health_passed, health_rejected))

        # Stage 4: Economics, Costs & Target Gross Margin
        total_tokens = max(1, workload.prompt_tokens + workload.max_new_tokens)
        projected_revenue = total_tokens * tenant_policy.billed_rate_microcents_per_token

        candidate_costs: dict[str, int] = {}
        candidate_margins: dict[str, float] = {}
        econ_passed: list[str] = []
        econ_rejected: list[dict[str, Any]] = []

        for name in health_passed:
            prof = profiles[name]
            cost = total_tokens * prof.cost_microcents_per_token
            candidate_costs[name] = cost
            margin = (
                round((projected_revenue - cost) / max(projected_revenue, 1), 4)
                if projected_revenue > 0
                else 0.0
            )
            candidate_margins[name] = margin

            if cost > tenant_policy.max_cost_microcents:
                econ_rejected.append(
                    {
                        "provider": name,
                        "reason": "exceeds_tenant_max_cost",
                        "cost": cost,
                        "limit": tenant_policy.max_cost_microcents,
                    }
                )
                continue

            margin_ok = margin >= economics.target_gross_margin
            if not margin_ok:
                if economics.allow_margin_degradation_for_slo and slo_risk_detected and margin > 0.0:
                    econ_passed.append(name)
                else:
                    econ_rejected.append(
                        {
                            "provider": name,
                            "reason": "target_gross_margin_unacceptable",
                            "margin": margin,
                            "target": economics.target_gross_margin,
                        }
                    )
            else:
                econ_passed.append(name)

        stages.append(RoutingStageTrace("economics_and_margin", econ_passed, econ_rejected))

        # Stage 5: Final Deterministic Selection
        preference = tenant_policy.routing_preference
        selected: str
        decision_code: str
        explanation: str

        if preference == RoutingPreference.TENANT_PINNED and tenant_policy.pinned_provider:
            selected = tenant_policy.pinned_provider
            decision_code = "TENANT_PINNED_PROVIDER"
            explanation = f"tenant pinned to '{selected}' -> dispatched directly"

        elif effective_proprietary:
            selected = "bedrock"
            margin = candidate_margins.get("bedrock", 0.0)
            decision_code = "PROPRIETARY_MODEL_BEDROCK"
            explanation = (
                f"model proprietary ({workload.model_id}) + provider available (bedrock=healthy) + "
                f"margin acceptable (margin={round(margin * 100, 1)}%) -> external managed provider"
            )

        elif workload.requires_vpc:
            # VPC: local or sagemaker
            if not vram_exceeded and not slo_risk_detected and "local_pytorch" in econ_passed:
                selected = "local_pytorch"
                decision_code = "VPC_LOCAL_PREFERRED"
                explanation = "VPC workload fits local GPU capacity -> routed to local worker"
            elif "sagemaker" in econ_passed:
                selected = "sagemaker"
                decision_code = "VPC_SAGEMAKER_DISPATCH"
                margin = candidate_margins.get("sagemaker", 0.0)
                explanation = (
                    f"VPC isolation required + external endpoint available (sagemaker) + "
                    f"margin acceptable (margin={round(margin * 100, 1)}%) -> external VPC provider"
                )
            else:
                selected = "local_pytorch"
                decision_code = "VPC_FALLBACK_LOCAL"
                explanation = "VPC workload fallback to local worker (external VPC endpoint unavailable/unprofitable)"

        elif preference == RoutingPreference.LOCAL_FIRST:
            if not vram_exceeded and not slo_risk_detected and "local_pytorch" in econ_passed:
                selected = "local_pytorch"
                decision_code = "LOCAL_CAPACITY_OPTIMAL"
                margin = candidate_margins.get("local_pytorch", 0.0)
                explanation = (
                    f"local VRAM available (headroom={round(local_headroom_mb)}MB) + queue within capacity "
                    f"(depth={capacity.local_queue_depth} < threshold={capacity.local_queue_threshold}) + "
                    f"margin acceptable (margin={round(margin * 100, 1)}%) -> local GPU worker"
                )
            else:
                # Local is saturated, VRAM exceeded, or has SLO risk. Look for external GPU / cloud provider.
                external_gpu_candidates = [p for p in econ_passed if p in ("runpod", "sagemaker", "bedrock")]
                if external_gpu_candidates:
                    # Choose RunPod for general GPU burst, SageMaker if VPC, Bedrock if text API
                    if "runpod" in external_gpu_candidates:
                        selected = "runpod"
                    else:
                        selected = external_gpu_candidates[0]

                    margin = candidate_margins.get(selected, 0.0)
                    decision_code = "SLO_RISK_SPILLOVER_EXTERNAL_GPU"
                    reason_clause = (
                        "local VRAM exceeded"
                        if vram_exceeded
                        else "local queue high"
                    )
                    explanation = (
                        f"{reason_clause} + SLO risk + provider available + margin acceptable "
                        f"-> external GPU provider ({selected})"
                    )
                else:
                    # Spillover failed economics or availability; fallback to local
                    selected = "local_pytorch"
                    decision_code = "LOCAL_QUEUE_RETAIN_MARGIN_PROTECTION"
                    explanation = (
                        f"local queue high + SLO risk, but external providers unavailable or fail target gross margin "
                        f"(target={round(economics.target_gross_margin * 100, 1)}%) -> retain on local queue"
                    )

        elif preference == RoutingPreference.COST_OPTIMIZED:
            pool = econ_passed if econ_passed else health_passed
            if pool:
                selected = min(pool, key=lambda p: candidate_costs.get(p, 999_999))
                decision_code = "COST_OPTIMIZED_SELECTION"
                explanation = (
                    f"cost optimized preference -> selected lowest cost provider '{selected}' "
                    f"({candidate_costs.get(selected, 0)} microcents)"
                )
            else:
                selected = "local_pytorch"
                decision_code = "FALLBACK_LOCAL"
                explanation = "fallback to local worker"

        elif preference == RoutingPreference.LATENCY_OPTIMIZED:
            pool = econ_passed if econ_passed else health_passed
            if pool:
                selected = min(pool, key=lambda p: profiles.get(p, DEFAULT_PROVIDER_PROFILES["local_pytorch"]).latency_p95_ms)
                decision_code = "LATENCY_OPTIMIZED_SELECTION"
                explanation = (
                    f"latency optimized preference -> selected lowest P95 latency provider '{selected}' "
                    f"({profiles[selected].latency_p95_ms}ms)"
                )
            else:
                selected = "local_pytorch"
                decision_code = "FALLBACK_LOCAL"
                explanation = "fallback to local worker"

        else:
            selected = "local_pytorch"
            decision_code = "DEFAULT_LOCAL"
            explanation = "routed to default local worker"

        return RoutingDecision(
            selected_provider=selected,
            routing_preference=preference,
            decision_code=decision_code,
            explanation=explanation,
            stages=stages,
            candidate_margins=candidate_margins,
            candidate_costs=candidate_costs,
            projected_revenue_microcents=projected_revenue,
            slo_risk_detected=slo_risk_detected,
            local_queue_saturated=local_queue_saturated,
        )

