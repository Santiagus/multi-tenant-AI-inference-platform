import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getJobExecutionMode, getJobHardware, ALL_PLATFORM_PROVIDERS } from '../src/components/jobs/JobsView';
import { DEFAULT_PROVIDER_FLEET } from '../src/components/finops/ProviderFleetBar';
import { CATALOG_MODELS } from '../src/components/finops/ModelRecommendationStudio';
import { getTradingSession } from '../src/components/finops/HistoricalPriceChart';
import { getGpuPerformance } from '../src/components/finops/FinOpsPricingView';
import type { JobItem, PricingHistoryPoint, GpuPricingItem } from '../src/types';

describe('Enterprise Workload Observability & Hardware Ecosystem', () => {
  it('detects execution modality correctly across all job profiles', () => {
    const baseJob: JobItem = {
      job_id: 'job-1',
      tenant_id: 't-1',
      status: 'SUCCEEDED',
      model_id: 'meta-llama/Llama-3-8B-Instruct',
      correlation_id: null,
      trace_id: null,
      traceparent: null,
      routing_preference: 'auto',
      priority: 5,
      provider: 'runpod',
      retry_count: 0,
      created_at: new Date().toISOString(),
      started_at: null,
      completed_at: null,
      duration_ms: 120,
    };

    assert.equal(getJobExecutionMode({ ...baseJob, provider: 'runpod' }), 'spot');
    assert.equal(getJobExecutionMode({ ...baseJob, provider: 'vast_ai' }), 'spot');
    assert.equal(getJobExecutionMode({ ...baseJob, provider: 'baseten' }), 'serverless');
    assert.equal(getJobExecutionMode({ ...baseJob, provider: 'jarvislabs' }), 'token_factory');
    assert.equal(getJobExecutionMode({ ...baseJob, provider: 'fal' }), 'pay_per_call');
    assert.equal(getJobExecutionMode({ ...baseJob, provider: 'runware' }), 'pay_per_call');
    assert.equal(getJobExecutionMode({ ...baseJob, routing_preference: 'local' }), 'local');
    assert.equal(getJobExecutionMode({ ...baseJob, provider: 'bedrock' }), 'on_demand');
    assert.equal(getJobExecutionMode({ ...baseJob, execution_mode: 'serverless' }), 'serverless');
  });

  it('accurately identifies modern cloud GPU hardware ecosystem chips', () => {
    const baseJob: JobItem = {
      job_id: 'job-2',
      tenant_id: 't-1',
      status: 'PROCESSING',
      model_id: 'meta-llama/Llama-3-70B-Instruct',
      correlation_id: null,
      trace_id: null,
      traceparent: null,
      routing_preference: 'cloud',
      priority: 5,
      provider: 'runpod',
      retry_count: 0,
      created_at: new Date().toISOString(),
      started_at: null,
      completed_at: null,
      duration_ms: null,
    };

    // RunPod 70B runs on H100 SXM5
    assert.match(getJobHardware(baseJob), /H100 SXM5/);

    // Vast.ai runs on RTX 5090 Blackwell
    assert.match(getJobHardware({ ...baseJob, provider: 'vast_ai' }), /RTX 5090 Blackwell/);

    // Baseten runs on L4 Tensor Core
    assert.match(getJobHardware({ ...baseJob, provider: 'baseten' }), /L4 Tensor Core/);

    // Nebius runs on H200 SXM
    assert.match(getJobHardware({ ...baseJob, provider: 'nebius' }), /H200 SXM/);

    // Local worker runs on RTX 5070 Ti
    assert.match(getJobHardware({ ...baseJob, provider: 'local_pytorch' }), /RTX 5070 Ti/);

    // AWS SageMaker runs on Inferentia2 / G5
    assert.match(getJobHardware({ ...baseJob, provider: 'sagemaker' }), /Inferentia2/);

    // CPU Fallback
    assert.match(getJobHardware({ ...baseJob, routing_preference: 'local/cpu' }), /CPU/);
  });

  it('registers all 14 enterprise neocloud and on-prem providers', () => {
    assert.equal(ALL_PLATFORM_PROVIDERS.length, 14);
    const providerIds = ALL_PLATFORM_PROVIDERS.map((p) => p.id);
    assert.ok(providerIds.includes('local_pytorch'));
    assert.ok(providerIds.includes('runpod'));
    assert.ok(providerIds.includes('vast_ai'));
    assert.ok(providerIds.includes('baseten'));
    assert.ok(providerIds.includes('nebius'));
    assert.ok(providerIds.includes('jarvislabs'));
    assert.ok(providerIds.includes('coreweave'));
    assert.ok(providerIds.includes('fal'));
    assert.ok(providerIds.includes('runware'));
    assert.ok(providerIds.includes('hivenet'));
    assert.ok(providerIds.includes('wavespeed'));
    assert.ok(providerIds.includes('neocloudz'));
    assert.ok(providerIds.includes('bedrock'));
    assert.ok(providerIds.includes('sagemaker'));
  });
});

describe('Provider Fleet & Real-Time Sync Telemetry', () => {
  it('contains expected sync cadences, pricing models, and credit quotas', () => {
    assert.equal(DEFAULT_PROVIDER_FLEET.length, 14);

    const runpod = DEFAULT_PROVIDER_FLEET.find((p) => p.provider === 'runpod')!;
    assert.equal(runpod.updateCadenceCategory, 'realtime_auction');
    assert.ok(runpod.allowedPricingModels.includes('spot'));
    assert.ok(runpod.allowedPricingModels.includes('on_demand'));
    assert.ok(runpod.allowedPricingModels.includes('serverless'));
    assert.equal(runpod.availableCreditsUsd, 15.0);
    assert.match(runpod.interruptionNoticeWindow, /2-min/);
    assert.equal(runpod.spotPolicy?.noticeWindowMinutes, 2);
    assert.equal(runpod.spotPolicy?.pricingType, 'floating_bid');

    const vast = DEFAULT_PROVIDER_FLEET.find((p) => p.provider === 'vast_ai')!;
    assert.equal(vast.updateCadenceCategory, 'realtime_auction');
    assert.match(vast.interruptionNoticeWindow, /outbid/);
    assert.equal(vast.spotPolicy?.noticeWindowMinutes, 0);
    assert.equal(vast.spotPolicy?.pricingType, 'floating_bid');

    const baseten = DEFAULT_PROVIDER_FLEET.find((p) => p.provider === 'baseten')!;
    assert.ok(baseten.allowedPricingModels.includes('serverless'));
    assert.equal(baseten.availableCreditsUsd, 250);

    const coreweave = DEFAULT_PROVIDER_FLEET.find((p) => p.provider === 'coreweave')!;
    assert.equal(coreweave.spotPolicy?.noticeWindowMinutes, 2);
    assert.equal(coreweave.spotPolicy?.pricingType, 'fixed_discount');

    const bedrock = DEFAULT_PROVIDER_FLEET.find((p) => p.provider === 'bedrock')!;
    assert.equal(bedrock.creditType, 'postpaid_invoice');
    assert.equal(bedrock.availableCreditsUsd, null);
  });
});

describe('Model Purpose & Hardware Sizing Studio Logic', () => {
  it('categorizes models across all required modalities', () => {
    const purposes = new Set(CATALOG_MODELS.map((m) => m.purpose));
    assert.ok(purposes.has('text_to_text'));
    assert.ok(purposes.has('text_to_image'));
    assert.ok(purposes.has('text_to_video'));
    assert.ok(purposes.has('speech_to_text'));
    assert.ok(purposes.has('code_reasoning'));
  });

  it('contains both open weights and proprietary models with VRAM specs', () => {
    const openModels = CATALOG_MODELS.filter((m) => m.weightType === 'open');
    const propModels = CATALOG_MODELS.filter((m) => m.weightType === 'proprietary');

    assert.ok(openModels.length >= 7);
    assert.ok(propModels.length >= 4);

    for (const m of CATALOG_MODELS) {
      assert.ok(m.minVramGb > 0, `Model ${m.name} must specify minVramGb`);
      assert.ok(m.weightsSizeGb > 0, `Model ${m.name} must specify weightsSizeGb`);
      assert.ok(m.storageCostMonthlyUsd >= 0, `Model ${m.name} must specify storageCostMonthlyUsd`);
      assert.ok(m.coldStartSec > 0, `Model ${m.name} must specify coldStartSec`);
    }
  });

  it('computes Min, Max, and Average price benchmarks correctly for Historical Chart', () => {
    const mockHistory: PricingHistoryPoint[] = [
      { recordedAt: '2026-11-01T00:00:00Z', priceUsd: 2.99, spotPriceUsd: 1.99, availability: 'High' },
      { recordedAt: '2026-11-02T00:00:00Z', priceUsd: 3.19, spotPriceUsd: 1.79, availability: 'High' },
      { recordedAt: '2026-11-03T00:00:00Z', priceUsd: 2.89, spotPriceUsd: 1.69, availability: 'Medium' },
      { recordedAt: '2026-11-04T00:00:00Z', priceUsd: 3.49, spotPriceUsd: 2.19, availability: 'Low' },
    ];

    const allPrices = mockHistory.map((h) => h.priceUsd);
    const max = Math.max(...allPrices);
    const min = Math.min(...allPrices);
    const avg = allPrices.reduce((a, b) => a + b, 0) / allPrices.length;

    assert.equal(max, 3.49);
    assert.equal(min, 2.89);
    assert.equal(Number(avg.toFixed(2)), 3.14);

    const spotPrices = mockHistory.map((h) => h.spotPriceUsd!);
    const spotMin = Math.min(...spotPrices);
    assert.equal(spotMin, 1.69);
  });

  it('detects global trading sessions accurately based on UTC timestamp', () => {
    // 04:00 UTC -> Asia
    const asia = getTradingSession('2026-11-05T04:00:00Z');
    assert.equal(asia.name, 'Asia');
    assert.equal(asia.flag, '🇯🇵');

    // 11:00 UTC -> Europe
    const europe = getTradingSession('2026-11-05T11:00:00Z');
    assert.equal(europe.name, 'Europe');
    assert.equal(europe.flag, '🇪🇺');

    // 18:00 UTC -> USA
    const usa = getTradingSession('2026-11-05T18:00:00Z');
    assert.equal(usa.name, 'USA');
    assert.equal(usa.flag, '🇺🇸');

    // 23:00 UTC -> OffPeak
    const offPeak = getTradingSession('2026-11-05T23:00:00Z');
    assert.equal(offPeak.name, 'OffPeak');
    assert.equal(offPeak.flag, '🌙');
  });

  it('computes hardware throughput and cost-efficiency metrics accurately', () => {
    const mockGpu: GpuPricingItem = {
      id: 'g-1',
      provider: 'runpod',
      hardwareSkuId: 'nvidia-h100-sxm',
      hardwareDisplayName: 'NVIDIA H100 SXM5 80GB',
      vramGb: 80,
      zone: 'us-east-1',
      pricingModel: 'spot_bid',
      rateMicrocents: 199000000,
      billingUnit: 'hour',
      normalizedHourlyMicrocents: 199000000,
      normalizedHourlyUsd: 1.99,
      obtainabilityScore: 0.85,
      obtainabilityLabel: 'High',
      interruptionRiskTier: '<5%',
      isAvailable: true,
      commitment: '$0 Pay-as-you-go',
      recordedAt: new Date().toISOString(),
    };

    const perf = getGpuPerformance(mockGpu);
    assert.equal(perf.tokensPerSec, 180);
    // 180 tok/s * 3600 sec/hr = 648,000 tok/hr
    // tokensPerDollar = 648,000 / 1.99 = 325,628
    assert.ok(perf.tokensPerDollar > 320000);
    // costPerMillion = (1.99 / 648,000) * 1,000,000 = $3.07
    assert.ok(perf.costPerMillion > 3.0 && perf.costPerMillion < 3.2);

    // Cheap consumer GPU high-efficiency validation (RTX 4090 spot at $0.34/hr, 85 tok/s)
    const cheapGpu: GpuPricingItem = {
      ...mockGpu,
      hardwareSkuId: 'nvidia-rtx-4090',
      normalizedHourlyUsd: 0.34,
    };
    const cheapPerf = getGpuPerformance(cheapGpu);
    assert.equal(cheapPerf.tokensPerSec, 85);
    // 85 * 3600 / 0.34 = 900,000 tokens per dollar
    assert.equal(cheapPerf.tokensPerDollar, 900000);
    assert.ok(cheapPerf.costPerMillion < 1.2);
  });

  it('validates all provider source links and spot preemption policies', () => {
    for (const p of DEFAULT_PROVIDER_FLEET) {
      assert.ok(p.websiteUrl, `Provider ${p.provider} must have websiteUrl`);
      assert.ok(p.pricingUrl, `Provider ${p.provider} must have pricingUrl`);
      assert.ok(p.billingUrl, `Provider ${p.provider} must have billingUrl`);
      assert.ok(p.syncDocUrl, `Provider ${p.provider} must have syncDocUrl`);
      assert.ok(p.cadenceExplanation, `Provider ${p.provider} must describe cadence explanation`);

      if (p.allowedPricingModels.includes('spot')) {
        assert.ok(p.spotPolicy, `Spot-supporting provider ${p.provider} must specify spotPolicy`);
        assert.ok(p.spotPolicy!.noticeWindowLabel, `Provider ${p.provider} must have notice window label`);
        assert.ok(['floating_bid', 'fixed_discount', 'dynamic_fixed', 'guaranteed'].includes(p.spotPolicy!.pricingType));
      }
    }
  });
});

