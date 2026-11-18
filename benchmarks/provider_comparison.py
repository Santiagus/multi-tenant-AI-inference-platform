"""Cross-provider same-job comparison: cold/warm start, load, latency, cost, picks.

Evidence labels follow AGENTS.md: measured | estimated | simulated | provider-reported.
Scoring mirrors apps/api/src/domain/finops-pricing.ts (cheapest / fastest / balanced).
"""

from __future__ import annotations

import math
import statistics
from dataclasses import asdict, dataclass, field
from typing import Any, Literal

EvidenceLabel = Literal["measured", "estimated", "simulated", "provider-reported"]
WarmState = Literal["cold", "warm"]

# Canonical identical workload used for every provider probe.
CANONICAL_PROMPT = (
    "Explain Raft consensus leader election for multi-tenant GPU inference workers "
    "and how lease-based visibility timeouts interact with SQS backoff under load."
)
CANONICAL_MAX_NEW_TOKENS = 64

# Provider matrix aligned with dashboard ALL_PLATFORM_PROVIDERS + local CPU path.
# `has_live_adapter` = registered in apps/worker/providers/registry.py.
PROVIDER_MATRIX: list[dict[str, Any]] = [
    {
        "id": "local_pytorch",
        "display_name": "Local PyTorch (GPU)",
        "routing_preference": "local/gpu",
        "parameters": {"provider": "local_pytorch", "device": "cuda"},
        "hardware": "RTX 5070 Ti",
        "pricing_model": "on_demand",
        "has_live_adapter": True,
        # Characteristic profiles used only in --mode simulate (labeled simulated).
        "sim_cold_ms": 420.0,
        "sim_warm_ms": 95.0,
        "sim_tok_s": 105.0,
        "sim_hourly_usd": 0.0,
        "sim_cold_start_ms": 320.0,
    },
    {
        "id": "local_cpu",
        "display_name": "Local PyTorch (CPU)",
        "routing_preference": "local/cpu",
        "parameters": {"provider": "local_pytorch", "device": "cpu"},
        "hardware": "CPU Fallback",
        "pricing_model": "on_demand",
        "has_live_adapter": True,
        "sim_cold_ms": 980.0,
        "sim_warm_ms": 610.0,
        "sim_tok_s": 18.0,
        "sim_hourly_usd": 0.0,
        "sim_cold_start_ms": 80.0,
    },
    {
        "id": "runpod",
        "display_name": "RunPod",
        "routing_preference": "cloud/runpod",
        "parameters": {"provider": "runpod"},
        "hardware": "RTX 4090 / H100",
        "pricing_model": "spot",
        "has_live_adapter": True,
        "sim_cold_ms": 2400.0,
        "sim_warm_ms": 380.0,
        "sim_tok_s": 110.0,
        "sim_hourly_usd": 0.34,
        "sim_cold_start_ms": 1800.0,
    },
    {
        "id": "bedrock",
        "display_name": "AWS Bedrock",
        "routing_preference": "cloud/bedrock",
        "parameters": {"provider": "bedrock"},
        "hardware": "AWS Bedrock",
        "pricing_model": "token_factory",
        "has_live_adapter": True,
        "sim_cold_ms": 520.0,
        "sim_warm_ms": 410.0,
        "sim_tok_s": 85.0,
        "sim_hourly_usd": None,
        "sim_input_per_1m": 0.30,
        "sim_output_per_1m": 1.50,
        "sim_cold_start_ms": 40.0,
    },
    {
        "id": "sagemaker",
        "display_name": "AWS SageMaker",
        "routing_preference": "cloud/sagemaker",
        "parameters": {"provider": "sagemaker"},
        "hardware": "Inferentia2 / G5",
        "pricing_model": "on_demand",
        "has_live_adapter": True,
        "sim_cold_ms": 3100.0,
        "sim_warm_ms": 520.0,
        "sim_tok_s": 70.0,
        "sim_hourly_usd": 1.21,
        "sim_cold_start_ms": 2500.0,
    },
    {
        "id": "vast_ai",
        "display_name": "Vast.ai",
        "routing_preference": "cloud",
        "parameters": {"provider": "vast_ai"},
        "hardware": "RTX 5090 Blackwell",
        "pricing_model": "spot",
        "has_live_adapter": False,
        "sim_cold_ms": 2800.0,
        "sim_warm_ms": 320.0,
        "sim_tok_s": 135.0,
        "sim_hourly_usd": 0.24,
        "sim_cold_start_ms": 2200.0,
    },
    {
        "id": "baseten",
        "display_name": "Baseten",
        "routing_preference": "cloud",
        "parameters": {"provider": "baseten"},
        "hardware": "L4 Tensor Core",
        "pricing_model": "serverless",
        "has_live_adapter": False,
        "sim_cold_ms": 1900.0,
        "sim_warm_ms": 740.0,
        "sim_tok_s": 32.0,
        "sim_hourly_usd": 0.85,
        "sim_cold_start_ms": 1100.0,
    },
    {
        "id": "nebius",
        "display_name": "Nebius",
        "routing_preference": "cloud",
        "parameters": {"provider": "nebius"},
        "hardware": "H200 SXM",
        "pricing_model": "on_demand",
        "has_live_adapter": False,
        "sim_cold_ms": 1600.0,
        "sim_warm_ms": 280.0,
        "sim_tok_s": 160.0,
        "sim_hourly_usd": 2.10,
        "sim_cold_start_ms": 900.0,
    },
    {
        "id": "jarvislabs",
        "display_name": "JarvisLabs Token Factory",
        "routing_preference": "cloud",
        "parameters": {"provider": "jarvislabs"},
        "hardware": "Token Factory",
        "pricing_model": "token_factory",
        "has_live_adapter": False,
        "sim_cold_ms": 480.0,
        "sim_warm_ms": 390.0,
        "sim_tok_s": 85.0,
        "sim_hourly_usd": None,
        "sim_input_per_1m": 0.07,
        "sim_output_per_1m": 0.49,
        "sim_cold_start_ms": 20.0,
    },
    {
        "id": "fal",
        "display_name": "fal.ai",
        "routing_preference": "cloud",
        "parameters": {"provider": "fal"},
        "hardware": "Tensor Core Pipeline",
        "pricing_model": "pay_per_call",
        "has_live_adapter": False,
        "sim_cold_ms": 700.0,
        "sim_warm_ms": 620.0,
        "sim_tok_s": 0.0,
        "sim_hourly_usd": None,
        "sim_flat_cost_usd": 0.003,
        "sim_cold_start_ms": 50.0,
    },
    {
        "id": "coreweave",
        "display_name": "CoreWeave",
        "routing_preference": "cloud",
        "parameters": {"provider": "coreweave"},
        "hardware": "H100 SXM5",
        "pricing_model": "on_demand",
        "has_live_adapter": False,
        "sim_cold_ms": 1700.0,
        "sim_warm_ms": 260.0,
        "sim_tok_s": 180.0,
        "sim_hourly_usd": 1.99,
        "sim_cold_start_ms": 1000.0,
    },
    {
        "id": "hivenet",
        "display_name": "Hivenet",
        "routing_preference": "cloud",
        "parameters": {"provider": "hivenet"},
        "hardware": "A100 80GB",
        "pricing_model": "spot",
        "has_live_adapter": False,
        "sim_cold_ms": 2200.0,
        "sim_warm_ms": 410.0,
        "sim_tok_s": 95.0,
        "sim_hourly_usd": 0.55,
        "sim_cold_start_ms": 1500.0,
    },
]


@dataclass
class ProbeSample:
    provider: str
    warm_state: WarmState
    concurrency: int
    e2e_latency_ms: float
    queue_wait_ms: float
    inference_ms: float
    cold_start_ms: float
    ttft_ms: float | None
    tokens_in: int
    tokens_out: int
    tokens_per_sec: float
    cost_usd: float
    cost_microcents: int
    hardware: str
    job_id: str | None
    evidence: EvidenceLabel
    ok: bool
    error: str | None = None
    notes: str = ""


@dataclass
class ProviderRollup:
    provider: str
    display_name: str
    hardware: str
    pricing_model: str
    has_live_adapter: bool
    cold_e2e_p50_ms: float
    warm_e2e_p50_ms: float
    cold_start_penalty_ms: float
    load_p95_ms: float | None
    tokens_per_sec_warm: float
    cost_usd_per_job: float
    cost_per_1m_tokens_usd: float
    sample_count: int
    evidence: EvidenceLabel
    samples: list[ProbeSample] = field(default_factory=list)

    @property
    def forecasted_execution_ms(self) -> float:
        return self.warm_e2e_p50_ms

    @property
    def forecasted_cost_usd(self) -> float:
        return self.cost_usd_per_job


def estimate_prompt_tokens(prompt: str) -> int:
    return max(1, len(prompt.split()))


def cost_from_profile(
    profile: dict[str, Any],
    *,
    inference_ms: float,
    tokens_in: int,
    tokens_out: int,
) -> tuple[float, int]:
    """Return (cost_usd, cost_microcents) from profile economics."""
    flat = profile.get("sim_flat_cost_usd")
    if flat is not None:
        cost = float(flat)
        return cost, max(1, int(round(cost * 100_000_000)))

    in_rate = profile.get("sim_input_per_1m")
    out_rate = profile.get("sim_output_per_1m")
    if in_rate is not None and out_rate is not None:
        cost = (tokens_in * float(in_rate) + tokens_out * float(out_rate)) / 1_000_000.0
        return cost, max(1, int(round(cost * 100_000_000)))

    hourly = profile.get("sim_hourly_usd")
    if hourly is None:
        return 0.0, 0
    cost = (float(hourly) / 3600.0) * (max(inference_ms, 1.0) / 1000.0)
    return cost, max(0, int(round(cost * 100_000_000)))


def simulate_provider_samples(
    profile: dict[str, Any],
    *,
    prompt: str = CANONICAL_PROMPT,
    max_new_tokens: int = CANONICAL_MAX_NEW_TOKENS,
    load_concurrency: int = 4,
) -> list[ProbeSample]:
    """Deterministic simulated cold/warm/load samples for CI and offline planning."""
    tokens_in = estimate_prompt_tokens(prompt)
    tokens_out = max_new_tokens
    tok_s = float(profile.get("sim_tok_s") or 1.0)
    cold_ms = float(profile["sim_cold_ms"])
    warm_ms = float(profile["sim_warm_ms"])
    cold_start = float(profile.get("sim_cold_start_ms") or max(0.0, cold_ms - warm_ms))

    samples: list[ProbeSample] = []

    for warm_state, base_ms in (("cold", cold_ms), ("warm", warm_ms)):
        cost_usd, cost_uc = cost_from_profile(profile, inference_ms=base_ms, tokens_in=tokens_in, tokens_out=tokens_out)
        queue_wait = 25.0 if warm_state == "cold" else 8.0
        samples.append(
            ProbeSample(
                provider=profile["id"],
                warm_state=warm_state,  # type: ignore[arg-type]
                concurrency=1,
                e2e_latency_ms=round(base_ms + queue_wait, 3),
                queue_wait_ms=queue_wait,
                inference_ms=base_ms,
                cold_start_ms=cold_start if warm_state == "cold" else 0.0,
                ttft_ms=round(base_ms * 0.22, 3),
                tokens_in=tokens_in,
                tokens_out=tokens_out,
                tokens_per_sec=round(tok_s if warm_state == "warm" else tok_s * 0.55, 3),
                cost_usd=round(cost_usd, 8),
                cost_microcents=cost_uc,
                hardware=str(profile["hardware"]),
                job_id=None,
                evidence="simulated",
                ok=True,
                notes="Simulated characteristic profile for offline FinOps planning",
            )
        )

    # Load sample: concurrency amplifies queue wait (Little's Law style stress).
    load_queue = 8.0 * load_concurrency
    load_infer = warm_ms * (1.0 + 0.12 * max(load_concurrency - 1, 0))
    load_cost, load_uc = cost_from_profile(profile, inference_ms=load_infer, tokens_in=tokens_in, tokens_out=tokens_out)
    samples.append(
        ProbeSample(
            provider=profile["id"],
            warm_state="warm",
            concurrency=load_concurrency,
            e2e_latency_ms=round(load_infer + load_queue, 3),
            queue_wait_ms=load_queue,
            inference_ms=round(load_infer, 3),
            cold_start_ms=0.0,
            ttft_ms=round(load_infer * 0.25, 3),
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            tokens_per_sec=round(tok_s / max(1.0, 1.0 + 0.08 * (load_concurrency - 1)), 3),
            cost_usd=round(load_cost, 8),
            cost_microcents=load_uc,
            hardware=str(profile["hardware"]),
            job_id=None,
            evidence="simulated",
            ok=True,
            notes=f"Simulated load probe at concurrency={load_concurrency}",
        )
    )
    return samples


def _p50(values: list[float]) -> float:
    if not values:
        return 0.0
    return float(statistics.median(values))


def _p95(values: list[float]) -> float:
    if not values:
        return 0.0
    if len(values) == 1:
        return values[0]
    ordered = sorted(values)
    idx = min(len(ordered) - 1, max(0, math.ceil(0.95 * len(ordered)) - 1))
    return float(ordered[idx])


def rollup_provider(
    profile: dict[str, Any],
    samples: list[ProbeSample],
) -> ProviderRollup:
    ok = [s for s in samples if s.ok]
    cold = [s for s in ok if s.warm_state == "cold" and s.concurrency == 1]
    warm = [s for s in ok if s.warm_state == "warm" and s.concurrency == 1]
    load = [s for s in ok if s.concurrency > 1]

    cold_p50 = _p50([s.e2e_latency_ms for s in cold]) or _p50([s.e2e_latency_ms for s in ok])
    warm_p50 = _p50([s.e2e_latency_ms for s in warm]) or cold_p50
    cold_penalty = _p50([s.cold_start_ms for s in cold]) or max(0.0, cold_p50 - warm_p50)
    warm_tps = _p50([s.tokens_per_sec for s in warm]) or _p50([s.tokens_per_sec for s in ok])
    cost = _p50([s.cost_usd for s in (warm or ok)])
    tokens = 0
    if warm or ok:
        ref = (warm or ok)[0]
        tokens = max(1, ref.tokens_in + ref.tokens_out)
    cost_per_1m = (cost / tokens) * 1_000_000.0 if tokens else 0.0

    evidence_set = {s.evidence for s in ok} or {"simulated"}
    if len(evidence_set) == 1:
        evidence = next(iter(evidence_set))
    elif "measured" in evidence_set:
        evidence = "measured"
    else:
        evidence = "estimated"

    return ProviderRollup(
        provider=profile["id"],
        display_name=str(profile["display_name"]),
        hardware=str(profile["hardware"]),
        pricing_model=str(profile["pricing_model"]),
        has_live_adapter=bool(profile.get("has_live_adapter")),
        cold_e2e_p50_ms=round(cold_p50, 3),
        warm_e2e_p50_ms=round(warm_p50, 3),
        cold_start_penalty_ms=round(cold_penalty, 3),
        load_p95_ms=round(_p95([s.e2e_latency_ms for s in load]), 3) if load else None,
        tokens_per_sec_warm=round(warm_tps, 3),
        cost_usd_per_job=round(cost, 8),
        cost_per_1m_tokens_usd=round(cost_per_1m, 6),
        sample_count=len(ok),
        evidence=evidence,  # type: ignore[arg-type]
        samples=samples,
    )


def pick_recommendations(rollups: list[ProviderRollup]) -> dict[str, Any]:
    """Cheapest / fastest / balanced / recommended — same spirit as FinOps TS domain."""
    viable = [r for r in rollups if r.sample_count > 0]
    if not viable:
        return {
            "cheapest": None,
            "fastest": None,
            "balanced": None,
            "recommended": None,
            "analysis_note": "No successful provider probes.",
        }

    fastest = min(viable, key=lambda r: r.warm_e2e_p50_ms)
    cheapest = min(viable, key=lambda r: r.cost_usd_per_job)
    max_cost = max(r.cost_usd_per_job for r in viable) or 0.001
    max_ms = max(r.warm_e2e_p50_ms for r in viable) or 1000.0

    def balance_score(r: ProviderRollup) -> float:
        return 0.5 * (r.cost_usd_per_job / max_cost) + 0.5 * (r.warm_e2e_p50_ms / max_ms)

    balanced = min(viable, key=balance_score)

    # Prefer local zero-cost when available; otherwise prefer powerful-GPU win vs slow serverless.
    recommended = balanced
    local = next((r for r in viable if r.provider.startswith("local_")), None)
    h100ish = next((r for r in viable if r.provider in {"coreweave", "nebius", "runpod"}), None)
    slow = next((r for r in viable if r.provider == "baseten"), None)
    if local and local.cost_usd_per_job <= 0.0:
        recommended = local
    elif (
        h100ish
        and slow
        and h100ish.warm_e2e_p50_ms < slow.warm_e2e_p50_ms
        and h100ish.cost_usd_per_job <= slow.cost_usd_per_job * 1.15
    ):
        recommended = h100ish

    def summarize(r: ProviderRollup, category: str) -> dict[str, Any]:
        return {
            "category": category,
            "provider": r.provider,
            "display_name": r.display_name,
            "hardware": r.hardware,
            "pricing_model": r.pricing_model,
            "warm_e2e_p50_ms": r.warm_e2e_p50_ms,
            "cold_e2e_p50_ms": r.cold_e2e_p50_ms,
            "cold_start_penalty_ms": r.cold_start_penalty_ms,
            "load_p95_ms": r.load_p95_ms,
            "tokens_per_sec_warm": r.tokens_per_sec_warm,
            "cost_usd_per_job": r.cost_usd_per_job,
            "cost_per_1m_tokens_usd": r.cost_per_1m_tokens_usd,
            "evidence": r.evidence,
        }

    return {
        "cheapest": summarize(cheapest, "cheapest"),
        "fastest": summarize(fastest, "fastest"),
        "balanced": summarize(balanced, "balanced"),
        "recommended": summarize(recommended, "recommended"),
        "analysis_note": (
            "Picks use warm p50 E2E latency and per-job cost from the identical canonical workload. "
            "Cold-start penalty and load p95 are reported for capacity planning. "
            "Every figure is labeled measured, estimated, simulated, or provider-reported."
        ),
    }


def rollup_to_dict(r: ProviderRollup) -> dict[str, Any]:
    payload = asdict(r)
    payload["samples"] = [asdict(s) for s in r.samples]
    return payload


def select_profiles(provider_ids: list[str] | None = None) -> list[dict[str, Any]]:
    if not provider_ids:
        return list(PROVIDER_MATRIX)
    wanted = {p.strip() for p in provider_ids if p.strip()}
    selected = [p for p in PROVIDER_MATRIX if p["id"] in wanted]
    missing = wanted - {p["id"] for p in selected}
    if missing:
        raise ValueError(f"Unknown provider id(s): {', '.join(sorted(missing))}")
    return selected
