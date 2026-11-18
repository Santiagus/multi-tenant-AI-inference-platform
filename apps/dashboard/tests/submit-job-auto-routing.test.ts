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
    routingPreference: 'local/gpu',
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
    routingPreference: 'cloud/runpod',
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

  it('resolves auto match option from recommendation payload (local only)', () => {
    assert.equal(resolveAutoMatchOption(null), null);

    const match = resolveAutoMatchOption(mockRecommendationsResponse);
    assert.ok(match);
    assert.equal(match.id, 'local-pytorch');
    assert.equal(match.displayName, 'Local PyTorch');
  });

  it('falls back to local when FinOps recommended tip is a cloud SKU', () => {
    const cloudRecommended: ModelCloudOptionsResponse = {
      ...mockRecommendationsResponse,
      recommendations: {
        ...mockRecommendationsResponse.recommendations,
        recommended: mockH100Option,
      },
    };
    const match = resolveAutoMatchOption(cloudRecommended);
    assert.ok(match);
    assert.equal(match.id, 'local-pytorch');
  });

  it('formats auto label without implying cloud execution', () => {
    assert.equal(formatAutoDropdownLabel(null), 'auto (local engine; device inferred)');

    assert.equal(
      formatAutoDropdownLabel(mockLocalOption),
      'auto (local engine · FinOps tip: Local PyTorch)'
    );

    // Even if a cloud tip is passed, wording must not read as "will execute on RunPod".
    assert.equal(
      formatAutoDropdownLabel(mockH100Option),
      'auto (local engine · FinOps tip: RunPod Spot H100 SXM5)'
    );
  });

  it('identifies auto match card by proposal ID only (not every recommended key)', () => {
    assert.equal(isOptionAutoMatch('recommended', 'local-pytorch', 'local-pytorch'), true);
    assert.equal(isOptionAutoMatch('recommended', 'other-id', undefined), false);
    assert.equal(isOptionAutoMatch('cheapest', 'local-pytorch', 'local-pytorch'), true);
    assert.equal(isOptionAutoMatch('fastest', 'runpod-spot-h100', 'local-pytorch'), false);
    assert.equal(isOptionAutoMatch('balanced', 'vast-spot-rtx5090', 'local-pytorch'), false);
  });
});
