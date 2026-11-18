"""Opt-in tests for cross-provider comparison aggregation and picks.

Not under tests/ — excluded from default `make test` / unittest discovery.
Run only on request via `make benchmark-providers`.
"""

from __future__ import annotations

import unittest

from benchmarks.provider_comparison import (
    PROVIDER_MATRIX,
    pick_recommendations,
    rollup_provider,
    select_profiles,
    simulate_provider_samples,
)


class ProviderComparisonTests(unittest.TestCase):
    def test_matrix_covers_live_adapters_and_catalog(self) -> None:
        ids = {p["id"] for p in PROVIDER_MATRIX}
        for required in ("local_pytorch", "runpod", "bedrock", "sagemaker", "vast_ai", "baseten"):
            self.assertIn(required, ids)
        self.assertTrue(any(p["has_live_adapter"] for p in PROVIDER_MATRIX))
        self.assertTrue(any(not p["has_live_adapter"] for p in PROVIDER_MATRIX))

    def test_simulate_emits_cold_warm_and_load_samples(self) -> None:
        profile = next(p for p in PROVIDER_MATRIX if p["id"] == "runpod")
        samples = simulate_provider_samples(profile, load_concurrency=4)
        self.assertGreaterEqual(len(samples), 3)
        states = {(s.warm_state, s.concurrency) for s in samples}
        self.assertIn(("cold", 1), states)
        self.assertIn(("warm", 1), states)
        self.assertTrue(any(s.concurrency == 4 for s in samples))
        self.assertTrue(all(s.evidence == "simulated" for s in samples))
        self.assertTrue(all(s.ok for s in samples))

    def test_picks_cheapest_fastest_balanced(self) -> None:
        rollups = []
        for profile in select_profiles(["local_pytorch", "runpod", "baseten", "vast_ai"]):
            samples = simulate_provider_samples(profile, load_concurrency=2)
            rollups.append(rollup_provider(profile, samples))

        picks = pick_recommendations(rollups)
        self.assertIsNotNone(picks["cheapest"])
        self.assertIsNotNone(picks["fastest"])
        self.assertIsNotNone(picks["balanced"])
        self.assertIsNotNone(picks["recommended"])

        # Local GPU is zero marginal cloud cost → cheapest & typically recommended.
        self.assertEqual(picks["cheapest"]["provider"], "local_pytorch")
        self.assertEqual(picks["recommended"]["provider"], "local_pytorch")

        # Fastest should be lowest warm p50 among the set.
        warm = {r.provider: r.warm_e2e_p50_ms for r in rollups}
        fastest_id = min(warm, key=warm.get)  # type: ignore[arg-type]
        self.assertEqual(picks["fastest"]["provider"], fastest_id)

    def test_select_profiles_rejects_unknown(self) -> None:
        with self.assertRaises(ValueError):
            select_profiles(["not_a_provider"])


if __name__ == "__main__":
    unittest.main()
