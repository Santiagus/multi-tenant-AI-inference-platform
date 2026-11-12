import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeAdvisory, evaluateAcquisition, projectMonthlySpendUsd, HARDWARE_OPTIONS } from '../src/components/economics/acquisitionAdvisor';
import {
  getModelBenchmark,
  isEndpointCompatible,
  isGpuCompatible,
  MODEL_PUBLIC_BENCHMARKS,
  rankExecutionOptions,
} from '../src/components/finops/modelAdvisor';
import { CATALOG_MODELS } from '../src/components/finops/ModelRecommendationStudio';
import type { GpuPricingItem } from '../src/types';

const gpu = (over: Partial<GpuPricingItem>): GpuPricingItem => ({
  id: 'g',
  provider: 'runpod',
  hardwareSkuId: 'x',
  hardwareDisplayName: 'X',
  vramGb: 80,
  zone: 'z',
  pricingModel: 'on_demand',
  rateMicrocents: 0,
  billingUnit: 'hour',
  normalizedHourlyMicrocents: 0,
  normalizedHourlyUsd: 1,
  obtainabilityScore: 0.9,
  obtainabilityLabel: 'High',
  interruptionRiskTier: 'guaranteed',
  isAvailable: true,
  commitment: '',
  recordedAt: '',
  ...over,
});

describe('Model advisor ranking & public benchmarks', () => {
  const llama = CATALOG_MODELS[0];
  const cons = { requireVpc: false, risk: 'any' as const };

  it('defines a public benchmark reference for every model in CATALOG_MODELS', () => {
    for (const m of CATALOG_MODELS) {
      assert.ok(MODEL_PUBLIC_BENCHMARKS[m.id], `Missing public benchmark ref for ${m.id}`);
      const b = getModelBenchmark(m);
      assert.ok(b.benchmarkSuite.length > 0);
      assert.ok(b.referenceTaskTokens > 0);
      assert.ok(b.tokensPerConcernUnit > 0);
    }
  });

  it('prefers a pricier but faster GPU when it lowers $/1M tok and maximizes tok/s', () => {
    const slow = gpu({ id: 'slow', normalizedHourlyUsd: 0.5, hardwareSkuId: 'slow' });
    const fast = gpu({ id: 'fast', normalizedHourlyUsd: 1.0, hardwareSkuId: 'fast' });
    const tps = (g: GpuPricingItem) => (g.id === 'fast' ? 300 : 50);
    const r = rankExecutionOptions(llama, [slow, fast], cons, tps);
    assert.equal(r.cheapestHourly?.gpu.id, 'slow');
    assert.equal(r.bestValue?.gpu.id, 'fast');
    assert.equal(r.fastest?.gpu.id, 'fast');
    assert.ok((r.bestValue?.costPerMillionUsd ?? 999) < (r.cheapestHourly?.costPerMillionUsd ?? 0));
    assert.equal(r.fastest?.tokensPerSec, 300);
  });

  it('computes both $/1M tok and modality-specific concern unit cost for CogVideoX 5B', () => {
    const cogvideo = CATALOG_MODELS.find((m) => m.id === 'THUDM/CogVideoX-5b')!;
    const h100 = gpu({ id: 'h100', normalizedHourlyUsd: 2.0, vramGb: 80 });
    const r = rankExecutionOptions(cogvideo, [h100], cons, () => 180);
    assert.equal(r.options.length, 1);
    const opt = r.options[0];
    assert.equal(opt.concernUnitLabel, '100 clips (6s)');
    assert.ok(opt.tokensPerSec > 0);
    assert.ok(opt.costPerMillionUsd > 0);
    assert.ok(Math.abs(opt.concernUnitCostUsd - (opt.costPerMillionUsd / 1_000_000) * 3_600_000) < 1e-6);
  });

  it('filters by VRAM, VPC and interruption risk', () => {
    const small = gpu({ id: 'small', vramGb: 8 });
    const spot = gpu({ id: 'spot', interruptionRiskTier: '>20%', provider: 'sagemaker' });
    const noVpc = gpu({ id: 'novpc', provider: 'vast_ai' });
    const ok = gpu({ id: 'ok', provider: 'sagemaker' });
    const all = [small, spot, noVpc, ok];
    assert.equal(rankExecutionOptions(llama, all, cons, () => 100).options.some((o) => o.gpu.id === 'small'), false);
    const strict = rankExecutionOptions(llama, all, { ...cons, requireVpc: true, risk: 'guaranteed' }, () => 100);
    assert.deepEqual(strict.options.map((o) => o.gpu.id), ['ok']);
    assert.equal(strict.secure?.gpu.id, 'ok');
  });

  it('restricts owned weights to allowed providers', () => {
    const owned = CATALOG_MODELS.find((m) => m.weightType === 'proprietary')!;
    const r = rankExecutionOptions(owned, [gpu({ id: 'fal', provider: 'fal' })], cons, () => 100);
    assert.equal(r.options.length, 0);
  });

  it('deduplicates local_pytorch offerings across multiple snapshots or zones', () => {
    const local1 = gpu({ id: 'local-1', provider: 'local_pytorch', hardwareSkuId: 'nvidia-rtx-5070-ti', zone: 'local-edge-workstation', normalizedHourlyUsd: 0 });
    const local2 = gpu({ id: 'local-2', provider: 'local_pytorch', hardwareSkuId: 'nvidia-rtx-5070-ti', zone: 'local-workstation', normalizedHourlyUsd: 0 });
    const cloud = gpu({ id: 'cloud-1', provider: 'runpod', hardwareSkuId: 'nvidia-rtx-5070-ti', zone: 'runpod-us-east', normalizedHourlyUsd: 0.35 });
    const r = rankExecutionOptions(llama, [local1, local2, cloud], cons, () => 100);
    const localOptions = r.options.filter((o) => o.gpu.provider === 'local_pytorch');
    assert.equal(localOptions.length, 1);
    assert.equal(localOptions[0].gpu.hardwareSkuId, 'nvidia-rtx-5070-ti');
    assert.equal(localOptions[0].costPerJobUsd, 0);
  });

  it('includes public benchmark reference URL and exact reference job cost', () => {
    const local = gpu({ id: 'local', provider: 'local_pytorch', hardwareSkuId: 'nvidia-rtx-5070-ti', normalizedHourlyUsd: 0 });
    const r = rankExecutionOptions(llama, [local], cons, () => 100);
    assert.equal(r.options.length, 1);
    const opt = r.options[0];
    assert.ok(opt.benchmark.referenceUrl.startsWith('https://'));
    assert.ok(opt.benchmark.benchmarkSuite.length > 0);
    assert.equal(opt.costPerJobUsd, 0);
    assert.ok(opt.execSeconds > 0);
  });
});

describe('Acquisition advisor', () => {
  it('projects spend with override precedence', () => {
    assert.equal(projectMonthlySpendUsd(2, 10), 600);
    assert.equal(projectMonthlySpendUsd(2, 10, 500), 500);
    assert.equal(projectMonthlySpendUsd(-1, 10), 0);
  });

  it('computes break-even and never-pays-back cases', () => {
    const card = HARDWARE_OPTIONS[0];
    const high = evaluateAcquisition(card, 500);
    assert.ok(high.breakEvenMonths !== null && high.breakEvenMonths < 12);
    const none = evaluateAcquisition(card, 0);
    assert.equal(none.cardsNeeded, 0);
    assert.equal(none.breakEvenMonths, null);
  });

  it('recommends by spend level', () => {
    assert.equal(computeAdvisory(0).action, 'keep_flexible');
    assert.equal(computeAdvisory(1500).action, 'acquire_hardware');
    assert.equal(computeAdvisory(1500).reservations.length, 3);
  });
});

describe('Model compatibility filters', () => {
  const open = CATALOG_MODELS.find((m) => m.id === 'meta-llama/Llama-3-8B-Instruct')!;
  const owned = CATALOG_MODELS.find((m) => m.weightType === 'proprietary')!;

  it('filters GPUs by VRAM, owned-weights provider, VPC and risk', () => {
    assert.equal(isGpuCompatible(open, { provider: 'fal', vramGb: 24 }), true);
    assert.equal(isGpuCompatible(open, { provider: 'runpod', vramGb: 8 }), false);
    assert.equal(isGpuCompatible(owned, { provider: 'fal', vramGb: 80 }), false);
    assert.equal(isGpuCompatible(owned, { provider: 'runpod', vramGb: 80 }), true);
    assert.equal(isGpuCompatible(open, { provider: 'vast_ai', vramGb: 32 }, { requireVpc: true }), false);
    assert.equal(isGpuCompatible(open, { provider: 'sagemaker', vramGb: 32 }, { requireVpc: true }), true);
    assert.equal(isGpuCompatible(open, { provider: 'runpod', vramGb: 80, riskTier: '>20%' }, { risk: 'low_risk' }), false);
  });

  it('matches endpoints serving the picked open model or modality and respects VPC', () => {
    assert.equal(isEndpointCompatible(open, { modelId: 'meta-llama/llama-3-8b-instruct', modelName: 'Llama 3 8B' }), true);
    assert.equal(isEndpointCompatible(open, { modelId: 'x/flux', modelName: 'FLUX.1', modality: 'text_to_image' }), false);
    assert.equal(isEndpointCompatible(open, { modelId: 'deepseek-v4.1-flash-1017', modelName: 'DeepSeek V4.1 Flash', modality: 'text_to_text' }), true);
    assert.equal(isEndpointCompatible(open, { modelId: 'deepseek-v4.1-flash-1017', modelName: 'DeepSeek V4.1 Flash', provider: 'jarvislabs', modality: 'text_to_text' }, { requireVpc: true }), false);
    assert.equal(isEndpointCompatible(owned, { modelId: owned.id, modelName: owned.name }), false);
  });
});
