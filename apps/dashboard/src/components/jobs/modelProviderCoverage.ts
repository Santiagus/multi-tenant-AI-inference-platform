/**
 * Cross-provider availability for Submit Job catalog models.
 * Used so the same model_id (and defaults) can be dispatched locally and to
 * configured providers for metric comparison.
 *
 * Evidence classes:
 * - gpu_byo: open HF weights on a rented GPU (local / RunPod / Vast / …)
 * - hosted: provider-managed endpoint with a known model slug
 * - api: proprietary managed API (Bedrock, …)
 */

export type CompareProviderId =
  | 'local_pytorch'
  | 'runpod'
  | 'vast_ai'
  | 'baseten'
  | 'jarvislabs'
  | 'nebius'
  | 'coreweave'
  | 'fal'
  | 'runware'
  | 'bedrock'
  | 'sagemaker';

/** Providers that can pull arbitrary open HF weights onto a GPU large enough for the model. */
export const GPU_BYO_PROVIDERS: CompareProviderId[] = [
  'local_pytorch',
  'runpod',
  'vast_ai',
  'baseten',
  'jarvislabs',
  'nebius',
  'coreweave',
];

export const PROVIDER_DISPLAY: Record<CompareProviderId, string> = {
  local_pytorch: 'Local',
  runpod: 'RunPod',
  vast_ai: 'Vast.ai',
  baseten: 'Baseten',
  jarvislabs: 'JarvisLabs',
  nebius: 'Nebius',
  coreweave: 'CoreWeave',
  fal: 'fal.ai',
  runware: 'Runware',
  bedrock: 'Bedrock',
  sagemaker: 'SageMaker',
};

export interface ModelCompareCoverage {
  /** Providers that can execute this catalog model_id for A/B metrics. */
  providers: CompareProviderId[];
  /**
   * Optional hosted endpoint / slug when the MaaS id differs from the Hub id.
   * Job payload still uses the Hub catalog id; adapters map at dispatch time.
   */
  hostedEndpoints?: Partial<Record<CompareProviderId, string>>;
  /**
   * Local HF hub id when the on-disk / VRAM-fit variant differs (e.g. NF4 FLUX).
   * Cloud BYO still uses the canonical catalog id.
   */
  localHubId?: string;
  /** Short note shown in Submit Job. */
  note?: string;
}

/**
 * Canonical compare set — every Submit Job popular model must have an entry.
 * Prefer Hub ids that GPU BYO providers can load unchanged.
 */
export const MODEL_PROVIDER_COVERAGE: Record<string, ModelCompareCoverage> = {
  'TinyLlama/TinyLlama-1.1B-Chat-v1.0': {
    providers: [...GPU_BYO_PROVIDERS],
    note: 'Open SLM · identical Hub id on local + GPU BYO clouds',
  },
  'Qwen/Qwen2.5-7B-Instruct': {
    providers: [...GPU_BYO_PROVIDERS],
    note: 'Open 7B · local INT4 · cloud BYO FP16/INT4 on ≥16–24 GB',
  },
  'mistralai/Mistral-7B-Instruct-v0.2': {
    providers: [...GPU_BYO_PROVIDERS],
    note: 'Open 7B · local INT4 · cloud BYO on ≥16–24 GB',
  },
  'deepseek-ai/DeepSeek-R1-Distill-Qwen-7B': {
    providers: [...GPU_BYO_PROVIDERS],
    note: 'Open reasoning distill · local INT4 · cloud BYO on ≥16–24 GB',
  },
  'anthropic/claude-3-haiku': {
    providers: ['bedrock'],
    hostedEndpoints: { bedrock: 'anthropic.claude-3-haiku-20240307-v1:0' },
    note: 'Proprietary · Bedrock only (no local / GPU BYO weights)',
  },
  'stabilityai/sd-turbo': {
    providers: [...GPU_BYO_PROVIDERS],
    note: 'Open turbo diffusion · exact Hub id on local + GPU BYO (hosted fal/runware catalogs use different SD family ids)',
  },
  'black-forest-labs/FLUX.1-schnell': {
    providers: [...GPU_BYO_PROVIDERS, 'fal', 'runware'],
    localHubId: 'magespace/FLUX.1-schnell-bnb-nf4',
    hostedEndpoints: {
      fal: 'fal-ai/flux/schnell',
      runware: 'bfl:flux.1-schnell',
    },
    note: 'Canonical FLUX.1 schnell · local loads NF4 pack · fal-ai/flux/schnell + Runware hosted',
  },
  'openai/clip-vit-large-patch14': {
    providers: [...GPU_BYO_PROVIDERS],
    note: 'Open CLIP · GPU BYO / local (not a typical fal/runware product endpoint)',
  },
  'openai/whisper-tiny': {
    providers: [...GPU_BYO_PROVIDERS, 'fal'],
    hostedEndpoints: { fal: 'fal-ai/whisper' },
    note: 'Open Whisper · exact Hub on BYO; fal-ai/whisper hosts Whisper family',
  },
  'openai/whisper-large-v3': {
    providers: [...GPU_BYO_PROVIDERS, 'fal'],
    hostedEndpoints: { fal: 'fal-ai/wizper' },
    note: 'Open Whisper large-v3 · BYO Hub id; fal wizper = Whisper v3 optimized',
  },
  'Lightricks/LTX-Video': {
    providers: [...GPU_BYO_PROVIDERS, 'fal'],
    hostedEndpoints: { fal: 'fal-ai/ltx-video' },
    note: 'Open LTX-Video · ~10 GB VRAM resident · fal-ai/ltx-video + GPU BYO',
  },
  'Wan-AI/Wan2.1-T2V-1.3B': {
    providers: [...GPU_BYO_PROVIDERS, 'fal'],
    localHubId: 'Wan-AI/Wan2.1-T2V-1.3B-Diffusers',
    hostedEndpoints: { fal: 'fal-ai/wan/v2.1/1.3b/text-to-video' },
    note: 'Open Wan 2.1 T2V · local 16 GB CPU offload · GPU BYO + fal 1.3B endpoint',
  },
};

export function coverageForModel(modelId: string): ModelCompareCoverage | undefined {
  return MODEL_PROVIDER_COVERAGE[modelId];
}

export function compareProvidersForModel(modelId: string): CompareProviderId[] {
  return coverageForModel(modelId)?.providers ?? [];
}

export function formatCompareProviders(modelId: string): string {
  const providers = compareProvidersForModel(modelId);
  if (providers.length === 0) return 'no mapped providers';
  return providers.map((p) => PROVIDER_DISPLAY[p] ?? p).join(' · ');
}

/** True when local + ≥1 cloud provider can run the same catalog id (compare-ready). */
export function isCrossProviderComparable(modelId: string): boolean {
  const providers = compareProvidersForModel(modelId);
  const hasLocal = providers.includes('local_pytorch');
  const hasCloud = providers.some((p) => p !== 'local_pytorch');
  return hasLocal && hasCloud;
}
