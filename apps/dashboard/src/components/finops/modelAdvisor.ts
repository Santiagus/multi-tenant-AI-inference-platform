import type { CuratedModelDefinition, GpuPricingItem, ModelPricingItem } from '../../types';

/**
 * Model-first hardware ranking backed by standardized public benchmark references.
 * All throughput (tok/s) and $/1M tok values are ESTIMATED from public benchmark suites
 * (MLPerf Inference, Artificial Analysis, VBench, GenEval, Open ASR, LiveCodeBench)
 * scaled by model size and GPU Tensor Core tier.
 */

/** Providers that offer private-network (VPC) isolation. */
export const VPC_CAPABLE_PROVIDERS = ['local_pytorch', 'sagemaker', 'bedrock', 'baseten', 'nebius', 'coreweave'];

/** Providers allowed to host owned/proprietary weights. */
export const OWNED_WEIGHTS_PROVIDERS = ['runpod', 'vast_ai', 'baseten', 'jarvislabs', 'nebius', 'local_pytorch', 'sagemaker', 'coreweave'];

export type RiskTolerance = 'any' | 'high_risk' | 'medium_risk' | 'low_risk' | 'guaranteed';

export interface AdvisorConstraints {
  // A. Model requirements
  requireVpc?: boolean;
  risk?: RiskTolerance;
  jobTokens?: number;

  // B. Security & networking
  minSecurityLevel?: 'any' | 'standard' | 'enterprise' | 'fedramp_hipaa';
  dedicatedHardware?: boolean;
  dataRetention?: 'any' | 'zero_retention';
  encryption?: 'any' | 'strict_cmek';
  region?: 'any' | 'us_east' | 'us_west' | 'europe' | 'apac';

  // C. Execution requirements
  executionType?: 'all' | 'token_api' | 'serverless' | 'pod' | 'vm' | 'kubernetes';
  lifecycle?: 'all' | 'persistent' | 'scale_to_zero' | 'ephemeral';
  jobPattern?: 'all' | 'sync' | 'async' | 'batch';
  priority?: 'low' | 'normal' | 'high';

  // Cost constraints
  includeStorageAndNetwork?: boolean;
}

export interface ModelBenchmarkRef {
  benchmarkSuite: string;
  taskProfile: string;
  referenceUrl: string;
  /** Standardized tokens processed in one reference benchmark task. */
  referenceTaskTokens: number;
  /** Secondary industry-standard unit label for the modality (e.g. '1M tok', '1k imgs (1MP)', '100 clips (6s)', '1 hr audio'). */
  concernUnitLabel: string;
  /** Equivalent tokens per concern unit for secondary modality cost display. */
  tokensPerConcernUnit: number;
}

export const MODEL_PUBLIC_BENCHMARKS: Record<string, ModelBenchmarkRef> = {
  'meta-llama/Llama-3-8B-Instruct': {
    benchmarkSuite: 'MLPerf Inference v4.1 · ShareGPT FP16',
    taskProfile: '2,048 in / 512 out tokens (batch=1, FP16/FP8)',
    referenceUrl: 'https://mlcommons.org/benchmarks/inference-datacenter/',
    referenceTaskTokens: 2560,
    concernUnitLabel: '1M tok',
    tokensPerConcernUnit: 1_000_000,
  },
  'meta-llama/Llama-3-70B-Instruct': {
    benchmarkSuite: 'MLPerf Inference v4.1 · Llama-70B FP16',
    taskProfile: '2,048 in / 512 out tokens (TP/80GB HBM)',
    referenceUrl: 'https://mlcommons.org/benchmarks/inference-datacenter/',
    referenceTaskTokens: 2560,
    concernUnitLabel: '1M tok',
    tokensPerConcernUnit: 1_000_000,
  },
  'deepseek-ai/DeepSeek-V3': {
    benchmarkSuite: 'Artificial Analysis · MMLU-Pro / ShareGPT MoE',
    taskProfile: '4,096 in / 1,024 out tokens (37B active MoE FP8)',
    referenceUrl: 'https://artificialanalysis.ai/models/deepseek-v3',
    referenceTaskTokens: 5120,
    concernUnitLabel: '1M tok',
    tokensPerConcernUnit: 1_000_000,
  },
  'mistralai/Mistral-7B-Instruct-v0.2': {
    benchmarkSuite: 'vLLM Public Benchmark · ShareGPT 32k SWA',
    taskProfile: '2,048 in / 512 out tokens (FP16)',
    referenceUrl: 'https://artificialanalysis.ai/models/mistral-7b-instruct',
    referenceTaskTokens: 2560,
    concernUnitLabel: '1M tok',
    tokensPerConcernUnit: 1_000_000,
  },
  'corporate/private-finetune-7b': {
    benchmarkSuite: 'MLPerf Inference v4.1 · 7B LoRA Reference',
    taskProfile: '2,048 in / 512 out tokens (merged FP16 LoRA)',
    referenceUrl: 'https://mlcommons.org/benchmarks/inference-datacenter/',
    referenceTaskTokens: 2560,
    concernUnitLabel: '1M tok',
    tokensPerConcernUnit: 1_000_000,
  },
  'black-forest-labs/FLUX.1-schnell': {
    benchmarkSuite: 'GenEval / COCO-1024 · 4-Step Rectified Flow',
    taskProfile: '1024×1024 (1MP) · 4 steps = 4,096 latent patch tokens/img',
    referenceUrl: 'https://huggingface.co/black-forest-labs/FLUX.1-schnell',
    referenceTaskTokens: 4096,
    concernUnitLabel: '1k imgs (1MP)',
    tokensPerConcernUnit: 4_096_000,
  },
  'stabilityai/stable-diffusion-xl-base-1.0': {
    benchmarkSuite: 'MLPerf Inference v4.1 · SDXL COCO-2014 (1024×1024)',
    taskProfile: '1024×1024 (1MP) · 20 Euler steps = 4,096 latent tokens/img',
    referenceUrl: 'https://mlcommons.org/benchmarks/inference-datacenter/',
    referenceTaskTokens: 4096,
    concernUnitLabel: '1k imgs (1MP)',
    tokensPerConcernUnit: 4_096_000,
  },
  'corporate/private-fashion-diffusion': {
    benchmarkSuite: 'MLPerf SDXL Reference · 1024×1024 Fine-Tune',
    taskProfile: '1024×1024 (1MP) · 25 steps = 5,120 latent tokens/img',
    referenceUrl: 'https://mlcommons.org/benchmarks/inference-datacenter/',
    referenceTaskTokens: 5120,
    concernUnitLabel: '1k imgs (1MP)',
    tokensPerConcernUnit: 5_120_000,
  },
  'THUDM/CogVideoX-5b': {
    benchmarkSuite: 'VBench Public Suite · 720×480 @ 49f (50-Step 3D-DiT)',
    taskProfile: '6s clip (49 frames, 50 steps) = 36,000 spatio-temporal tokens/clip',
    referenceUrl: 'https://vchitect.github.io/VBench-project/',
    referenceTaskTokens: 36_000,
    concernUnitLabel: '100 clips (6s)',
    tokensPerConcernUnit: 3_600_000,
  },
  'corporate/private-video-engine': {
    benchmarkSuite: 'VBench Reference · 720p @ 49f DiT Synthetic Video',
    taskProfile: '6s clip (49 frames, 50 steps) = 48,000 spatio-temporal tokens/clip',
    referenceUrl: 'https://vchitect.github.io/VBench-project/',
    referenceTaskTokens: 48_000,
    concernUnitLabel: '100 clips (6s)',
    tokensPerConcernUnit: 4_800_000,
  },
  'openai/whisper-large-v3': {
    benchmarkSuite: 'HuggingFace Open ASR Leaderboard · LibriSpeech Clean',
    taskProfile: '60s 16kHz audio chunk = 1,500 acoustic/decoder tokens/min',
    referenceUrl: 'https://huggingface.co/spaces/hf-audio/open_asr_leaderboard',
    referenceTaskTokens: 1500,
    concernUnitLabel: '1 hr audio',
    tokensPerConcernUnit: 90_000,
  },
  'corporate/audio-voice-cloning': {
    benchmarkSuite: 'LibriTTS / Seed-TTS Reference · Neural Codec Stream',
    taskProfile: '60s synthesized 24kHz audio = 3,000 codec tokens/min',
    referenceUrl: 'https://huggingface.co/spaces/hf-audio/open_asr_leaderboard',
    referenceTaskTokens: 3000,
    concernUnitLabel: '1 hr audio',
    tokensPerConcernUnit: 180_000,
  },
  'deepseek-ai/DeepSeek-R1': {
    benchmarkSuite: 'LiveCodeBench / AIME 2024 · CoT Reasoning',
    taskProfile: '1,024 prompt / 4,096 chain-of-thought reasoning tokens',
    referenceUrl: 'https://livecodebench.github.io/leaderboard.html',
    referenceTaskTokens: 5120,
    concernUnitLabel: '1M tok',
    tokensPerConcernUnit: 1_000_000,
  },
  'Qwen/Qwen2.5-Coder-32B-Instruct': {
    benchmarkSuite: 'LiveCodeBench / EvalPlus · 32k Repo Context',
    taskProfile: '4,096 repo context / 1,024 generated code tokens',
    referenceUrl: 'https://livecodebench.github.io/leaderboard.html',
    referenceTaskTokens: 5120,
    concernUnitLabel: '1M tok',
    tokensPerConcernUnit: 1_000_000,
  },
};

export function getModelBenchmark(model: CuratedModelDefinition): ModelBenchmarkRef {
  const exact = MODEL_PUBLIC_BENCHMARKS[model.id];
  if (exact) return exact;
  if (model.purpose === 'text_to_video') return MODEL_PUBLIC_BENCHMARKS['THUDM/CogVideoX-5b'];
  if (model.purpose === 'text_to_image') return MODEL_PUBLIC_BENCHMARKS['black-forest-labs/FLUX.1-schnell'];
  if (model.purpose === 'speech_to_text') return MODEL_PUBLIC_BENCHMARKS['openai/whisper-large-v3'];
  if (model.purpose === 'code_reasoning') return MODEL_PUBLIC_BENCHMARKS['Qwen/Qwen2.5-Coder-32B-Instruct'];
  return MODEL_PUBLIC_BENCHMARKS['meta-llama/Llama-3-8B-Instruct'];
}

export interface RankedOption {
  gpu: GpuPricingItem;
  /** Standardized throughput (tokens/sec) on the model's public benchmark reference. */
  tokensPerSec: number;
  /** Price per 1M tokens ($/1M tok) at current hourly rate. */
  costPerMillionUsd: number;
  /** Tokens generated per $1 USD (tok/$). */
  tokensPerDollar: number;
  /** Cost per modality-native unit (e.g. $/1M tok, $/1k imgs, $/100 clips, $/hr audio). */
  concernUnitCostUsd: number;
  concernUnitLabel: string;
  benchmark: ModelBenchmarkRef;
  execSeconds: number;
  costPerJobUsd: number;
  costPer1kJobsUsd: number;
  storageCostPer1kJobsUsd?: number;
  networkCostPer1kJobsUsd?: number;
  vpcCapable: boolean;
  securityLevel: 'standard' | 'enterprise' | 'fedramp_hipaa';
  regionLabel: string;
}

export interface AdvisorResult {
  options: RankedOption[];
  bestValue: RankedOption | null;
  cheapestHourly: RankedOption | null;
  fastest: RankedOption | null;
  secure: RankedOption | null;
}

export function isRiskAllowed(tier: GpuPricingItem['interruptionRiskTier'] | string, tolerance?: RiskTolerance): boolean {
  if (!tolerance || tolerance === 'any') return true;
  const t = (tier || '').toLowerCase().trim();
  const isGuar = t === 'guaranteed' || t === '0%' || t.includes('(0%)') || t.startsWith('0%');
  if (tolerance === 'guaranteed') return isGuar;
  if (tolerance === 'low_risk') return isGuar || t === '<5%' || t.includes('<5%');
  if (tolerance === 'medium_risk') return isGuar || t === '<5%' || t.includes('<5%') || t === '5-10%' || t.includes('5-10%');
  if (tolerance === 'high_risk') return !t.includes('>20%');
  return true;
}

const FEDRAMP_HIPAA_PROVIDERS = ['sagemaker', 'bedrock', 'coreweave', 'local_pytorch'];
const ENTERPRISE_PROVIDERS = ['sagemaker', 'bedrock', 'coreweave', 'nebius', 'baseten', 'local_pytorch'];

export function getProviderSecurityLevel(provider: string): 'standard' | 'enterprise' | 'fedramp_hipaa' {
  const p = provider.toLowerCase();
  if (FEDRAMP_HIPAA_PROVIDERS.includes(p)) return 'fedramp_hipaa';
  if (ENTERPRISE_PROVIDERS.includes(p)) return 'enterprise';
  return 'standard';
}

export function matchesRegion(zone: string | undefined, provider: string, region?: string): boolean {
  if (!region || region === 'any') return true;
  const z = (zone || '').toLowerCase();
  const p = provider.toLowerCase();
  if (region === 'us_east') {
    return z.includes('east') || z.includes('va') || p === 'local_pytorch' || p === 'runpod' || p === 'vast_ai';
  }
  if (region === 'us_west') {
    return z.includes('west') || z.includes('oregon') || z.includes('ca');
  }
  if (region === 'europe') {
    return z.includes('eu') || z.includes('europe') || z.includes('frankfurt') || p === 'nebius' || p === 'hivenet';
  }
  if (region === 'apac') {
    return z.includes('asia') || z.includes('apac') || z.includes('tokyo') || z.includes('sg');
  }
  return true;
}

export function matchesExecutionType(pricingModel: string, provider: string, execType?: string): boolean {
  if (!execType || execType === 'all') return true;
  const m = pricingModel.toLowerCase();
  const p = provider.toLowerCase();
  if (execType === 'token_api') return m === 'token_factory' || m === 'pay_per_call';
  if (execType === 'serverless') return m === 'serverless' || m === 'serverless_endpoint';
  if (execType === 'pod') return ['runpod', 'vast_ai', 'jarvislabs', 'hivenet'].includes(p) && (m === 'spot_bid' || m === 'on_demand');
  if (execType === 'vm') return ['nebius', 'coreweave', 'sagemaker', 'baseten'].includes(p);
  if (execType === 'kubernetes') return ['coreweave', 'local_pytorch', 'sagemaker'].includes(p);
  return true;
}

export function matchesLifecycle(pricingModel: string, provider: string, lifecycle?: string): boolean {
  if (!lifecycle || lifecycle === 'all') return true;
  const m = pricingModel.toLowerCase();
  const p = provider.toLowerCase();
  if (lifecycle === 'persistent') return m === 'on_demand' || p === 'local_pytorch';
  if (lifecycle === 'scale_to_zero') return m === 'serverless' || m === 'serverless_endpoint' || m === 'token_factory' || m === 'pay_per_call';
  if (lifecycle === 'ephemeral') return m === 'spot_bid' || m === 'spot' || m === 'preemptible';
  return true;
}

export function scaleThroughput(baseTokensPerSec: number, model: CuratedModelDefinition): number {
  // Reference model needs 16GB; larger models decode proportionally slower per GPU.
  const factor = Math.min(1, 16 / Math.max(1, model.minVramGb));
  return Math.max(1, Math.round(baseTokensPerSec * factor * 10) / 10);
}

export function rankExecutionOptions(
  model: CuratedModelDefinition,
  gpus: GpuPricingItem[],
  constraints: AdvisorConstraints,
  baseTokensPerSec: (gpu: GpuPricingItem) => number
): AdvisorResult {
  const options: RankedOption[] = [];
  const benchmark = getModelBenchmark(model);
  const taskTokens = constraints.jobTokens ?? benchmark.referenceTaskTokens;

  for (const gpu of gpus) {
    if (gpu.vramGb < model.minVramGb) continue;
    if (!gpu.isAvailable || gpu.obtainabilityLabel === 'Out of Stock') continue;
    if (model.weightType === 'proprietary' && !OWNED_WEIGHTS_PROVIDERS.includes(gpu.provider)) continue;
    const vpcCapable = VPC_CAPABLE_PROVIDERS.includes(gpu.provider);
    if (constraints.requireVpc && !vpcCapable) continue;
    if (!isRiskAllowed(gpu.interruptionRiskTier, constraints.risk)) continue;

    // Security & Networking constraints
    const secLevel = getProviderSecurityLevel(gpu.provider);
    if (constraints.minSecurityLevel === 'fedramp_hipaa' && secLevel !== 'fedramp_hipaa') continue;
    if (constraints.minSecurityLevel === 'enterprise' && secLevel === 'standard') continue;

    if (constraints.dedicatedHardware && (gpu.pricingModel === 'serverless' || (gpu.pricingModel as string) === 'token_factory' || (gpu.pricingModel as string) === 'pay_per_call' || gpu.provider === 'bedrock')) {
      continue;
    }
    if (constraints.dataRetention === 'zero_retention' && !['local_pytorch', 'sagemaker', 'bedrock', 'fal', 'runpod', 'nebius'].includes(gpu.provider)) {
      continue;
    }
    if (constraints.encryption === 'strict_cmek' && !['sagemaker', 'bedrock', 'coreweave', 'local_pytorch'].includes(gpu.provider)) {
      continue;
    }
    if (!matchesRegion(gpu.zone, gpu.provider, constraints.region)) continue;

    // Execution Requirements constraints
    if (!matchesExecutionType(gpu.pricingModel, gpu.provider, constraints.executionType)) continue;
    if (!matchesLifecycle(gpu.pricingModel, gpu.provider, constraints.lifecycle)) continue;

    const tokensPerSec = scaleThroughput(baseTokensPerSec(gpu), model);
    const costPerMillionUsd =
      tokensPerSec > 0 ? (gpu.normalizedHourlyUsd / (tokensPerSec * 3600)) * 1_000_000 : Infinity;
    const tokensPerDollar =
      gpu.normalizedHourlyUsd > 0 ? (tokensPerSec * 3600) / gpu.normalizedHourlyUsd : 0;
    const concernUnitCostUsd = (costPerMillionUsd / 1_000_000) * benchmark.tokensPerConcernUnit;
    const coldStart = gpu.pricingModel === 'serverless' ? model.coldStartSec : 0;
    const execSeconds = taskTokens / tokensPerSec + coldStart;

    // Compute Storage & Network cost allocations if enabled
    let storageCostPerJobUsd = 0;
    let networkCostPerJobUsd = 0;
    if (constraints.includeStorageAndNetwork) {
      const storagePerMonthUsd = (model.weightsSizeGb || 16) * 0.023; // $0.023/GB/mo
      storageCostPerJobUsd = storagePerMonthUsd / 10_000; // amortized across 10k baseline jobs
      const payloadGb = model.purpose === 'text_to_video' ? 0.05 : 0.005; // 50MB for video, 5MB for LLM
      networkCostPerJobUsd = payloadGb * 0.09; // $0.09/GB egress
    }

    const costPerJobUsd = (gpu.normalizedHourlyUsd / 3600) * execSeconds + storageCostPerJobUsd + networkCostPerJobUsd;

    options.push({
      gpu,
      tokensPerSec,
      costPerMillionUsd,
      tokensPerDollar,
      concernUnitCostUsd,
      concernUnitLabel: benchmark.concernUnitLabel,
      benchmark,
      execSeconds,
      costPerJobUsd,
      costPer1kJobsUsd: costPerJobUsd * 1000,
      storageCostPer1kJobsUsd: storageCostPerJobUsd * 1000,
      networkCostPer1kJobsUsd: networkCostPerJobUsd * 1000,
      vpcCapable,
      securityLevel: secLevel,
      regionLabel: gpu.zone || `${gpu.provider}-global`,
    });
  }

  const pick = (list: RankedOption[], cmp: (a: RankedOption, b: RankedOption) => number) =>
    list.length > 0 ? [...list].sort(cmp)[0] : null;

  return {
    options: [...options].sort((a, b) => a.costPerMillionUsd - b.costPerMillionUsd),
    bestValue: pick(options, (a, b) => a.costPerMillionUsd - b.costPerMillionUsd),
    cheapestHourly: pick(options, (a, b) => a.gpu.normalizedHourlyUsd - b.gpu.normalizedHourlyUsd),
    fastest: pick(options, (a, b) => b.tokensPerSec - a.tokensPerSec),
    secure: pick(
      options.filter((o) => o.vpcCapable && o.gpu.interruptionRiskTier === 'guaranteed'),
      (a, b) => a.costPerMillionUsd - b.costPerMillionUsd
    ),
  };
}

/** A GPU offering can host the model: enough VRAM, meets security/risk constraints, and for owned weights, an allowed provider. */
export function isGpuCompatible(
  model: CuratedModelDefinition,
  gpu: { provider: string; vramGb: number; riskTier?: string },
  constraints?: Partial<AdvisorConstraints>
): boolean {
  if (gpu.vramGb < model.minVramGb) return false;
  if (model.weightType === 'proprietary' && !OWNED_WEIGHTS_PROVIDERS.includes(gpu.provider)) return false;
  if (constraints?.requireVpc && !VPC_CAPABLE_PROVIDERS.includes(gpu.provider)) return false;
  if (
    constraints?.risk &&
    gpu.riskTier &&
    !isRiskAllowed(
      (gpu.riskTier.toLowerCase().includes('guaranteed') ? 'guaranteed' : gpu.riskTier) as GpuPricingItem['interruptionRiskTier'],
      constraints.risk
    )
  ) {
    return false;
  }
  return true;
}

/**
 * A managed cloud endpoint / token-factory / serverless offering is compatible with the picked model.
 * Owned/proprietary weights can never be served by a shared public endpoint.
 * For open-weights models, matches exact model family or compatible managed cloud endpoints in the same modality.
 */
export function isEndpointCompatible(
  model: CuratedModelDefinition,
  endpoint: Pick<ModelPricingItem, 'modelId' | 'modelName'> & {
    provider?: string;
    modality?: string;
  },
  constraints?: Partial<AdvisorConstraints>
): boolean {
  if (model.weightType === 'proprietary') return false;
  if (constraints?.requireVpc && endpoint.provider && !VPC_CAPABLE_PROVIDERS.includes(endpoint.provider)) {
    return false;
  }

  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const modelNorm = normalize(`${model.id} ${model.name}`);
  const epNorm = normalize(`${endpoint.modelId} ${endpoint.modelName}`);

  const familyTokens = ['llama', 'deepseek', 'qwen', 'mistral', 'gemma', 'glm', 'flux', 'diffusion', 'sdxl', 'whisper', 'cogvideo'];
  const matchedFamily = familyTokens.some((tok) => modelNorm.includes(tok) && epNorm.includes(tok));
  if (matchedFamily) return true;

  const slug = normalize(model.id.split('/').pop() ?? model.id);
  if (slug && (epNorm.includes(slug) || modelNorm.includes(epNorm))) return true;

  // Also include managed cloud options serving the same modality so the user can compare cloud MaaS/Pay-per-call alternatives
  if (endpoint.modality && model.purpose !== 'all' && endpoint.modality === model.purpose) {
    return true;
  }

  return false;
}
