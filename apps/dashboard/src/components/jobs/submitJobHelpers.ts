import type {
  GpuPricingItem,
  GpuPricingModel,
  RoutingPreference,
  SpotPolicyInfo,
  ProviderFleetStatus,
} from '../../types';
import { DEFAULT_PROVIDER_FLEET } from '../finops/ProviderFleetBar';

/** Local tok/s baseline (mirrors FinOps HARDWARE_BENCHMARK_THROUGHPUT fallback). */
function resolveTokensPerSec(gpu: GpuPricingItem): {
  tokensPerSec: number;
  evidence: 'provider-reported' | 'estimated';
} {
  if (gpu.tokensPerSec && gpu.tokensPerSec > 0) {
    return { tokensPerSec: gpu.tokensPerSec, evidence: 'provider-reported' };
  }
  return {
    tokensPerSec: Math.max(25, Math.round(gpu.vramGb * 2.2)),
    evidence: 'estimated',
  };
}

export type ModelPurposeId =
  | 'all'
  | 'text_to_text'
  | 'text_to_image'
  | 'text_to_video'
  | 'speech_to_text'
  | 'code_reasoning'
  | 'media_photo';

export type BidMode = 'recommended' | 'fixed' | 'user';

export interface SubmitJobPrefill {
  modelId?: string;
  purpose?: ModelPurposeId;
  gpuId?: string;
  provider?: string;
  pricingModel?: GpuPricingModel | string;
  hardwareSkuId?: string;
  bidUsdPerHour?: number;
  routingPreference?: RoutingPreference;
}

export interface PlacementSelection {
  provider: string;
  pricingModel: string;
  hardwareSkuId: string;
  hardwareDisplayName: string;
  gpuId: string;
  bidUsdPerHour: number | null;
  bidMode: BidMode;
  tokensPerSec: number;
  forecastedExecutionMs: number;
  forecastedCostUsd: number;
  interruptionRiskTier: string;
  noticeWindowLabel?: string;
  rateEvidence: 'provider-reported' | 'estimated';
  throughputEvidence: 'provider-reported' | 'estimated';
}

export const DEFAULT_PROMPTS: Record<string, string> = {
  text_to_text: 'What are the most popular dishes in Spain?',
  code_reasoning: 'Write a TypeScript function that merges two sorted arrays in O(n) time.',
  text_to_image: 'A sunlit Mediterranean kitchen with fresh tomatoes and olive oil, photorealistic.',
  text_to_video:
    'A blue hatchback parked on a quiet coastal road at golden hour, slow camera dolly from the front three-quarter, soft wind, cinematic lighting.',
  speech_to_text: 'Transcribe this audio clearly with punctuation and speaker turns if present.',
  media_photo: 'Describe the main subjects, setting, and mood in this image.',
  all: 'What are the most popular dishes in Spain?',
};

/** Target local GPU for catalog sizing (RTX 5070 Ti class). */
export const LOCAL_VRAM_BUDGET_GB = 16;

export type ModelLocalFit = 'fits_vram' | 'offload' | 'cloud_only' | 'api';

/** Per-model Submit Job defaults (merged over purpose geometry). */
export interface ModelInferenceDefaults {
  temperature?: number;
  maxNewTokens?: number;
  width?: number;
  height?: number;
  numInferenceSteps?: number;
  guidanceScale?: number;
  fps?: number;
  durationSeconds?: number;
  /** Must be a value from EXECUTION_ENGINES when set. */
  engine?: 'auto' | 'eager' | 'torchscript' | 'torch-compile' | 'numpy' | 'onnx' | 'vllm';
  device?: '' | 'cpu' | 'cuda';
  prompt?: string;
}

export interface PopularModelDef {
  id: string;
  label: string;
  purpose: ModelPurposeId;
  /** Peak VRAM needed for the packaged local path (INT4/NF4 when that is the local path). */
  minVramGb: number;
  /** Host RAM hint when CPU / offload path is used. */
  minRamGb: number;
  /** Packaged weight format / variant — pick the model id, do not quantize on the fly. */
  quantization: string;
  proprietary: boolean;
  notes?: string;
  /** Approximate on-disk HF hub size once fully cached (not VRAM). */
  diskGbHint?: number;
  /** Operator-facing prompt / capability guidance shown in Submit Job. */
  promptTips?: string;
  /**
   * How a 16 GB-class card runs this checkpoint.
   * `fits_vram` = resident weights fit; `offload` = CPU offload (slow); `api` = managed.
   */
  localFit: ModelLocalFit;
  /** Form defaults applied when this model is selected. */
  defaults?: ModelInferenceDefaults;
  /**
   * When set, local HF ensure/download uses this hub id (e.g. NF4 pack) while
   * jobs/compare still use `id` so cloud BYO/hosted see the canonical model.
   */
  localHubId?: string;
}

/**
 * Local-first catalog: prefer checkpoints that fit in LOCAL_VRAM_BUDGET_GB.
 * Video DiTs still need CPU offload on 16 GB — kept last within that purpose with tight geometry.
 */
export const POPULAR_MODELS: PopularModelDef[] = [
  // Text — resident on 16 GB (TinyLlama FP16; 7B via worker INT4)
  {
    id: 'TinyLlama/TinyLlama-1.1B-Chat-v1.0',
    label: 'TinyLlama 1.1B Chat',
    purpose: 'text_to_text',
    minVramGb: 3,
    minRamGb: 8,
    quantization: 'FP16',
    proprietary: false,
    diskGbHint: 2,
    localFit: 'fits_vram',
    notes: 'Compare: local + GPU BYO · fits 16 GB',
    defaults: { temperature: 0.7, maxNewTokens: 256, engine: 'auto', device: 'cuda' },
  },
  {
    id: 'Qwen/Qwen2.5-7B-Instruct',
    label: 'Qwen 2.5 7B Instruct',
    purpose: 'text_to_text',
    minVramGb: 6,
    minRamGb: 16,
    quantization: 'INT4 (local) / FP16 (cloud BYO)',
    proprietary: false,
    diskGbHint: 15,
    localFit: 'fits_vram',
    notes: 'Compare: local + GPU BYO · same Hub id',
    defaults: { temperature: 0.7, maxNewTokens: 512, engine: 'auto', device: 'cuda' },
  },
  {
    id: 'mistralai/Mistral-7B-Instruct-v0.2',
    label: 'Mistral 7B Instruct v0.2',
    purpose: 'text_to_text',
    minVramGb: 6,
    minRamGb: 16,
    quantization: 'INT4 (local) / FP16 (cloud BYO)',
    proprietary: false,
    diskGbHint: 14,
    localFit: 'fits_vram',
    notes: 'Compare: local + GPU BYO · same Hub id',
    defaults: { temperature: 0.6, maxNewTokens: 512, engine: 'auto', device: 'cuda' },
  },
  {
    id: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-7B',
    label: 'DeepSeek-R1 Distill Qwen 7B',
    purpose: 'code_reasoning',
    minVramGb: 6,
    minRamGb: 16,
    quantization: 'INT4 (local) / FP16 (cloud BYO)',
    proprietary: false,
    diskGbHint: 15,
    localFit: 'fits_vram',
    notes: 'Compare: local + GPU BYO · same Hub id',
    defaults: { temperature: 0.5, maxNewTokens: 768, engine: 'auto', device: 'cuda' },
  },
  {
    id: 'anthropic/claude-3-haiku',
    label: 'Claude 3 Haiku',
    purpose: 'text_to_text',
    minVramGb: 0,
    minRamGb: 0,
    quantization: 'Managed (Bedrock)',
    proprietary: true,
    localFit: 'api',
    notes: 'Bedrock only · not cross-provider comparable',
    defaults: { temperature: 0.7, maxNewTokens: 512 },
  },
  // Image — resident on 16 GB
  {
    id: 'stabilityai/sd-turbo',
    label: 'SD-Turbo',
    purpose: 'text_to_image',
    minVramGb: 5,
    minRamGb: 12,
    quantization: 'FP16',
    proprietary: false,
    diskGbHint: 5,
    localFit: 'fits_vram',
    notes: 'Compare: local + GPU BYO · same Hub id',
    promptTips: 'Short concrete scene prompts work best. Distilled turbo: keep steps at 2–4 and guidance at 0.',
    defaults: {
      width: 512,
      height: 512,
      numInferenceSteps: 4,
      guidanceScale: 0,
      prompt: 'A sunlit Mediterranean kitchen with fresh tomatoes and olive oil, photorealistic.',
    },
  },
  {
    id: 'black-forest-labs/FLUX.1-schnell',
    label: 'FLUX.1 schnell',
    purpose: 'text_to_image',
    minVramGb: 8,
    minRamGb: 16,
    quantization: 'NF4 local · FP8/FP16 cloud',
    proprietary: false,
    diskGbHint: 12,
    localFit: 'fits_vram',
    localHubId: 'magespace/FLUX.1-schnell-bnb-nf4',
    notes: 'Compare: local NF4 + RunPod/Vast/fal/runware · canonical Hub id',
    promptTips: 'FLUX.1 schnell: 4 steps, guidance 0. Same catalog id on cloud; local worker loads the NF4 pack.',
    defaults: {
      width: 1024,
      height: 1024,
      numInferenceSteps: 4,
      guidanceScale: 0,
      prompt: 'A sunlit Mediterranean kitchen with fresh tomatoes and olive oil, photorealistic, 35mm.',
    },
  },
  {
    id: 'openai/clip-vit-large-patch14',
    label: 'CLIP ViT-Large-Patch14',
    purpose: 'media_photo',
    minVramGb: 2,
    minRamGb: 6,
    quantization: 'FP16',
    proprietary: false,
    diskGbHint: 2,
    localFit: 'fits_vram',
    notes: 'Compare: local + GPU BYO · upload an image',
    defaults: { temperature: 0.2, maxNewTokens: 128, device: 'cuda' },
  },
  // Audio — resident on 16 GB
  {
    id: 'openai/whisper-tiny',
    label: 'Whisper Tiny',
    purpose: 'speech_to_text',
    minVramGb: 1,
    minRamGb: 2,
    quantization: 'FP16',
    proprietary: false,
    diskGbHint: 0.2,
    localFit: 'fits_vram',
    notes: 'Compare: local + GPU BYO + fal Whisper',
    defaults: { device: 'cuda' },
  },
  {
    id: 'openai/whisper-large-v3',
    label: 'Whisper Large v3',
    purpose: 'speech_to_text',
    minVramGb: 6,
    minRamGb: 10,
    quantization: 'FP16',
    proprietary: false,
    diskGbHint: 3,
    localFit: 'fits_vram',
    notes: 'Compare: local + GPU BYO + fal wizper',
    defaults: { device: 'cuda' },
  },
  // Video — LTX fits ~10 GB resident; Wan needs offload on 16 GB
  {
    id: 'Lightricks/LTX-Video',
    label: 'LTX-Video',
    purpose: 'text_to_video',
    minVramGb: 10,
    minRamGb: 16,
    quantization: 'BF16 / FP16 Diffusers',
    proprietary: false,
    diskGbHint: 28,
    localFit: 'fits_vram',
    notes:
      'VRAM ~10 GB resident (fits 16 GB) · disk ~28 GB Diffusers only — ignore mono-repo Comfy checkpoints (~250 GB)',
    promptTips:
      'Single continuous scene + one camera move. LTX is fast on 16 GB without CPU offload at default 704×480. Disk size ≠ VRAM: T5 text encoder dominates disk, transformer stays ~10 GB on GPU.',
    defaults: {
      width: 704,
      height: 480,
      numInferenceSteps: 30,
      guidanceScale: 3,
      fps: 24,
      durationSeconds: 4,
      device: 'cuda',
      prompt:
        'A blue hatchback on a quiet coastal road at golden hour, slow dolly from the front three-quarter, soft wind, cinematic.',
    },
  },
  {
    id: 'Wan-AI/Wan2.1-T2V-1.3B',
    label: 'Wan2.1 T2V 1.3B',
    purpose: 'text_to_video',
    minVramGb: 16,
    minRamGb: 32,
    quantization: 'FP16 Diffusers (CPU offload on 16 GB)',
    proprietary: false,
    diskGbHint: 27,
    localFit: 'offload',
    localHubId: 'Wan-AI/Wan2.1-T2V-1.3B-Diffusers',
    notes: 'CPU offload on 16 GB · GPU BYO ≥24 GB preferred',
    promptTips:
      'Single subject + one camera move only. Defaults use 480p / 2 s / 20 steps under offload. Avoid multi-shot scripts.',
    defaults: {
      width: 480,
      height: 272,
      numInferenceSteps: 20,
      guidanceScale: 5,
      fps: 12,
      durationSeconds: 2,
      device: 'cuda',
      prompt:
        'A blue hatchback on a quiet coastal road at golden hour, slow dolly from the front three-quarter, soft wind.',
    },
  },
];

/** How a model will sit on a given GPU VRAM budget (uses 92% headroom). */
export type VramPlacement = 'resident' | 'offload' | 'insufficient' | 'api';

export function predictVramPlacement(
  model: PopularModelDef,
  availableVramGb: number | null | undefined
): VramPlacement {
  if (model.localFit === 'api' || model.proprietary) return 'api';
  if (availableVramGb == null || !Number.isFinite(availableVramGb) || availableVramGb <= 0) {
    return model.localFit === 'offload' ? 'offload' : 'resident';
  }
  const budget = availableVramGb * 0.92;
  if (model.minVramGb <= budget) return 'resident';
  // Soft overflow: worker can still try CPU offload if within ~1.6× card size
  if (model.minVramGb <= availableVramGb * 1.6 || model.localFit === 'offload') return 'offload';
  return 'insufficient';
}

export function formatVramPlacement(placement: VramPlacement, availableVramGb?: number | null): string {
  const card = availableVramGb && availableVramGb > 0 ? `${availableVramGb.toFixed(0)} GB card` : 'local GPU';
  if (placement === 'resident') return `Fits in VRAM on ${card} (no CPU offload)`;
  if (placement === 'offload') return `Will use CPU offload on ${card} (slower; layers stream from RAM)`;
  if (placement === 'insufficient') return `Likely too large for ${card} even with offload`;
  return 'Managed API — local VRAM not used';
}

export function formatModelOptionLabel(model: PopularModelDef): string {
  const vram =
    model.minVramGb > 0 ? `~${model.minVramGb} GB VRAM` : 'API-managed';
  const ram = model.minRamGb > 0 ? ` · ≥${model.minRamGb} GB RAM` : '';
  const quant = model.quantization ? ` · ${model.quantization}` : '';
  const fit =
    model.localFit === 'fits_vram'
      ? ' · fits 16 GB'
      : model.localFit === 'offload'
        ? ' · CPU offload'
        : model.localFit === 'api'
          ? ' · API'
          : '';
  return `${model.label} (${vram}${ram}${quant}${fit})`;
}

export function fitsLocalVramBudget(
  model: PopularModelDef,
  budgetGb: number = LOCAL_VRAM_BUDGET_GB
): boolean {
  if (model.localFit === 'api') return true;
  if (model.localFit === 'fits_vram') return model.minVramGb <= budgetGb;
  return false;
}

/** Preferred catalog pick for a purpose (VRAM-resident first). */
export function preferredModelForPurpose(purpose: string): PopularModelDef | undefined {
  const scoped =
    purpose === 'all'
      ? POPULAR_MODELS.filter((m) => m.purpose === 'text_to_text')
      : POPULAR_MODELS.filter((m) => m.purpose === purpose);
  if (scoped.length === 0) return undefined;
  return (
    scoped.find((m) => m.localFit === 'fits_vram') ||
    scoped.find((m) => m.localFit === 'api') ||
    scoped[0]
  );
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value.toFixed(value >= 10 || idx === 0 ? 0 : 1)} ${units[idx]}`;
}

/** Disk cache badge text — distinguishes HF hub footprint from runtime VRAM. */
export function formatModelDiskCacheNote(
  model: PopularModelDef,
  sizeBytes: number | null | undefined
): string {
  const disk =
    sizeBytes && sizeBytes > 0
      ? formatBytes(sizeBytes)
      : model.diskGbHint
        ? `~${model.diskGbHint} GB`
        : null;
  if (!disk) return 'not downloaded';
  if (model.localFit === 'offload') {
    return `disk ${disk} (full FP16 weights; 16 GB card runs via CPU offload — disk ≠ VRAM)`;
  }
  if (model.localFit === 'cloud_only') {
    return `disk ${disk} · needs cloud / larger GPU`;
  }
  return `disk ${disk}`;
}

export function promptTipsForModel(modelId: string): string | undefined {
  return findPopularModel(modelId)?.promptTips;
}

/** Purpose geometry + per-model overrides for Submit Job form fields. */
export function inferenceDefaultsForModel(modelId: string): Partial<InferenceParamFormState> {
  const model = findPopularModel(modelId);
  const purpose = model?.purpose ?? 'text_to_text';
  const geom = geometryDefaultsForPurpose(purpose);
  const { prompt: _prompt, ...modelDefaults } = model?.defaults ?? {};
  return {
    ...geom,
    ...modelDefaults,
  };
}

export function defaultPromptForModel(modelId: string, purpose?: string): string {
  const model = findPopularModel(modelId);
  if (model?.defaults?.prompt) return model.defaults.prompt;
  return defaultPromptForPurpose(purpose || model?.purpose || 'text_to_text');
}

export function formatModelCacheLabel(
  model: PopularModelDef,
  cached: boolean | null | undefined
): string {
  const base = formatModelOptionLabel(model);
  if (model.proprietary) return `${base} · API`;
  if (cached === true) return `${base} · cached`;
  if (cached === false) return `${base} · not downloaded`;
  return base;
}

export function findPopularModel(modelId: string): PopularModelDef | undefined {
  return POPULAR_MODELS.find((m) => m.id === modelId);
}

/** Which inference-param sections apply for a model purpose. */
export function paramSectionsForPurpose(purpose: string): {
  text: boolean;
  image: boolean;
  video: boolean;
  audio: boolean;
  mediaInput: boolean;
  localRuntime: boolean;
} {
  const p = purpose === 'all' ? 'text_to_text' : purpose;
  return {
    text: p === 'text_to_text' || p === 'code_reasoning' || p === 'media_photo',
    image: p === 'text_to_image',
    video: p === 'text_to_video',
    audio: p === 'speech_to_text',
    mediaInput:
      p === 'media_photo' || p === 'speech_to_text' || p === 'text_to_video',
    localRuntime: true,
  };
}

/** Sensible diffusion/video geometry defaults when switching purpose/model. */
export function geometryDefaultsForPurpose(purpose: string): {
  width: number;
  height: number;
  numInferenceSteps: number;
  guidanceScale: number;
  fps: number;
  durationSeconds: number;
} {
  if (purpose === 'text_to_video') {
    return {
      width: 640,
      height: 368,
      // 6 steps is a noisy preview; Wan/CogVideo need ~20–30 for coherent motion.
      numInferenceSteps: 30,
      guidanceScale: 5,
      fps: 16,
      durationSeconds: 3,
    };
  }
  if (purpose === 'text_to_image') {
    return {
      width: 1024,
      height: 1024,
      numInferenceSteps: 4,
      guidanceScale: 0,
      fps: 24,
      durationSeconds: 3,
    };
  }
  return {
    width: 1024,
    height: 1024,
    numInferenceSteps: 4,
    guidanceScale: 0,
    fps: 24,
    durationSeconds: 3,
  };
}

export function defaultPromptForPurpose(purpose: string): string {
  return DEFAULT_PROMPTS[purpose] || DEFAULT_PROMPTS.text_to_text;
}

/** Swap prompt only when the user has not customized it away from the previous default. */
export function maybeSwapDefaultPrompt(
  currentPrompt: string,
  previousPurpose: string,
  nextPurpose: string
): string {
  const prevDefault = defaultPromptForPurpose(previousPurpose);
  if (currentPrompt.trim() === prevDefault.trim()) {
    return defaultPromptForPurpose(nextPurpose);
  }
  return currentPrompt;
}

export function resolveModelPurpose(
  modelId: string,
  purposeFilter: string
): string {
  const catalog = POPULAR_MODELS.find((m) => m.id === modelId);
  if (catalog) return catalog.purpose;
  if (purposeFilter !== 'all') return purposeFilter;
  return 'text_to_text';
}

export function normalizeProviderId(provider: string): string {
  return provider.toLowerCase().replace(/-/g, '_');
}

export function providerToRoutingPreference(provider: string): RoutingPreference {
  const p = normalizeProviderId(provider);
  if (p === 'local' || p === 'local_pytorch') return 'local/gpu';
  if (p === 'runpod') return 'cloud/runpod';
  if (p === 'bedrock') return 'cloud/bedrock';
  if (p === 'sagemaker') return 'cloud/sagemaker';
  if (p === 'mock') return 'mock';
  return 'cost_optimized';
}

/** Routing dropdown entries shown in Submit Job (value → label). */
export const ROUTING_STRATEGY_OPTIONS: ReadonlyArray<{
  value: RoutingPreference;
  label: string;
}> = [
  { value: 'auto', label: 'auto (local engine; device inferred)' },
  { value: 'local_first', label: 'local_first (Local RTX 5070 Ti)' },
  { value: 'cost_optimized', label: 'cost_optimized (Lowest Cost)' },
  { value: 'low_latency', label: 'low_latency (SLO Priority)' },
  { value: 'local/gpu', label: 'local/gpu (Force Local CUDA)' },
  { value: 'local/cpu', label: 'local/cpu (Force CPU)' },
  { value: 'cloud/runpod', label: 'cloud/runpod (RunPod GPU)' },
  { value: 'cloud/bedrock', label: 'cloud/bedrock (AWS Bedrock)' },
  { value: 'cloud/sagemaker', label: 'cloud/sagemaker (Private VPC)' },
  { value: 'cloud', label: 'cloud (Provider auto-pick)' },
];

/**
 * Routing prefs that actually dispatch to the selected placement provider.
 * Used to filter the Routing Strategy dropdown after a FinOps card or SKU pick.
 */
export function compatibleRoutingPreferences(provider: string): RoutingPreference[] {
  const p = normalizeProviderId(provider);
  if (p === 'local' || p === 'local_pytorch') {
    return ['auto', 'local_first', 'local/gpu', 'local/cpu'];
  }
  if (p === 'runpod') {
    return ['cloud/runpod', 'cloud', 'low_latency'];
  }
  if (p === 'bedrock') {
    return ['cloud/bedrock', 'cloud'];
  }
  if (p === 'sagemaker') {
    return ['cloud/sagemaker', 'cloud'];
  }
  // Spot marketplaces / MaaS without a dedicated executor path: policy labels only.
  if (p === 'vast_ai' || p === 'fal_ai' || p === 'runware' || p === 'baseten' || p === 'jarvislabs') {
    return ['cost_optimized', 'low_latency', 'cloud'];
  }
  return ROUTING_STRATEGY_OPTIONS.map((o) => o.value);
}

export function isRoutingCompatibleWithProvider(
  routing: RoutingPreference,
  provider: string
): boolean {
  return compatibleRoutingPreferences(provider).includes(routing);
}

/** Coerce routing to a concrete dispatch pref for the selected provider. */
export function ensureCompatibleRouting(
  routing: RoutingPreference,
  provider: string
): RoutingPreference {
  if (isRoutingCompatibleWithProvider(routing, provider)) return routing;
  return providerToRoutingPreference(provider);
}

/**
 * Device override inferred from routing when the form leaves device empty.
 * Cloud paths are provider-managed (empty). auto → leave empty for worker resolve.
 */
export function resolveDeviceFromRouting(
  routing: RoutingPreference
): '' | 'cpu' | 'cuda' {
  if (routing === 'local/cpu') return 'cpu';
  if (routing === 'local/gpu') return 'cuda';
  return '';
}

export function deviceInferHint(routing: RoutingPreference): string {
  const inferred = resolveDeviceFromRouting(routing);
  if (inferred === 'cpu') return 'cpu';
  if (inferred === 'cuda') return 'cuda';
  if (
    routing === 'cloud/runpod' ||
    routing === 'cloud/bedrock' ||
    routing === 'cloud/sagemaker' ||
    routing === 'cloud' ||
    routing === 'runpod' ||
    routing === 'bedrock' ||
    routing === 'sagemaker'
  ) {
    return 'provider-managed';
  }
  if (routing === 'auto' || routing === 'local_first') {
    return 'local cpu/cuda (worker)';
  }
  return 'worker default';
}

/** Concrete dispatch routing for a FinOps / smart-cloud option (never leave policy-only labels). */
export function dispatchRoutingForCloudOption(option: {
  provider: string;
  routingPreference?: string;
}): RoutingPreference {
  const fromProvider = providerToRoutingPreference(option.provider);
  const raw = (option.routingPreference || '').toLowerCase() as RoutingPreference;
  if (raw && isRoutingCompatibleWithProvider(raw, option.provider)) {
    // Prefer concrete executor prefs over policy aliases when both are compatible.
    if (raw === 'low_latency' || raw === 'cost_optimized' || raw === 'local_first') {
      return fromProvider;
    }
    return raw;
  }
  return fromProvider;
}

export function fleetForProvider(
  provider: string,
  fleet: ProviderFleetStatus[] = DEFAULT_PROVIDER_FLEET
): ProviderFleetStatus | undefined {
  const normalized = provider.toLowerCase().replace(/-/g, '_');
  return fleet.find((f) => {
    const fp = f.provider.toLowerCase().replace(/-/g, '_');
    if (fp === normalized) return true;
    if (normalized === 'local' && fp === 'local_pytorch') return true;
    if (normalized === 'local_pytorch' && fp === 'local') return true;
    return false;
  });
}

export function resolveSpotPolicy(provider: string): SpotPolicyInfo | undefined {
  return fleetForProvider(provider)?.spotPolicy;
}

export function isInterruptiblePlacement(
  pricingModel: string,
  policy?: SpotPolicyInfo
): boolean {
  if (policy?.pricingType === 'guaranteed') return false;
  return pricingModel === 'spot_bid' || pricingModel === 'preemptible';
}

export function resolveBidMode(
  pricingModel: string,
  policy?: SpotPolicyInfo
): BidMode {
  if (policy?.pricingType === 'floating_bid' || pricingModel === 'spot_bid') {
    return 'recommended';
  }
  return 'fixed';
}

export function isBidEditable(bidMode: BidMode, policy?: SpotPolicyInfo): boolean {
  if (policy?.pricingType === 'floating_bid') return true;
  return bidMode === 'recommended' || bidMode === 'user';
}

export function filterGpusForModel(
  gpus: GpuPricingItem[],
  modelId: string
): GpuPricingItem[] {
  const catalog = POPULAR_MODELS.find((m) => m.id === modelId);
  const minVram = catalog?.minVramGb ?? 8;
  const proprietary = catalog?.proprietary ?? false;

  return gpus.filter((gpu) => {
    if (!gpu.isAvailable || gpu.obtainabilityLabel === 'Out of Stock') return false;
    if (gpu.vramGb < minVram && gpu.provider !== 'bedrock' && !proprietary) return false;
    if (proprietary && !['bedrock', 'sagemaker'].includes(gpu.provider)) {
      return false;
    }
    return true;
  });
}

export function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

export function estimatePromptTokens(prompt: string): number {
  const trimmed = prompt.trim();
  if (!trimmed) return 0;
  return Math.max(1, Math.ceil(trimmed.length / 4));
}

export interface JobForecastInput {
  gpu: GpuPricingItem;
  bidUsdPerHour: number;
  maxNewTokens: number;
  promptTokens?: number;
  coldStartSec?: number;
}

export interface JobForecast {
  tokensPerSec: number;
  forecastedExecutionMs: number;
  forecastedCostUsd: number;
  throughputEvidence: 'provider-reported' | 'estimated';
  rateEvidence: 'provider-reported' | 'estimated';
}

export function forecastJobCostTime(input: JobForecastInput): JobForecast {
  const { tokensPerSec: rawTps, evidence } = resolveTokensPerSec(input.gpu);
  const tokensPerSec = Math.max(1, rawTps);
  const coldStart =
    input.coldStartSec ??
    (input.gpu.pricingModel === 'serverless' ? 8 : 0.08);
  const execSeconds = input.maxNewTokens / tokensPerSec + coldStart;
  const hourly = Math.max(0, input.bidUsdPerHour);
  const costUsd =
    input.gpu.provider === 'local' || input.gpu.provider === 'local_pytorch'
      ? 0
      : Number(((hourly / 3600) * execSeconds).toFixed(6));

  return {
    tokensPerSec,
    forecastedExecutionMs: Math.round(execSeconds * 1000),
    forecastedCostUsd: costUsd,
    throughputEvidence: evidence,
    rateEvidence: 'provider-reported',
  };
}

export function buildPlacementParameters(
  selection: PlacementSelection
): Record<string, unknown> {
  return {
    provider: selection.provider,
    pricingModel: selection.pricingModel,
    hardwareSkuId: selection.hardwareSkuId,
    hardwareDisplayName: selection.hardwareDisplayName,
    bidUsdPerHour: selection.bidUsdPerHour,
    bidMode: selection.bidMode,
    tokensPerSec: selection.tokensPerSec,
    forecastedExecutionMs: selection.forecastedExecutionMs,
    forecastedCostUsd: selection.forecastedCostUsd,
    interruptionRiskTier: selection.interruptionRiskTier,
    noticeWindowLabel: selection.noticeWindowLabel,
    rateEvidence: selection.rateEvidence,
    throughputEvidence: selection.throughputEvidence,
  };
}

export function matchGpuFromPrefill(
  gpus: GpuPricingItem[],
  prefill: SubmitJobPrefill
): GpuPricingItem | null {
  if (prefill.gpuId) {
    const byId = gpus.find((g) => g.id === prefill.gpuId);
    if (byId) return byId;
  }
  if (prefill.provider && prefill.hardwareSkuId && prefill.pricingModel) {
    const exact = gpus.find(
      (g) =>
        g.provider === prefill.provider &&
        g.hardwareSkuId === prefill.hardwareSkuId &&
        g.pricingModel === prefill.pricingModel
    );
    if (exact) return exact;
  }
  if (prefill.provider && prefill.hardwareSkuId) {
    return (
      gpus.find(
        (g) =>
          g.provider === prefill.provider && g.hardwareSkuId === prefill.hardwareSkuId
      ) || null
    );
  }
  return null;
}

/** Engines honored by the local Python worker (`ExecutionEngine`). */
export const EXECUTION_ENGINES = [
  'auto',
  'eager',
  'torchscript',
  'torch-compile',
  'numpy',
  'onnx',
  'vllm',
] as const;

export type ExecutionEngineId = (typeof EXECUTION_ENGINES)[number];

export const ENGINE_TOOLTIPS: Record<ExecutionEngineId, string> = {
  auto: 'Worker picks the best local engine and may auto-upgrade (e.g. TorchScript → torch.compile).',
  eager: 'Standard PyTorch eager execution. Best for debugging and broad model support.',
  torchscript: 'TorchScript traced/scripted path. Legacy optimized runtime.',
  'torch-compile': 'PyTorch 2.x torch.compile (Inductor). Higher throughput after compile warmup.',
  numpy: 'CPU NumPy fallback. No GPU kernels; useful for CI and tiny demos.',
  onnx: 'ONNX Runtime path when an exported graph is available.',
  vllm: 'vLLM high-throughput LLM serving. Text/code models on CUDA only.',
};

export interface InferenceParamFormState {
  engine: ExecutionEngineId;
  device: '' | 'cpu' | 'cuda';
  temperature: number;
  maxNewTokens: number;
  allowAutoUpgrade: boolean;
  useTorchscript: boolean;
  seed: string;
  width: number;
  height: number;
  numInferenceSteps: number;
  guidanceScale: number;
  fps: number;
  durationSeconds: number;
  /** Whisper / ASR language hint (empty = auto-detect). */
  language: string;
  /** Whisper task. */
  audioTask: 'transcribe' | 'translate';
  mediaAssetUri: string;
  inputUri: string;
  /** Extra uploaded asset URIs when multiple files are selected. */
  additionalInputUris: string[];
  expiresInSeconds: number;
}

export const DEFAULT_INFERENCE_PARAMS: InferenceParamFormState = {
  engine: 'auto',
  device: '',
  temperature: 0.7,
  maxNewTokens: 128,
  allowAutoUpgrade: true,
  useTorchscript: false,
  seed: '',
  width: 1024,
  height: 1024,
  numInferenceSteps: 4,
  guidanceScale: 0,
  fps: 24,
  durationSeconds: 3,
  language: '',
  audioTask: 'transcribe',
  mediaAssetUri: '',
  inputUri: '',
  additionalInputUris: [],
  expiresInSeconds: 3600,
};

export const INFERENCE_PARAM_TOOLTIPS = {
  engine: 'Local execution backend. Cloud providers may ignore this and use their own runtime.',
  device: 'Force cpu or cuda on the local worker. Leave empty to infer from routing (local/cpu → cpu, local/gpu → cuda).',
  temperature: 'Sampling temperature for text generation (0 = greedy). Default 0.7. Used by local, Bedrock, and SageMaker paths.',
  maxNewTokens: 'Maximum new tokens to generate. Also accepted as max_tokens. Default 128 in the UI; worker default is 1024 if omitted.',
  allowAutoUpgrade: 'When engine is torchscript/auto, allow transparent upgrade to torch.compile when supported.',
  useTorchscript: 'Legacy flag that forces TorchScript when engine is auto or eager.',
  seed: 'Optional deterministic seed for diffusion / media jobs (provider-dependent).',
  width: 'Output width in pixels for image/video generation.',
  height: 'Output height in pixels for image/video generation.',
  numInferenceSteps:
    'Denoising steps. FLUX schnell / SD-Turbo: 2–4. Wan / CogVideoX: use 20–30 (≤8 is a fast noisy preview).',
  guidanceScale:
    'Classifier-free guidance. 0 for distilled image models (FLUX schnell / SD-Turbo); ~5 for Wan / CogVideoX.',
  fps: 'Frames per second for text-to-video synthesis (Wan commonly 16).',
  durationSeconds: 'Clip length in seconds (frames ≈ fps × duration). Keep ≤5 s for Wan 1.3B.',
  mediaAssetUri: 'Optional nested media URI under input.parameters (auto-filled from upload).',
  inputUri: 'Top-level S3/object URI for multimodal input. Upload files below to generate and save URIs.',
  expiresInSeconds: 'Job TTL before expiry reap (seconds). API default 3600; max 604800.',
  weights:
    'On: load real Hugging Face / Diffusers checkpoints for the selected open-weight model (text, image, video, Whisper). Off: synthetic/reference geometry. Proprietary API models (e.g. Claude on Bedrock) do not use local HF weights.',
  priority: 'Queue priority 1–10 (higher is served sooner).',
  maxRetries: 'Automatic retries before the job is failed / DLQ-routed.',
  modelQuantization:
    'Quantization is a property of the model variant (e.g. FLUX NF4). Pick the matching model id — providers do not quantize on the fly.',
  language: 'Optional ASR language code (e.g. en, es). Empty lets Whisper auto-detect.',
  audioTask: 'Whisper task: transcribe speech in the source language, or translate into English.',
} as const;

/** Map browser MIME / extension to UploadUrlSchema-accepted content_type. */
export function normalizeUploadContentType(file: File): string | null {
  const mime = (file.type || '').toLowerCase().trim();
  const name = file.name.toLowerCase();
  const allowed = new Set([
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'video/mp4',
    'video/quicktime',
    'audio/mpeg',
    'audio/mp3',
    'audio/wav',
    'audio/x-wav',
    'audio/webm',
    'audio/mp4',
    'audio/flac',
    'application/pdf',
    'jpeg',
    'jpg',
    'png',
    'webp',
    'mp4',
    'quicktime',
    'mp3',
    'mpeg',
    'wav',
    'webm',
    'flac',
    'pdf',
  ]);
  if (mime && allowed.has(mime)) return mime;
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg';
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.webp')) return 'image/webp';
  if (name.endsWith('.mp4')) return 'video/mp4';
  if (name.endsWith('.mov')) return 'video/quicktime';
  if (name.endsWith('.mp3')) return 'audio/mpeg';
  if (name.endsWith('.wav')) return 'audio/wav';
  if (name.endsWith('.webm')) return 'audio/webm';
  if (name.endsWith('.flac')) return 'audio/flac';
  if (name.endsWith('.m4a')) return 'audio/mp4';
  if (name.endsWith('.pdf')) return 'application/pdf';
  return null;
}

export function isEngineSoftDisabled(
  engine: ExecutionEngineId,
  purpose: string,
  routingPreference: string
): { disabled: boolean; reason?: string } {
  if (routingPreference === 'mock' && engine !== 'auto') {
    return { disabled: true, reason: 'Mock routing ignores engine choice; keep auto.' };
  }
  if (engine === 'vllm') {
    const textLike = purpose === 'text_to_text' || purpose === 'code_reasoning' || purpose === 'all';
    if (!textLike) {
      return { disabled: true, reason: 'vLLM is for text/code LLM workloads.' };
    }
  }
  if (engine === 'numpy' && (purpose === 'text_to_image' || purpose === 'text_to_video')) {
    return { disabled: true, reason: 'NumPy fallback is not used for diffusion/video pipelines.' };
  }
  return { disabled: false };
}

/** Local HF/Diffusers checkpoints — false for proprietary managed APIs. */
export function supportsLocalProductionWeights(modelId: string): boolean {
  const catalog = POPULAR_MODELS.find((m) => m.id === modelId);
  if (catalog?.proprietary) return false;
  const mid = modelId.toLowerCase();
  if (mid.startsWith('anthropic/') || mid.startsWith('openai/gpt') || mid.includes('claude')) {
    return false;
  }
  return true;
}

export function buildInferenceParameters(
  form: InferenceParamFormState,
  options: { useProductionWeights: boolean; purpose: string }
): Record<string, unknown> {
  const sections = paramSectionsForPurpose(options.purpose);
  const parameters: Record<string, unknown> = {
    engine: form.engine,
    allow_auto_upgrade: form.allowAutoUpgrade,
    use_torchscript: form.useTorchscript,
  };

  if (options.useProductionWeights) {
    parameters.weights = 'production';
  } else {
    parameters.weights = 'synthetic';
  }

  if (form.device) {
    parameters.device = form.device;
  }

  if (sections.text) {
    parameters.temperature = form.temperature;
    parameters.max_new_tokens = form.maxNewTokens;
  }

  if (sections.image) {
    parameters.width = form.width;
    parameters.height = form.height;
    parameters.num_inference_steps = form.numInferenceSteps;
    parameters.guidance_scale = form.guidanceScale;
  }

  if (sections.video) {
    parameters.width = form.width;
    parameters.height = form.height;
    parameters.num_inference_steps = form.numInferenceSteps;
    parameters.guidance_scale = form.guidanceScale;
    parameters.fps = form.fps;
    parameters.duration_seconds = form.durationSeconds;
  }

  if (sections.audio) {
    parameters.task = form.audioTask;
    if (form.language.trim()) {
      parameters.language = form.language.trim();
    }
  }

  if ((sections.image || sections.video) && form.seed.trim() !== '') {
    const seedNum = Number(form.seed);
    if (!Number.isNaN(seedNum)) {
      parameters.seed = seedNum;
    }
  }

  if (sections.mediaInput || form.mediaAssetUri.trim()) {
    if (form.mediaAssetUri.trim()) {
      parameters.media_asset_uri = form.mediaAssetUri.trim();
    }
  }

  if (form.additionalInputUris.length > 0) {
    parameters.additional_input_uris = form.additionalInputUris;
  }

  return parameters;
}
