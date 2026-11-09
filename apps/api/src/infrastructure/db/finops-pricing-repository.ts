import type {
  GpuPricingSnapshot,
  ModelPricingSnapshot,
  PricingSyncAudit,
  PricingHistorySummary,
  PricingHistoryPoint,
} from '../../domain/finops-pricing.js';
import { REAL_HISTORICAL_PRICING } from '../finops/real-historical-prices.js';

export interface IFinOpsPricingRepository {
  getLatestGpuPricing(filters?: {
    provider?: string;
    hardwareSkuId?: string;
    pricingModel?: string;
  }): Promise<GpuPricingSnapshot[]>;

  getLatestModelPricing(filters?: {
    provider?: string;
    executionType?: string;
  }): Promise<ModelPricingSnapshot[]>;

  getPricingHistory(options?: {
    provider?: string;
    itemId?: string;
    hours?: number;
  }): Promise<PricingHistorySummary[]>;

  getSyncAudits(): Promise<PricingSyncAudit[]>;

  syncFromProviders(options?: {
    providers?: string[];
  }): Promise<{
    syncedProviders: string[];
    failedProviders?: Array<{ provider: string; error?: string; status: string; syncType?: string; details?: any }>;
    auditRecords?: any[];
    recordsCount: number;
    syncedAt: string;
  }>;

  ensureHistoricalSnapshots?(): Promise<number>;
}

export class InMemoryFinOpsPricingRepository implements IFinOpsPricingRepository {
  private gpuSnapshots: GpuPricingSnapshot[] = [];
  private modelSnapshots: ModelPricingSnapshot[] = [];
  private syncAudits: PricingSyncAudit[] = [];
  private historySummaries: PricingHistorySummary[] = [];

  constructor() {
    this.seedBaselinePricing();
  }

  private seedBaselinePricing(): void {
    const now = new Date();
    const isoNow = now.toISOString();

    // 1. GPU Availability and Pricing per Provider (On-Demand, Spot, Serverless)
    this.gpuSnapshots = [
      // RunPod
      {
        id: 'gpu-rp-1',
        provider: 'runpod',
        hardwareSkuId: 'nvidia-h100-sxm',
        hardwareDisplayName: 'NVIDIA H100 SXM5 80GB',
        vramGb: 80,
        zone: 'runpod-secure-us-1',
        pricingModel: 'on_demand',
        rateMicrocents: 299000000, // $2.99/hr
        billingUnit: 'hour',
        normalizedHourlyMicrocents: 299000000,
        normalizedHourlyUsd: 2.99,
        obtainabilityScore: 0.85,
        obtainabilityLabel: 'High',
        interruptionRiskTier: 'guaranteed',
        isAvailable: true,
        commitment: '$0 Pay-as-you-go',
        recordedAt: isoNow,
      },
      {
        id: 'gpu-rp-2',
        provider: 'runpod',
        hardwareSkuId: 'nvidia-h100-sxm',
        hardwareDisplayName: 'NVIDIA H100 SXM5 80GB',
        vramGb: 80,
        zone: 'runpod-community-us',
        pricingModel: 'spot_bid',
        rateMicrocents: 199000000, // $1.99/hr
        billingUnit: 'hour',
        normalizedHourlyMicrocents: 199000000,
        normalizedHourlyUsd: 1.99,
        obtainabilityScore: 0.65,
        obtainabilityLabel: 'Medium',
        interruptionRiskTier: '10-20%',
        isAvailable: true,
        commitment: '$0 Pay-as-you-go',
        recordedAt: isoNow,
      },
      {
        id: 'gpu-rp-3',
        provider: 'runpod',
        hardwareSkuId: 'nvidia-a100-80gb',
        hardwareDisplayName: 'NVIDIA A100 Tensor Core 80GB',
        vramGb: 80,
        zone: 'runpod-secure-us-2',
        pricingModel: 'on_demand',
        rateMicrocents: 179000000, // $1.79/hr
        billingUnit: 'hour',
        normalizedHourlyMicrocents: 179000000,
        normalizedHourlyUsd: 1.79,
        obtainabilityScore: 0.9,
        obtainabilityLabel: 'High',
        interruptionRiskTier: 'guaranteed',
        isAvailable: true,
        commitment: '$0 Pay-as-you-go',
        recordedAt: isoNow,
      },
      {
        id: 'gpu-rp-4',
        provider: 'runpod',
        hardwareSkuId: 'nvidia-a100-80gb',
        hardwareDisplayName: 'NVIDIA A100 Tensor Core 80GB',
        vramGb: 80,
        zone: 'runpod-community-us',
        pricingModel: 'spot_bid',
        rateMicrocents: 119000000, // $1.19/hr
        billingUnit: 'hour',
        normalizedHourlyMicrocents: 119000000,
        normalizedHourlyUsd: 1.19,
        obtainabilityScore: 0.7,
        obtainabilityLabel: 'Medium',
        interruptionRiskTier: '5-10%',
        isAvailable: true,
        commitment: '$0 Pay-as-you-go',
        recordedAt: isoNow,
      },
      {
        id: 'gpu-rp-5',
        provider: 'runpod',
        hardwareSkuId: 'nvidia-a100-80gb',
        hardwareDisplayName: 'NVIDIA A100 Tensor Core 80GB',
        vramGb: 80,
        zone: 'runpod-serverless-global',
        pricingModel: 'serverless',
        rateMicrocents: 272000000, // $2.72/hr (millisecond metered)
        billingUnit: 'second',
        normalizedHourlyMicrocents: 272000000,
        normalizedHourlyUsd: 2.72,
        obtainabilityScore: 0.95,
        obtainabilityLabel: 'High',
        interruptionRiskTier: 'guaranteed',
        isAvailable: true,
        commitment: 'Scale-to-zero ($0 min)',
        recordedAt: isoNow,
      },
      {
        id: 'gpu-rp-6',
        provider: 'runpod',
        hardwareSkuId: 'nvidia-rtx-4090',
        hardwareDisplayName: 'NVIDIA GeForce RTX 4090',
        vramGb: 24,
        zone: 'runpod-community-eu',
        pricingModel: 'spot_bid',
        rateMicrocents: 34000000, // $0.34/hr
        billingUnit: 'hour',
        normalizedHourlyMicrocents: 34000000,
        normalizedHourlyUsd: 0.34,
        obtainabilityScore: 0.8,
        obtainabilityLabel: 'High',
        interruptionRiskTier: '5-10%',
        isAvailable: true,
        commitment: '$0 Pay-as-you-go',
        recordedAt: isoNow,
      },

      // Vast.ai
      {
        id: 'gpu-vast-1',
        provider: 'vast_ai',
        hardwareSkuId: 'nvidia-rtx-5090',
        hardwareDisplayName: 'NVIDIA GeForce RTX 5090',
        vramGb: 32,
        zone: 'vast-datacenter-us-east',
        pricingModel: 'on_demand',
        rateMicrocents: 45600000, // $0.456/hr
        billingUnit: 'hour',
        normalizedHourlyMicrocents: 45600000,
        normalizedHourlyUsd: 0.456,
        obtainabilityScore: 0.75,
        obtainabilityLabel: 'Medium',
        interruptionRiskTier: 'guaranteed',
        isAvailable: true,
        commitment: '$0 Pay-as-you-go',
        recordedAt: isoNow,
      },
      {
        id: 'gpu-vast-2',
        provider: 'vast_ai',
        hardwareSkuId: 'nvidia-rtx-5090',
        hardwareDisplayName: 'NVIDIA GeForce RTX 5090',
        vramGb: 32,
        zone: 'vast-auction-pool',
        pricingModel: 'spot_bid',
        rateMicrocents: 24000000, // $0.240/hr (auction bid)
        billingUnit: 'hour',
        normalizedHourlyMicrocents: 24000000,
        normalizedHourlyUsd: 0.24,
        obtainabilityScore: 0.6,
        obtainabilityLabel: 'Medium',
        interruptionRiskTier: '10-20%',
        isAvailable: true,
        commitment: '$0 Pay-as-you-go',
        recordedAt: isoNow,
      },
      {
        id: 'gpu-vast-3',
        provider: 'vast_ai',
        hardwareSkuId: 'nvidia-rtx-4090',
        hardwareDisplayName: 'NVIDIA GeForce RTX 4090',
        vramGb: 24,
        zone: 'vast-auction-pool',
        pricingModel: 'spot_bid',
        rateMicrocents: 21000000, // $0.210/hr
        billingUnit: 'hour',
        normalizedHourlyMicrocents: 21000000,
        normalizedHourlyUsd: 0.21,
        obtainabilityScore: 0.88,
        obtainabilityLabel: 'High',
        interruptionRiskTier: '5-10%',
        isAvailable: true,
        commitment: '$0 Pay-as-you-go',
        recordedAt: isoNow,
      },

      // Baseten
      {
        id: 'gpu-base-1',
        provider: 'baseten',
        hardwareSkuId: 'nvidia-h100-sxm',
        hardwareDisplayName: 'NVIDIA H100 SXM5 80GB',
        vramGb: 80,
        zone: 'baseten-us-east-1',
        pricingModel: 'serverless',
        rateMicrocents: 650000000, // $0.10833/min = $6.50/hr
        billingUnit: 'minute',
        normalizedHourlyMicrocents: 650000000,
        normalizedHourlyUsd: 6.5,
        obtainabilityScore: 0.95,
        obtainabilityLabel: 'High',
        interruptionRiskTier: 'guaranteed',
        isAvailable: true,
        commitment: 'Scale-to-zero ($0 min)',
        recordedAt: isoNow,
      },
      {
        id: 'gpu-base-2',
        provider: 'baseten',
        hardwareSkuId: 'nvidia-l4',
        hardwareDisplayName: 'NVIDIA L4 Tensor Core',
        vramGb: 24,
        zone: 'baseten-us-east-1',
        pricingModel: 'serverless',
        rateMicrocents: 84840000, // $0.01414/min = $0.848/hr
        billingUnit: 'minute',
        normalizedHourlyMicrocents: 84840000,
        normalizedHourlyUsd: 0.848,
        obtainabilityScore: 0.99,
        obtainabilityLabel: 'High',
        interruptionRiskTier: 'guaranteed',
        isAvailable: true,
        commitment: 'Scale-to-zero ($0 min)',
        recordedAt: isoNow,
      },

      // Nebius AI Cloud
      {
        id: 'gpu-neb-1',
        provider: 'nebius',
        hardwareSkuId: 'nvidia-h100-sxm',
        hardwareDisplayName: 'NVIDIA H100 SXM5 80GB',
        vramGb: 80,
        zone: 'eu-west-1 (Finland)',
        pricingModel: 'on_demand',
        rateMicrocents: 295000000, // $2.95/hr
        billingUnit: 'hour',
        normalizedHourlyMicrocents: 295000000,
        normalizedHourlyUsd: 2.95,
        obtainabilityScore: 0.92,
        obtainabilityLabel: 'High',
        interruptionRiskTier: 'guaranteed',
        isAvailable: true,
        commitment: 'Sovereign EU ($0 commit)',
        recordedAt: isoNow,
      },
      {
        id: 'gpu-neb-2',
        provider: 'nebius',
        hardwareSkuId: 'nvidia-l40s',
        hardwareDisplayName: 'NVIDIA L40S',
        vramGb: 48,
        zone: 'eu-west-1 (Finland)',
        pricingModel: 'on_demand',
        rateMicrocents: 180000000, // $1.80/hr
        billingUnit: 'hour',
        normalizedHourlyMicrocents: 180000000,
        normalizedHourlyUsd: 1.8,
        obtainabilityScore: 0.96,
        obtainabilityLabel: 'High',
        interruptionRiskTier: 'guaranteed',
        isAvailable: true,
        commitment: 'Sovereign EU ($0 commit)',
        recordedAt: isoNow,
      },
      // Local Workstation
      {
        id: 'gpu-local-1',
        provider: 'local_pytorch',
        hardwareSkuId: 'nvidia-rtx-5070-ti',
        hardwareDisplayName: 'RTX 5070 Ti (16GB)',
        vramGb: 16,
        zone: 'local-workstation',
        pricingModel: 'on_demand',
        rateMicrocents: 0,
        billingUnit: 'hour',
        normalizedHourlyMicrocents: 0,
        normalizedHourlyUsd: 0.0,
        obtainabilityScore: 1.0,
        obtainabilityLabel: 'High',
        interruptionRiskTier: 'guaranteed',
        isAvailable: true,
        commitment: 'Dedicated Local ($0 cloud)',
        recordedAt: isoNow,
      },
      // AWS SageMaker
      {
        id: 'gpu-sm-1',
        provider: 'sagemaker',
        hardwareSkuId: 'nvidia-h100-sxm',
        hardwareDisplayName: 'H100 SXM5 (80GB)',
        vramGb: 80,
        zone: 'us-east-1',
        pricingModel: 'on_demand',
        rateMicrocents: 367000000,
        billingUnit: 'hour',
        normalizedHourlyMicrocents: 367000000,
        normalizedHourlyUsd: 3.67,
        obtainabilityScore: 0.95,
        obtainabilityLabel: 'High',
        interruptionRiskTier: 'guaranteed',
        isAvailable: true,
        commitment: 'Enterprise SLA ($0 min)',
        recordedAt: isoNow,
      },
      // CoreWeave
      {
        id: 'gpu-cw-1',
        provider: 'coreweave',
        hardwareSkuId: 'nvidia-h100-sxm',
        hardwareDisplayName: 'H100 SXM5 (80GB)',
        vramGb: 80,
        zone: 'us-ord-1',
        pricingModel: 'on_demand',
        rateMicrocents: 315000000,
        billingUnit: 'hour',
        normalizedHourlyMicrocents: 315000000,
        normalizedHourlyUsd: 3.15,
        obtainabilityScore: 0.9,
        obtainabilityLabel: 'High',
        interruptionRiskTier: 'guaranteed',
        isAvailable: true,
        commitment: 'Reserved / Dynamic ($0 commit)',
        recordedAt: isoNow,
      },
      // Hivenet Elastic P2P
      {
        id: 'gpu-hive-1',
        provider: 'hivenet',
        hardwareSkuId: 'nvidia-rtx-4090',
        hardwareDisplayName: 'RTX 4090 (24GB)',
        vramGb: 24,
        zone: 'global-p2p',
        pricingModel: 'spot_bid',
        rateMicrocents: 40000000,
        billingUnit: 'hour',
        normalizedHourlyMicrocents: 40000000,
        normalizedHourlyUsd: 0.40,
        obtainabilityScore: 0.85,
        obtainabilityLabel: 'High',
        interruptionRiskTier: '5-10%',
        isAvailable: true,
        commitment: 'P2P Grid ($0 commit)',
        recordedAt: isoNow,
      },
    ];

    // 2. Open Models & Token Factory Availability & Pricing
    this.modelSnapshots = [
      // JarvisLabs Token Factory
      {
        id: 'mod-jl-1',
        provider: 'jarvislabs',
        modelId: 'deepseek-v4.1-flash-1017',
        modelName: 'DeepSeek V4.1 Flash',
        developer: 'DeepSeek',
        executionType: 'token_factory',
        inputTokenPriceMicrocents: 7000000, // $0.07 / 1M tokens
        outputTokenPriceMicrocents: 49000000, // $0.49 / 1M tokens
        cachedInputTokenPriceMicrocents: 300000, // $0.003 / 1M tokens
        inputPricePerMillionUsd: 0.07,
        outputPricePerMillionUsd: 0.49,
        cachedPricePerMillionUsd: 0.003,
        unitType: 'token_1m',
        contextLength: 1048576, // 1M context
        isAvailable: true,
        recordedAt: isoNow,
      },
      {
        id: 'mod-jl-2',
        provider: 'jarvislabs',
        modelId: 'gemma-4-26b-a4b-it',
        modelName: 'Gemma 4 26B A4B IT',
        developer: 'Google',
        executionType: 'token_factory',
        inputTokenPriceMicrocents: 11000000, // $0.11 / 1M tokens
        outputTokenPriceMicrocents: 37000000, // $0.37 / 1M tokens
        cachedInputTokenPriceMicrocents: 5000000, // $0.05 / 1M tokens
        inputPricePerMillionUsd: 0.11,
        outputPricePerMillionUsd: 0.37,
        cachedPricePerMillionUsd: 0.05,
        unitType: 'token_1m',
        contextLength: 262144,
        isAvailable: true,
        recordedAt: isoNow,
      },
      {
        id: 'mod-jl-3',
        provider: 'jarvislabs',
        modelId: 'glm-5.3-flash',
        modelName: 'GLM 5.3 Flash',
        developer: 'Z.ai',
        executionType: 'token_factory',
        inputTokenPriceMicrocents: 14000000, // $0.14 / 1M tokens
        outputTokenPriceMicrocents: 45000000, // $0.45 / 1M tokens
        cachedInputTokenPriceMicrocents: 3000000, // $0.03 / 1M tokens
        inputPricePerMillionUsd: 0.14,
        outputPricePerMillionUsd: 0.45,
        cachedPricePerMillionUsd: 0.03,
        unitType: 'token_1m',
        contextLength: 1048576,
        isAvailable: true,
        recordedAt: isoNow,
      },
      {
        id: 'mod-jl-4',
        provider: 'jarvislabs',
        modelId: 'qwen-3.8-27b-fp8',
        modelName: 'Qwen 3.8 27B FP8',
        developer: 'Alibaba',
        executionType: 'token_factory',
        inputTokenPriceMicrocents: 30000000, // $0.30 / 1M tokens
        outputTokenPriceMicrocents: 235000000, // $2.35 / 1M tokens
        cachedInputTokenPriceMicrocents: 8000000, // $0.08 / 1M tokens
        inputPricePerMillionUsd: 0.3,
        outputPricePerMillionUsd: 2.35,
        cachedPricePerMillionUsd: 0.08,
        unitType: 'token_1m',
        contextLength: 262144,
        isAvailable: true,
        recordedAt: isoNow,
      },

      // Nebius AI Studio Token Factory
      {
        id: 'mod-neb-1',
        provider: 'nebius',
        modelId: 'Qwen/Qwen3-235B-A22B-Instruct-2507',
        modelName: 'Qwen3 235B MoE Instruct',
        developer: 'Alibaba',
        executionType: 'token_factory',
        inputTokenPriceMicrocents: 25000000, // $0.25 / 1M tokens
        outputTokenPriceMicrocents: 95000000, // $0.95 / 1M tokens
        cachedInputTokenPriceMicrocents: 5000000,
        inputPricePerMillionUsd: 0.25,
        outputPricePerMillionUsd: 0.95,
        cachedPricePerMillionUsd: 0.05,
        unitType: 'token_1m',
        contextLength: 131072,
        isAvailable: true,
        recordedAt: isoNow,
      },
      {
        id: 'mod-neb-2',
        provider: 'nebius',
        modelId: 'google/gemma-3-27b-it',
        modelName: 'Gemma 3 27B IT',
        developer: 'Google',
        executionType: 'token_factory',
        inputTokenPriceMicrocents: 18000000, // $0.18 / 1M tokens
        outputTokenPriceMicrocents: 55000000, // $0.55 / 1M tokens
        cachedInputTokenPriceMicrocents: 4000000,
        inputPricePerMillionUsd: 0.18,
        outputPricePerMillionUsd: 0.55,
        cachedPricePerMillionUsd: 0.04,
        unitType: 'token_1m',
        contextLength: 131072,
        isAvailable: true,
        recordedAt: isoNow,
      },

      // fal.ai Media Models
      {
        id: 'mod-fal-1',
        provider: 'fal',
        modelId: 'fal-ai/flux/schnell',
        modelName: 'FLUX.1 [schnell]',
        developer: 'Black Forest Labs',
        executionType: 'pay_per_call',
        perUnitPriceMicrocents: 300000, // $0.003 / megapixel
        perUnitUsd: 0.003,
        unitType: 'megapixel',
        isAvailable: true,
        recordedAt: isoNow,
      },
      {
        id: 'mod-fal-2',
        provider: 'fal',
        modelId: 'fal-ai/flux-pro',
        modelName: 'FLUX.1 [pro]',
        developer: 'Black Forest Labs',
        executionType: 'pay_per_call',
        perUnitPriceMicrocents: 5000000, // $0.05 / megapixel
        perUnitUsd: 0.05,
        unitType: 'megapixel',
        isAvailable: true,
        recordedAt: isoNow,
      },
      {
        id: 'mod-fal-3',
        provider: 'fal',
        modelId: 'fal-ai/whisper',
        modelName: 'OpenAI Whisper Large v3',
        developer: 'OpenAI',
        executionType: 'pay_per_call',
        perUnitPriceMicrocents: 111111, // $0.00111 / compute second ($0.066 / min)
        perUnitUsd: 0.00111,
        unitType: 'compute_second',
        isAvailable: true,
        recordedAt: isoNow,
      },

      // Runware Media Models
      {
        id: 'mod-rw-1',
        provider: 'runware',
        modelId: 'runware:100@1',
        modelName: 'FLUX.1 [schnell] Accelerated',
        developer: 'Black Forest Labs',
        executionType: 'pay_per_call',
        perUnitPriceMicrocents: 180000, // ~$0.0018 / megapixel ($0.0006 standard)
        perUnitUsd: 0.0018,
        unitType: 'megapixel',
        isAvailable: true,
        recordedAt: isoNow,
      },
    ];

    // 3. Pricing Update Cadence & Audits
    this.syncAudits = [
      {
        id: 'audit-1',
        provider: 'vast_ai',
        syncType: 'gpu_hardware',
        recordsCount: 64,
        updateCadenceCategory: 'realtime_auction',
        estimatedUpdateIntervalSec: 300, // 5 minutes
        updateFrequencyDescription: 'Continuous dynamic auction bids (~every 5 mins)',
        status: 'SUCCESS',
        syncedAt: isoNow,
      },
      {
        id: 'audit-2',
        provider: 'runpod',
        syncType: 'gpu_hardware',
        recordsCount: 28,
        updateCadenceCategory: 'dynamic_shifts',
        estimatedUpdateIntervalSec: 3600, // 1 hour
        updateFrequencyDescription: 'Community pool dynamic availability & price shifts (~hourly)',
        status: 'SUCCESS',
        syncedAt: isoNow,
      },
      {
        id: 'audit-3',
        provider: 'baseten',
        syncType: 'gpu_hardware',
        recordsCount: 22,
        updateCadenceCategory: 'scheduled',
        estimatedUpdateIntervalSec: 86400, // 24 hours
        updateFrequencyDescription: 'Catalog instance type schedule (~daily to monthly)',
        status: 'SUCCESS',
        syncedAt: isoNow,
      },
      {
        id: 'audit-4',
        provider: 'jarvislabs',
        syncType: 'model_tokens',
        recordsCount: 8,
        updateCadenceCategory: 'scheduled',
        estimatedUpdateIntervalSec: 43200, // 12 hours
        updateFrequencyDescription: 'Managed Token Factory model roster & token billing (~twice daily)',
        status: 'SUCCESS',
        syncedAt: isoNow,
      },
      {
        id: 'audit-5',
        provider: 'nebius',
        syncType: 'model_tokens',
        recordsCount: 30,
        updateCadenceCategory: 'scheduled',
        estimatedUpdateIntervalSec: 86400, // 24 hours
        updateFrequencyDescription: 'Nebius Studio Token Factory rates (~daily)',
        status: 'SUCCESS',
        syncedAt: isoNow,
      },
    ];

    // 4. Historical Pricing Data & Cadence Curves (7 Days History across Providers Grounded in Real Open Datasets)
    const nowMs = Date.now();
    const gpuSummaries: PricingHistorySummary[] = REAL_HISTORICAL_PRICING.records.map((rec) => {
      const latestDayPoint = rec.dailyPoints[rec.dailyPoints.length - 1];
      const earliestDayPoint = rec.dailyPoints[0];
      const latestPriceUsd = latestDayPoint ? latestDayPoint.usdHr : 0.50;
      const earliestPriceUsd = earliestDayPoint ? earliestDayPoint.usdHr : latestPriceUsd;
      const priceChange24hPct = earliestPriceUsd > 0
        ? Math.round(((latestPriceUsd - earliestPriceUsd) / earliestPriceUsd) * 1000) / 10
        : 0;

      const history: PricingHistoryPoint[] = [];
      for (let h = 168; h >= 0; h--) {
        const t = new Date(nowMs - h * 3600 * 1000);
        const hourUtc = t.getUTCHours();
        const day = t.getUTCDay();
        const isWeekend = day === 0 || day === 6;

        const dayOffset = Math.min(6, Math.max(0, 6 - Math.floor(h / 24)));
        const dayPoint = rec.dailyPoints[dayOffset];
        const baseSpot = dayPoint ? dayPoint.usdHr : latestPriceUsd;

        let spotUsd = 0;
        if (rec.provider === 'local_pytorch') {
          spotUsd = 0;
        } else if (rec.provider === 'sagemaker') {
          spotUsd = baseSpot;
        } else {
          let officeMultiplier: number;
          if (hourUtc >= 13 && hourUtc <= 18) {
            const progress = (hourUtc - 13) / 5;
            officeMultiplier = 1.22 + 0.12 * Math.sin(progress * Math.PI);
          } else if (hourUtc >= 8 && hourUtc < 13) {
            const progress = (hourUtc - 8) / 5;
            officeMultiplier = 0.98 + 0.24 * progress;
          } else if (hourUtc > 18 && hourUtc <= 22) {
            const progress = (hourUtc - 18) / 4;
            officeMultiplier = 1.22 - 0.30 * progress;
          } else {
            const nightProgress = hourUtc > 22 ? (hourUtc - 22) / 10 : (hourUtc + 2) / 10;
            officeMultiplier = 0.84 + 0.08 * Math.sin(nightProgress * Math.PI);
          }
          if (isWeekend) {
            officeMultiplier *= 0.85;
          }
          const hourEpoch = Math.floor(t.getTime() / 3600_000);
          const hash = Math.sin(hourEpoch * 12.9898 + (baseSpot * 78.233)) * 43758.5453;
          const marketNoise = 1 + ((hash - Math.floor(hash)) - 0.5) * 0.05;
          spotUsd = Math.max(0.01, Math.round(baseSpot * officeMultiplier * marketNoise * 100) / 100);
        }

        history.push({
          recordedAt: t.toISOString(),
          priceUsd: spotUsd,
          spotPriceUsd: spotUsd,
          availability: dayPoint?.source ? 'OpenDataset' : 'High',
        });
      }

      return {
        provider: rec.provider,
        itemType: 'gpu',
        itemId: rec.sku,
        displayName: `${rec.sku} (${rec.provider})`,
        updateCadence:
          rec.provider === 'vast_ai'
            ? 'Real-time spot auction (~1 min)'
            : rec.provider === 'runpod'
              ? 'Live spot auction (~2 min)'
              : 'Dynamic Neocloud Datacenter Sync (~5 min)',
        estimatedUpdateFrequencyMinutes: rec.provider === 'vast_ai' ? 5 : rec.provider === 'runpod' ? 2 : 5,
        latestPriceUsd,
        priceChange24hPct,
        history,
      };
    });

    const modelSummaries: PricingHistorySummary[] = [
      {
        provider: 'jarvislabs',
        itemType: 'model',
        itemId: 'deepseek-v4.1-flash',
        displayName: 'DeepSeek V4.1 Flash (JarvisLabs Token Factory Input/1M)',
        updateCadence: 'Weekly model efficiency revision',
        estimatedUpdateFrequencyMinutes: 720,
        latestPriceUsd: 0.14,
        priceChange24hPct: -12.5,
        history: this.generatePoints(0.14, 0.01, 7, 4, 0.07),
      },
      {
        provider: 'nebius',
        itemType: 'model',
        itemId: 'deepseek-v4.1-flash',
        displayName: 'DeepSeek V4.1 Flash (Nebius Studio MaaS)',
        updateCadence: 'Daily Studio Token Factory rates',
        estimatedUpdateFrequencyMinutes: 1440,
        latestPriceUsd: 0.15,
        priceChange24hPct: 0.0,
        history: this.generatePoints(0.15, 0.01, 7, 4, 0.08),
      },
    ];

    this.historySummaries = [...gpuSummaries, ...modelSummaries];
  }

  private generatePoints(
    basePrice: number,
    variance: number,
    days: number,
    pointsPerDay = 24,
    baseSpotPrice?: number
  ): PricingHistoryPoint[] {
    const points: PricingHistoryPoint[] = [];
    const totalPoints = days * pointsPerDay;
    const nowMs = Date.now();
    const intervalMs = (days * 24 * 3600 * 1000) / totalPoints;

    for (let i = totalPoints; i >= 0; i--) {
      const d = new Date(nowMs - i * intervalMs);
      const time = d.toISOString();

      if (basePrice === 0) {
        points.push({
          recordedAt: time,
          priceUsd: 0,
          spotPriceUsd: 0,
          availability: 'Dedicated',
        });
        continue;
      }

      const hourUtc = d.getUTCHours();
      const day = d.getUTCDay();
      const isWeekend = day === 0 || day === 6;

      // Diurnal office-hours demand curve:
      // Peaks between 13:00 - 18:00 UTC (US/EU core office hours), valleys overnight (00:00 - 07:00 UTC)
      let officeMultiplier: number;
      if (hourUtc >= 13 && hourUtc <= 18) {
        const progress = (hourUtc - 13) / 5;
        officeMultiplier = 1.22 + 0.12 * Math.sin(progress * Math.PI);
      } else if (hourUtc >= 8 && hourUtc < 13) {
        const progress = (hourUtc - 8) / 5;
        officeMultiplier = 0.98 + 0.24 * progress;
      } else if (hourUtc > 18 && hourUtc <= 22) {
        const progress = (hourUtc - 18) / 4;
        officeMultiplier = 1.22 - 0.30 * progress;
      } else {
        const nightProgress = hourUtc > 22 ? (hourUtc - 22) / 10 : (hourUtc + 2) / 10;
        officeMultiplier = 0.84 + 0.08 * Math.sin(nightProgress * Math.PI);
      }

      if (isWeekend) {
        officeMultiplier *= 0.85;
      }

      const hourEpoch = Math.floor(d.getTime() / 3600_000);
      const hash = Math.sin(hourEpoch * 12.9898 + basePrice * 37.1) * 43758.5453;
      const noise = ((hash - Math.floor(hash)) - 0.5) * variance;

      const targetSpot = (baseSpotPrice ?? +(basePrice * 0.65)) * officeMultiplier + noise;
      const onDemand = Math.max(0.01, +(basePrice).toFixed(4));
      const spot = Math.max(0.01, +(targetSpot).toFixed(4));

      points.push({
        recordedAt: time,
        priceUsd: onDemand,
        spotPriceUsd: spot,
        availability: spot < targetSpot * 1.05 ? 'High' : 'Medium',
      });
    }
    return points;
  }

  async getLatestGpuPricing(filters?: {
    provider?: string;
    hardwareSkuId?: string;
    pricingModel?: string;
  }): Promise<GpuPricingSnapshot[]> {
    let result = [...this.gpuSnapshots];
    if (filters?.provider) {
      result = result.filter((g) => g.provider.toLowerCase() === filters.provider!.toLowerCase());
    }
    if (filters?.hardwareSkuId) {
      result = result.filter((g) => g.hardwareSkuId.toLowerCase() === filters.hardwareSkuId!.toLowerCase());
    }
    if (filters?.pricingModel) {
      result = result.filter((g) => g.pricingModel === filters.pricingModel);
    }
    return result;
  }

  async getLatestModelPricing(filters?: {
    provider?: string;
    executionType?: string;
  }): Promise<ModelPricingSnapshot[]> {
    let result = [...this.modelSnapshots];
    if (filters?.provider) {
      result = result.filter((m) => m.provider.toLowerCase() === filters.provider!.toLowerCase());
    }
    if (filters?.executionType) {
      result = result.filter((m) => m.executionType === filters.executionType);
    }
    return result;
  }

  async getPricingHistory(options?: {
    provider?: string;
    itemId?: string;
    hours?: number;
  }): Promise<PricingHistorySummary[]> {
    let result = [...this.historySummaries];
    if (options?.provider) {
      result = result.filter((h) => h.provider.toLowerCase() === options.provider!.toLowerCase());
    }
    if (options?.itemId) {
      result = result.filter((h) => h.itemId.toLowerCase() === options.itemId!.toLowerCase());
    }
    if (options?.hours && options.hours > 0) {
      const cutoff = Date.now() - options.hours * 3600 * 1000;
      result = result.map((h) => ({
        ...h,
        history: h.history.filter((pt) => {
          const t = Date.parse(pt.recordedAt);
          return !Number.isNaN(t) && t >= cutoff;
        }),
      }));
    }
    return result;
  }

  async getSyncAudits(): Promise<PricingSyncAudit[]> {
    return [...this.syncAudits];
  }

  async syncFromProviders(options?: {
    providers?: string[];
  }): Promise<{
    syncedProviders: string[];
    failedProviders?: Array<{ provider: string; error?: string; status: string; syncType?: string; details?: any }>;
    auditRecords?: any[];
    recordsCount: number;
    syncedAt: string;
  }> {
    const all = ['runpod', 'vast_ai', 'baseten', 'jarvislabs', 'nebius', 'fal', 'runware'];
    const requested = options?.providers ? options.providers.map((p) => p.toLowerCase()) : null;
    const syncedProviders = requested ? all.filter((p) => requested.includes(p)) : all;
    const now = new Date().toISOString();
    return {
      syncedProviders,
      failedProviders: [],
      auditRecords: this.syncAudits.filter((a) => !requested || requested.includes(a.provider.toLowerCase())),
      recordsCount: this.gpuSnapshots.length + this.modelSnapshots.length,
      syncedAt: now,
    };
  }

  async ensureHistoricalSnapshots(): Promise<number> {
    return this.historySummaries.length;
  }
}

