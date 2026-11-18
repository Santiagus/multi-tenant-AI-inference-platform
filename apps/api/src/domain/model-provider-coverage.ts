/**
 * Mirror of dashboard modelProviderCoverage — keep ids in sync with
 * apps/dashboard/src/components/jobs/modelProviderCoverage.ts + POPULAR_MODELS.
 * Used by FinOps recommend-options to only surface providers that can run the model.
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
  | 'sagemaker'
  | 'fal_ai'; // legacy alias in some option payloads

const GPU_BYO: CompareProviderId[] = [
  'local_pytorch',
  'runpod',
  'vast_ai',
  'baseten',
  'jarvislabs',
  'nebius',
  'coreweave',
];

export const MODEL_PROVIDER_COVERAGE: Record<string, CompareProviderId[]> = {
  'TinyLlama/TinyLlama-1.1B-Chat-v1.0': [...GPU_BYO],
  'Qwen/Qwen2.5-7B-Instruct': [...GPU_BYO],
  'mistralai/Mistral-7B-Instruct-v0.2': [...GPU_BYO],
  'deepseek-ai/DeepSeek-R1-Distill-Qwen-7B': [...GPU_BYO],
  'anthropic/claude-3-haiku': ['bedrock'],
  'stabilityai/sd-turbo': [...GPU_BYO],
  'black-forest-labs/FLUX.1-schnell': [...GPU_BYO, 'fal', 'runware'],
  'openai/clip-vit-large-patch14': [...GPU_BYO],
  'openai/whisper-tiny': [...GPU_BYO, 'fal'],
  'openai/whisper-large-v3': [...GPU_BYO, 'fal'],
  'Lightricks/LTX-Video': [...GPU_BYO, 'fal'],
  'Wan-AI/Wan2.1-T2V-1.3B': [...GPU_BYO, 'fal'],
};

function normalizeProvider(provider: string): string {
  if (provider === 'fal_ai') return 'fal';
  return provider;
}

export function providersForModel(modelId: string): CompareProviderId[] | null {
  const hit = MODEL_PROVIDER_COVERAGE[modelId];
  return hit ? [...hit] : null;
}

/** When the model is in the compare catalog, drop options whose provider is not listed. */
export function filterOptionsByModelCoverage<T extends { provider: string }>(
  modelId: string,
  options: T[]
): T[] {
  const allowed = providersForModel(modelId);
  if (!allowed) return options;
  const set = new Set(allowed.map(normalizeProvider));
  return options.filter((o) => set.has(normalizeProvider(o.provider)));
}
