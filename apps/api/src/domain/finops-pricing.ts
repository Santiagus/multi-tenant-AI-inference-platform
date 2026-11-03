/**
 * Domain definitions for FinOps & Neocloud Pricing, GPU Availability & Token Factory Intelligence.
 */

export type GpuPricingModel = 'on_demand' | 'spot_bid' | 'preemptible' | 'serverless';

export interface GpuPricingSnapshot {
  id: string;
  provider: string; // 'runpod', 'vast_ai', 'baseten', 'nebius', 'modal', 'beam'
  hardwareSkuId: string; // 'nvidia-h100-sxm', 'nvidia-a100-80gb', 'nvidia-rtx-4090', etc.
  hardwareDisplayName: string;
  vramGb: number;
  zone: string;
  pricingModel: GpuPricingModel;
  rateMicrocents: number;
  billingUnit: 'second' | 'minute' | 'hour';
  normalizedHourlyMicrocents: number;
  normalizedHourlyUsd: number;
  obtainabilityScore: number; // 0.00 to 1.00
  obtainabilityLabel: 'High' | 'Medium' | 'Low' | 'Out of Stock';
  interruptionRiskTier: '<5%' | '5-10%' | '10-20%' | '>20%' | 'guaranteed';
  isAvailable: boolean;
  commitment: string; // e.g. '$0 Pay-as-you-go'
  recordedAt: string;
}

export type ModelExecutionType = 'token_factory' | 'serverless_endpoint' | 'pay_per_call';

export interface ModelPricingSnapshot {
  id: string;
  provider: string; // 'jarvislabs', 'nebius', 'fal', 'runware', 'bedrock'
  modelId: string;
  modelName: string;
  developer: string; // 'DeepSeek', 'Google', 'Alibaba', 'Z.ai', 'Black Forest Labs', 'Meta'
  executionType: ModelExecutionType;
  inputTokenPriceMicrocents?: number;
  outputTokenPriceMicrocents?: number;
  cachedInputTokenPriceMicrocents?: number;
  inputPricePerMillionUsd?: number;
  outputPricePerMillionUsd?: number;
  cachedPricePerMillionUsd?: number;
  perUnitPriceMicrocents?: number;
  perUnitUsd?: number;
  unitType: 'token_1m' | 'megapixel' | 'compute_second';
  contextLength?: number;
  isAvailable: boolean;
  recordedAt: string;
}

export type UpdateCadenceCategory = 'realtime_auction' | 'dynamic_shifts' | 'scheduled';

export interface PricingSyncAudit {
  id: string;
  provider: string;
  syncType: string;
  recordsCount: number;
  updateCadenceCategory: UpdateCadenceCategory;
  estimatedUpdateIntervalSec: number;
  updateFrequencyDescription: string;
  status: string;
  syncedAt: string;
}

export interface PricingHistoryPoint {
  recordedAt: string;
  priceUsd: number;
  spotPriceUsd?: number;
  availability: string;
}

export interface PricingHistorySummary {
  provider: string;
  itemType: 'gpu' | 'model';
  itemId: string;
  displayName: string;
  updateCadence: string;
  estimatedUpdateFrequencyMinutes: number;
  latestPriceUsd: number;
  priceChange24hPct: number;
  history: PricingHistoryPoint[];
}

