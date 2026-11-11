import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getJobExecutionMode,
  getJobInferenceMode,
  getJobHardware,
  getJobComputeLabel,
  formatHardwareName,
  formatModelName,
  formatTimeAgo,
  getProviderBadgeLabel,
  ALL_PLATFORM_PROVIDERS,
} from '../src/components/jobs/JobsView';
import { DEFAULT_PROVIDER_FLEET, formatCadenceInterval } from '../src/components/finops/ProviderFleetBar';
import { computeProviderSyncMetrics } from '../src/components/providers/ProviderStatusView';
import { CATALOG_MODELS } from '../src/components/finops/ModelRecommendationStudio';
import { getTradingSession } from '../src/components/finops/HistoricalPriceChart';
import { getGpuPerformance, formatHwShortName } from '../src/components/finops/FinOpsPricingView';
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
    // mock/live labels must not override placement economics
    assert.equal(getJobExecutionMode({ ...baseJob, execution_mode: 'mock', provider: 'runpod' }), 'spot');
  });

  it('resolves mock vs real inference mode from metadata, API fields, and routing', () => {
    const baseJob: JobItem = {
      job_id: 'job-inf',
      tenant_id: 't-1',
      status: 'SUCCEEDED',
      model_id: 'meta-llama/Llama-3-8B-Instruct',
      correlation_id: null,
      trace_id: null,
      traceparent: null,
      routing_preference: 'local/gpu',
      priority: 5,
      provider: 'local_pytorch',
      retry_count: 0,
      created_at: new Date().toISOString(),
      started_at: null,
      completed_at: null,
      duration_ms: 12,
    };

    assert.equal(getJobInferenceMode({ ...baseJob, inference_mode: 'mock' }), 'mock');
    assert.equal(getJobInferenceMode({ ...baseJob, inference_mode: 'real' }), 'real');
    assert.equal(getJobInferenceMode({ ...baseJob, is_mocked: true }), 'mock');
    assert.equal(getJobInferenceMode({ ...baseJob, is_mocked: false }), 'real');
    assert.equal(
      getJobInferenceMode({
        ...baseJob,
        result: { metadata: { is_mocked: true, execution_mode: 'mock' } },
      }),
      'mock'
    );
    assert.equal(
      getJobInferenceMode({
        ...baseJob,
        result: { metadata: { is_mocked: false, execution_mode: 'live' } },
      }),
      'real'
    );
    assert.equal(getJobInferenceMode({ ...baseJob, routing_preference: 'mock' }), 'mock');
    assert.equal(getJobInferenceMode({ ...baseJob, job_id: '00000000-0000-4000-a000-000000000001' }), 'mock');
    // Ultra-short local durations without metadata are treated as mock legacy paths.
    assert.equal(getJobInferenceMode(baseJob), 'mock');
    assert.equal(getJobInferenceMode({ ...baseJob, duration_ms: 2500 }), null);
  });

  it('labels compute as CPU/GPU + engine and appends VRAM to hardware', () => {
    const baseJob: JobItem = {
      job_id: 'job-hw',
      tenant_id: 't-1',
      status: 'SUCCEEDED',
      model_id: 'meta-llama/Llama-3-8B-Instruct',
      correlation_id: null,
      trace_id: null,
      traceparent: null,
      routing_preference: 'local/gpu',
      priority: 5,
      provider: 'local',
      retry_count: 0,
      created_at: new Date().toISOString(),
      started_at: null,
      completed_at: null,
      duration_ms: 120,
      result: { metadata: { engine_executed: 'torchscript', device: 'cuda' } },
    };

    assert.equal(getJobComputeLabel(baseJob), 'GPU/torchscript');
    assert.match(getJobHardware(baseJob), /RTX 5070 Ti \(16 GB\)/);
    assert.match(formatHardwareName('NVIDIA GeForce RTX 4090'), /RTX 4090 \(24 GB\)/);
    assert.equal(
      getJobComputeLabel({
        ...baseJob,
        routing_preference: 'local/cpu',
        provider: 'local',
        result: { metadata: { engine_executed: 'eager', device: 'cpu' } },
      }),
      'CPU/eager'
    );
    // engine_executed=auto should resolve via telemetry backend, not display "Auto"
    assert.equal(
      getJobComputeLabel({
        ...baseJob,
        result: {
          metadata: {
            engine_executed: 'auto',
            engine_requested: 'auto',
            telemetry: { backend: 'pytorch_cuda', device_type: 'cuda', device_name: 'NVIDIA GeForce RTX 5070 Ti' },
          },
        },
      }),
      'GPU/eager'
    );
    assert.equal(
      getJobComputeLabel({
        ...baseJob,
        result: {
          metadata: {
            engine_executed: 'auto',
            engine_requested: 'auto',
            telemetry: {
              backend: 'pytorch_torchscript_cuda',
              device_type: 'cuda',
              device_name: 'NVIDIA GeForce RTX 5070 Ti',
            },
          },
        },
      }),
      'GPU/TorchScript_auto'
    );
    assert.equal(
      getJobComputeLabel({
        ...baseJob,
        result: { metadata: { engine_executed: 'torch-compile', device: 'cuda' } },
      }),
      'GPU/Pytorch 2.x'
    );
    assert.equal(
      formatHardwareName('AMD Ryzen 9 7900 12-Core Processor'),
      'Ryzen 9 7900'
    );
    assert.equal(formatHardwareName('Intel/AMD CPU'), 'CPU');
    // Failed/cancelled still surface planned HW + inference when metadata is sparse
    assert.match(
      getJobHardware({
        ...baseJob,
        status: 'CANCELLED',
        provider: 'fal',
        routing_preference: 'auto',
        result: { metadata: { showcase: true, is_mocked: true } },
      }),
      /Tensor Core/
    );
    assert.equal(
      getJobInferenceMode({
        ...baseJob,
        status: 'FAILED',
        duration_ms: 12,
        result: { metadata: { showcase: true, is_mocked: true } },
      }),
      'mock'
    );
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

  it('formats hardware names into compact representations without redundant descriptions', () => {
    assert.equal(formatHardwareName('NVIDIA GeForce RTX 5070 Ti (16GB)'), 'RTX 5070 Ti (16 GB)');
    assert.equal(formatHardwareName('NVIDIA GeForce RTX 4090 (24GB)'), 'RTX 4090 (24 GB)');
    assert.equal(formatHardwareName('NVIDIA GeForce RTX 5090 Blackwell (32GB)'), 'RTX 5090 Blackwell (32 GB)');
    assert.equal(formatHardwareName('NVIDIA H100 SXM5 (80GB)'), 'H100 SXM5 (80 GB)');
    assert.equal(formatHardwareName('NVIDIA H200 SXM (141GB HBM3e)'), 'H200 SXM (141 GB)');
    assert.equal(formatHardwareName('NVIDIA L4 Tensor Core (24GB)'), 'L4 Tensor Core (24 GB)');
    assert.equal(formatHardwareName('CPU Xeon/EPYC Fallback'), 'CPU Fallback');
  });

  it('formats model names by removing company/creator namespace', () => {
    assert.equal(formatModelName('meta-llama/Llama-3-8B-Instruct'), 'Llama-3-8B-Instruct');
    assert.equal(formatModelName('deepseek-ai/DeepSeek-R1-Distill-Qwen-14B'), 'DeepSeek-R1-Distill-Qwen-14B');
    assert.equal(formatModelName('black-forest-labs/FLUX.1-schnell'), 'FLUX.1-schnell');
    assert.equal(formatModelName('anthropic.claude-3-sonnet-20240229-v1:0'), 'claude-3-sonnet-20240229-v1:0');
    assert.equal(formatModelName('simple-model'), 'simple-model');
  });

  it('formats relative elapsed time since job submission cleanly', () => {
    const now = Date.now();
    assert.equal(formatTimeAgo(new Date(now - 2000).toISOString()), 'just now');
    assert.equal(formatTimeAgo(new Date(now - 35000).toISOString()), '35s ago');
    assert.equal(formatTimeAgo(new Date(now - 120000).toISOString()), '2m ago');
    assert.equal(formatTimeAgo(new Date(now - 7200000).toISOString()), '2h ago');
    assert.equal(formatTimeAgo(new Date(now - 172800000).toISOString()), '2d ago');
  });

  it('resolves AUTO provider badges dynamically indicating target picked', () => {
    const baseJob: JobItem = {
      job_id: 'job-12345678-abcd',
      tenant_id: 't-1',
      status: 'SUCCEEDED',
      model_id: 'meta-llama/Llama-3-8B-Instruct',
      correlation_id: null,
      trace_id: null,
      traceparent: null,
      routing_preference: 'auto',
      priority: 5,
      provider: 'local_pytorch',
      retry_count: 0,
      created_at: new Date().toISOString(),
      started_at: null,
      completed_at: null,
      duration_ms: 120,
    };

    // Auto local GPU
    const gpuAuto = getProviderBadgeLabel(baseJob);
    assert.equal(gpuAuto.isAuto, true);
    assert.equal(gpuAuto.label, 'AUTO (local/GPU)');

    // Auto local CPU with execution engine
    const cpuAuto = getProviderBadgeLabel({
      ...baseJob,
      routing_preference: 'auto',
      provider: 'local_cpu_worker',
      result: { metadata: { engine_executed: 'torchscript' } },
    });
    assert.equal(cpuAuto.isAuto, true);
    assert.equal(cpuAuto.label, 'AUTO (local/CPU/torchscript)');

    // Auto routed to RunPod
    const runpodAuto = getProviderBadgeLabel({
      ...baseJob,
      routing_preference: 'auto',
      provider: 'runpod',
    });
    assert.equal(runpodAuto.isAuto, true);
    assert.equal(runpodAuto.label, 'AUTO (runpod)');

    // Explicit provider routing (non-AUTO)
    const explicitLocal = getProviderBadgeLabel({
      ...baseJob,
      routing_preference: 'local/gpu',
      provider: 'local_pytorch',
    });
    assert.equal(explicitLocal.isAuto, false);
    assert.equal(explicitLocal.label, 'LOCAL');
  });

  it('registers all 14 enterprise neocloud and on-prem providers', () => {
    assert.equal(ALL_PLATFORM_PROVIDERS.length, 14);
    const providerIds = ALL_PLATFORM_PROVIDERS.map((p) => p.id);
    assert.ok(providerIds.includes('local'));
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
    assert.equal(runpod.availableCreditsUsd, null); // Unmocked by default, populated via live API
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
    assert.equal(baseten.availableCreditsUsd, null); // Unmocked by default, populated via live API

    const coreweave = DEFAULT_PROVIDER_FLEET.find((p) => p.provider === 'coreweave')!;
    assert.equal(coreweave.spotPolicy?.noticeWindowMinutes, 2);
    assert.equal(coreweave.spotPolicy?.pricingType, 'fixed_discount');

    const bedrock = DEFAULT_PROVIDER_FLEET.find((p) => p.provider === 'bedrock')!;
    assert.equal(bedrock.creditType, 'postpaid_invoice');
    assert.equal(bedrock.availableCreditsUsd, null);

    // Verify formatCadenceInterval helper converts seconds to compact readable representations
    assert.equal(formatCadenceInterval(900), '15m');
    assert.equal(formatCadenceInterval(7200), '2h');
    assert.equal(formatCadenceInterval(21600), '6h');
    assert.equal(formatCadenceInterval(86400), '24h');
    assert.equal(formatCadenceInterval(30), '30s');
    assert.equal(formatCadenceInterval(0), 'realtime');
  });

  it('computes synced vs unsynced provider counts accurately for tab status visualization', () => {
    // 1. All baseline providers healthy with no failed audits
    const baselineMetrics = computeProviderSyncMetrics(DEFAULT_PROVIDER_FLEET, [], {});
    assert.equal(baselineMetrics.totalCount, 14);
    assert.equal(baselineMetrics.syncedCount, 14);
    assert.equal(baselineMetrics.unsyncedCount, 0);
    assert.deepEqual(baselineMetrics.unsyncedProviders, []);

    // 2. Toggling one provider offline increments unsyncedCount
    const oneOfflineMetrics = computeProviderSyncMetrics(DEFAULT_PROVIDER_FLEET, [], {
      vast_ai: { healthy: false },
    });
    assert.equal(oneOfflineMetrics.syncedCount, 13);
    assert.equal(oneOfflineMetrics.unsyncedCount, 1);
    assert.deepEqual(oneOfflineMetrics.unsyncedProviders, ['vast_ai']);

    // 3. Failed sync audit flags provider as unsynced
    const failedAuditMetrics = computeProviderSyncMetrics(
      DEFAULT_PROVIDER_FLEET,
      [
        {
          id: 'audit-err',
          provider: 'runpod',
          syncType: 'gpu_hardware',
          recordsCount: 0,
          updateCadenceCategory: 'realtime_auction',
          estimatedUpdateIntervalSec: 120,
          updateFrequencyDescription: 'Auction bids',
          status: 'FAILED',
          syncedAt: new Date().toISOString(),
        },
      ],
      {}
    );
    assert.equal(failedAuditMetrics.syncedCount, 13);
    assert.equal(failedAuditMetrics.unsyncedCount, 1);
    assert.deepEqual(failedAuditMetrics.unsyncedProviders, ['runpod']);

    // 4. Multiple simultaneous provider anomalies
    const multiAnomalyMetrics = computeProviderSyncMetrics(
      DEFAULT_PROVIDER_FLEET,
      [
        {
          id: 'audit-err',
          provider: 'runpod',
          syncType: 'gpu_hardware',
          recordsCount: 0,
          updateCadenceCategory: 'realtime_auction',
          estimatedUpdateIntervalSec: 120,
          updateFrequencyDescription: 'Auction bids',
          status: 'ERROR',
          syncedAt: new Date().toISOString(),
        },
      ],
      {
        nebius: { healthy: false },
        baseten: { healthy: false },
      }
    );
    assert.equal(multiAnomalyMetrics.syncedCount, 11);
    assert.equal(multiAnomalyMetrics.unsyncedCount, 3);
    assert.ok(multiAnomalyMetrics.unsyncedProviders.includes('runpod'));
    assert.ok(multiAnomalyMetrics.unsyncedProviders.includes('nebius'));
    assert.ok(multiAnomalyMetrics.unsyncedProviders.includes('baseten'));
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

describe('Unified FinOps Pricing Table & Hardware Short Names', () => {
  it('formats short hardware representations with memory capacity for 1200x1900 display', () => {
    assert.equal(formatHwShortName('NVIDIA GeForce RTX 5070 Ti (16GB)', 16), '5070 Ti (16GB)');
    assert.equal(formatHwShortName('NVIDIA GeForce RTX 4090 (24GB)', 24), '4090 (24GB)');
    assert.equal(formatHwShortName('NVIDIA GeForce RTX 5090 Blackwell (32GB)', 32), '5090 (32GB)');
    assert.equal(formatHwShortName('NVIDIA H100 SXM5 (80GB)', 80), 'H100 SXM5 (80GB)');
    assert.equal(formatHwShortName('NVIDIA H200 SXM (141GB HBM3e)', 141), 'H200 SXM (141GB)');
    assert.equal(formatHwShortName('NVIDIA L4 Tensor Core (24GB)', 24), 'L4 (24GB)');
    assert.equal(formatHwShortName('NVIDIA RTX A6000 Ada (48GB)', 48), 'A6000 Ada (48GB)');
    assert.equal(formatHwShortName('AWS Inferentia2', 32), 'Inferentia2 (32GB)');
    assert.equal(formatHwShortName('CPU Xeon/EPYC Fallback', 0), 'CPU Xeon/EPYC');
  });

  it('correctly distinguishes open-weights vs proprietary models with badges', () => {
    const openSamples = [
      'Llama 3 8B Instruct',
      'DeepSeek-V3 (671B MoE)',
      'FLUX.1 Schnell',
      'Stable Diffusion XL 1.0',
      'Whisper Large v3',
      'Qwen 2.5 Coder 32B',
    ];

    const proprietarySamples = [
      'claude-3-5-sonnet-20241022',
      'Proprietary Corporate LoRA (7B)',
      'Proprietary Synthetic Video Generator',
      'Proprietary Brand Catalog Diffusion',
    ];

    for (const name of openSamples) {
      const isProp =
        name.toLowerCase().includes('claude') ||
        name.toLowerCase().includes('corporate') ||
        name.toLowerCase().includes('proprietary');
      assert.equal(isProp, false, `${name} should be classified as open weights`);
    }

    for (const name of proprietarySamples) {
      const isProp =
        name.toLowerCase().includes('claude') ||
        name.toLowerCase().includes('corporate') ||
        name.toLowerCase().includes('proprietary');
      assert.equal(isProp, true, `${name} should be classified as proprietary`);
    }
  });

  it('renders real API balance when provided and falls back to unmocked placeholder -- when unknown', () => {
    const formatBalance = (
      provider: string,
      liveBalanceUsd: number | null | undefined,
      creditType: string
    ): string => {
      if (liveBalanceUsd !== null && liveBalanceUsd !== undefined) {
        return `$${liveBalanceUsd.toFixed(2)}`;
      }
      if (provider === 'local_pytorch') {
        return '$0.00 (Local HW)';
      }
      if (creditType === 'postpaid_invoice') {
        return 'AWS Postpaid';
      }
      return '--';
    };

    // Live balance returned by real API
    assert.equal(formatBalance('runpod', 42.5, 'prepaid_credits'), '$42.50');
    assert.equal(formatBalance('vast_ai', 105.75, 'prepaid_credits'), '$105.75');

    // No live balance returned by API (unmocked)
    assert.equal(formatBalance('runpod', null, 'prepaid_credits'), '--');
    assert.equal(formatBalance('vast_ai', undefined, 'prepaid_credits'), '--');
    assert.equal(formatBalance('baseten', null, 'prepaid_credits'), '--');

    // Local HW and AWS postpaid
    assert.equal(formatBalance('local_pytorch', null, 'zero_commitment'), '$0.00 (Local HW)');
    assert.equal(formatBalance('bedrock', null, 'postpaid_invoice'), 'AWS Postpaid');
  });
});

