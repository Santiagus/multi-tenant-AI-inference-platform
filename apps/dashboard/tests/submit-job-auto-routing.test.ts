import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveAutoMatchOption,
  formatAutoDropdownLabel,
  isOptionAutoMatch,
} from '../src/components/jobs/SubmitJobModal';
import type { ModelCloudOptionsResponse, CloudOption } from '../src/types';

describe('Submit Job AUTO Routing & Proposal Match Badge', () => {
  const mockLocalOption: CloudOption = {
    id: 'local-pytorch',
    category: 'cheapest',
    provider: 'local_pytorch',
    displayName: 'Local PyTorch',
    hardwareOrExecution: 'Local CUDA / CPU',
    vramGb: 16,
    pricingModel: 'on_demand',
    hourlyRateUsd: 0.0,
    forecastedExecutionMs: 64,
    forecastedCostUsd: 0.0,
    forecastedCostMicrocents: 0,
    tokensPerSec: 105,
    obtainabilityLabel: 'High',
    interruptionRiskTier: 'guaranteed',
    finopsInsight: 'Zero cloud cost, zero egress, sub-second latency on local PyTorch worker.',
    routingPreference: 'local_first',
    coldStartEstimatedMs: 0,
  };

  const mockH100Option: CloudOption = {
    id: 'runpod-spot-h100',
    category: 'fastest',
    provider: 'runpod',
    displayName: 'RunPod Spot H100 SXM5',
    hardwareOrExecution: 'NVIDIA H100 SXM5 (80GB)',
    vramGb: 80,
    pricingModel: 'spot_bid',
    hourlyRateUsd: 1.99,
    forecastedExecutionMs: 435,
    forecastedCostUsd: 0.00024,
    forecastedCostMicrocents: 24000,
    tokensPerSec: 180,
    obtainabilityLabel: 'High',
    interruptionRiskTier: '<5%',
    finopsInsight: 'Ultra-fast execution on H100.',
    routingPreference: 'low_latency',
    coldStartEstimatedMs: 80,
  };

  const mockRecommendationsResponse: ModelCloudOptionsResponse = {
    ok: true,
    modelId: 'TinyLlama/TinyLlama-1.1B-Chat-v1.0',
    promptTokens: 128,
    maxNewTokens: 64,
    recommendations: {
      cheapest: mockLocalOption,
      fastest: mockH100Option,
      balanced: mockLocalOption,
      recommended: mockLocalOption,
    },
    allOptions: [mockLocalOption, mockH100Option],
  };

  it('resolves auto match option from recommendation payload', () => {
    assert.equal(resolveAutoMatchOption(null), null);

    const match = resolveAutoMatchOption(mockRecommendationsResponse);
    assert.ok(match);
    assert.equal(match.id, 'local-pytorch');
    assert.equal(match.displayName, 'Local PyTorch');
  });

  it('formats advance proposal label in auto routing dropdown', () => {
    assert.equal(
      formatAutoDropdownLabel(null),
      'auto (Deterministic Engine)'
    );

    assert.equal(
      formatAutoDropdownLabel(mockLocalOption),
      'auto (Deterministic Engine → Proposal: Local PyTorch)'
    );

    assert.equal(
      formatAutoDropdownLabel(mockH100Option),
      'auto (Deterministic Engine → Proposal: RunPod Spot H100 SXM5)'
    );
  });

  it('identifies auto match card by key and proposal ID for badge display', () => {
    // Key 'recommended' is always marked as auto match
    assert.equal(isOptionAutoMatch('recommended', 'any-id', 'local-pytorch'), true);
    assert.equal(isOptionAutoMatch('recommended', 'other-id', undefined), true);

    // Matching proposal id is identified as auto match
    assert.equal(isOptionAutoMatch('cheapest', 'local-pytorch', 'local-pytorch'), true);

    // Unmatched cards do not receive auto match badge
    assert.equal(isOptionAutoMatch('fastest', 'runpod-spot-h100', 'local-pytorch'), false);
    assert.equal(isOptionAutoMatch('balanced', 'vast-spot-rtx5090', 'local-pytorch'), false);
  });
});
