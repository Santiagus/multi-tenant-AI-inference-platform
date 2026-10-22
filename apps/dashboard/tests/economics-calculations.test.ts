import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

describe('FinOps Economics & Gross Margin Logic', () => {
  test('microcents to USD converts exactly (100,000,000 microcents = $1.00)', () => {
    const microcents = 100_000_000;
    const usd = microcents / 100_000_000;
    assert.equal(usd, 1.0);

    const smallMicrocents = 2_500; // $0.000025
    assert.equal(smallMicrocents / 100_000_000, 0.000025);
  });

  test('gross margin percentage computes correctly and handles zero revenue', () => {
    function computeGrossMargin(revenueMicrocents: number, costMicrocents: number): number {
      if (revenueMicrocents <= 0) return 0;
      const profit = revenueMicrocents - costMicrocents;
      return Number(((profit / revenueMicrocents) * 100).toFixed(2));
    }

    // Standard 40% margin case
    assert.equal(computeGrossMargin(100_000, 60_000), 40.0);

    // High margin (zero marginal cost local GPU): 100,000 revenue, 2,000 cost -> 98%
    assert.equal(computeGrossMargin(100_000, 2_000), 98.0);

    // Negative margin (cost exceeds billed revenue): 50,000 rev, 70,000 cost -> -40%
    assert.equal(computeGrossMargin(50_000, 70_000), -40.0);

    // Zero revenue edge case
    assert.equal(computeGrossMargin(0, 5_000), 0);
  });

  test('unit cost per 1k tokens computes accurately for UI presentation', () => {
    function getCostPer1kTokensUsd(costMicrocentsPerToken: number): number {
      return (costMicrocentsPerToken * 1000) / 100_000_000;
    }

    // Local PyTorch: 0 or 2 microcents per token
    assert.equal(getCostPer1kTokensUsd(0), 0);
    assert.equal(getCostPer1kTokensUsd(2), 0.00002);

    // RunPod: 50 microcents per token = $0.0005 / 1k tokens
    assert.equal(getCostPer1kTokensUsd(50), 0.0005);

    // Bedrock Claude 3 Haiku: 15 microcents per token = $0.00015 / 1k tokens
    assert.equal(getCostPer1kTokensUsd(15), 0.00015);

    // SageMaker: 60 microcents per token = $0.0006 / 1k tokens
    assert.equal(getCostPer1kTokensUsd(60), 0.0006);
  });
});

