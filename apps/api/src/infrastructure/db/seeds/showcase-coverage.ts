/**
 * Explicit tenant-demo showcase coverage matrix.
 * Duration-metered placements only (no hourly-only / long-term / reserved SKUs).
 */

export type ShowcaseModality =
  | 'text_to_text'
  | 'code_reasoning'
  | 'text_to_image'
  | 'text_to_video'
  | 'speech_to_text'
  | 'media_photo';

export type ShowcasePlacement = 'local' | 'spot' | 'serverless' | 'token_factory' | 'pay_per_call';

export const SHOWCASE_STATUSES = [
  'SUBMITTED',
  'QUEUED',
  'PROCESSING',
  'RETRYING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
] as const;

/** Submit-modal priority presets. */
export const SHOWCASE_PRIORITIES = [1, 5, 8, 10] as const;

/** Submit-facing routing preferences (API + SubmitJobModal). */
export const SHOWCASE_ROUTING_STRATEGIES = [
  'auto',
  'mock',
  'local_first',
  'cost_optimized',
  'low_latency',
  'local',
  'local/cpu',
  'local/gpu',
  'cloud',
  'cloud/runpod',
  'cloud/bedrock',
  'cloud/sagemaker',
] as const;

export const SHOWCASE_MODALITIES: ShowcaseModality[] = [
  'text_to_text',
  'code_reasoning',
  'text_to_image',
  'text_to_video',
  'speech_to_text',
  'media_photo',
];

/** Worker/UI engines that must appear in painted payloads. */
export const SHOWCASE_ENGINES = [
  { executed: 'auto', requested: 'auto', device: 'cuda' as const },
  { executed: 'eager', requested: 'eager', device: 'cpu' as const },
  { executed: 'torchscript', requested: 'torchscript', device: 'cuda' as const },
  { executed: 'torch-compile', requested: 'torch-compile', device: 'cuda' as const },
  { executed: 'numpy', requested: 'numpy', device: 'cpu' as const },
  { executed: 'onnx', requested: 'onnx', device: 'cpu' as const },
  { executed: 'vllm', requested: 'vllm', device: 'cuda' as const },
] as const;

/**
 * Duration-metered providers (bill while job runs / per token / per call).
 * Excludes hourly-only on_demand (nebius, neocloudz) and reserved capacity.
 */
export const DURATION_METERED_PROVIDERS: ReadonlyArray<{
  provider: string;
  routing: string;
  hardware: string;
  placement: ShowcasePlacement;
}> = [
  { provider: 'local', routing: 'local/gpu', hardware: 'RTX 5070 Ti (16 GB)', placement: 'local' },
  { provider: 'runpod', routing: 'cloud/runpod', hardware: 'RTX 4090 (24 GB)', placement: 'spot' },
  { provider: 'vast_ai', routing: 'auto', hardware: 'RTX 5090 Blackwell (32 GB)', placement: 'spot' },
  { provider: 'coreweave', routing: 'auto', hardware: 'L40S (48 GB)', placement: 'spot' },
  { provider: 'hivenet', routing: 'auto', hardware: 'A100 80GB (80 GB)', placement: 'spot' },
  { provider: 'baseten', routing: 'auto', hardware: 'L4 Tensor Core (24 GB)', placement: 'serverless' },
  { provider: 'wavespeed', routing: 'auto', hardware: 'L40S (48 GB)', placement: 'serverless' },
  { provider: 'jarvislabs', routing: 'auto', hardware: 'Token Factory', placement: 'token_factory' },
  { provider: 'bedrock', routing: 'cloud/bedrock', hardware: 'AWS Bedrock', placement: 'token_factory' },
  { provider: 'fal', routing: 'auto', hardware: 'Tensor Core Pipeline', placement: 'pay_per_call' },
  { provider: 'runware', routing: 'auto', hardware: 'Tensor Core Pipeline', placement: 'pay_per_call' },
];

export const REQUIRED_PLACEMENTS: ShowcasePlacement[] = [
  'local',
  'spot',
  'serverless',
  'token_factory',
  'pay_per_call',
];

export interface ModelSpec {
  model: string;
  modality: ShowcaseModality;
  inTok: number;
  outTok: number;
  durMs: number;
  cost: number;
}

export const MODELS_BY_MODALITY: Record<ShowcaseModality, ModelSpec> = {
  text_to_text: {
    model: 'meta-llama/llama-3-8b',
    modality: 'text_to_text',
    inTok: 2048,
    outTok: 512,
    durMs: 840,
    cost: 240,
  },
  code_reasoning: {
    model: 'deepseek-ai/deepseek-r1',
    modality: 'code_reasoning',
    inTok: 8192,
    outTok: 2048,
    durMs: 4100,
    cost: 820,
  },
  text_to_image: {
    model: 'black-forest-labs/flux-1-schnell',
    modality: 'text_to_image',
    inTok: 64,
    outTok: 0,
    durMs: 2300,
    cost: 690,
  },
  text_to_video: {
    model: 'THUDM/cogvideox-5b',
    modality: 'text_to_video',
    inTok: 120,
    outTok: 0,
    durMs: 10700,
    cost: 2140,
  },
  speech_to_text: {
    model: 'openai/whisper-large-v3',
    modality: 'speech_to_text',
    inTok: 500,
    outTok: 250,
    durMs: 1600,
    cost: 320,
  },
  media_photo: {
    model: 'openai/clip-vit-large-patch14',
    modality: 'media_photo',
    inTok: 256,
    outTok: 0,
    durMs: 180,
    cost: 40,
  },
};

export interface SeedJobTemplate {
  model: string;
  modality: ShowcaseModality;
  inTok: number;
  outTok: number;
  durMs: number;
  cost: number;
  tenant: string;
  status: string;
  provider: string;
  routing: string;
  hardware: string;
  priority: number;
  engineExecuted: string;
  engineRequested: string;
  device: 'cpu' | 'cuda';
  retryCount?: number;
  maxRetries?: number;
  errorCode?: string | null;
  errorMessage?: string | null;
  /** When true, seed also publishes a DLQ envelope for this job. */
  seedDlq?: boolean;
}

function modelForIndex(i: number): ModelSpec {
  return MODELS_BY_MODALITY[SHOWCASE_MODALITIES[i % SHOWCASE_MODALITIES.length]];
}

function priorityForIndex(i: number): number {
  return SHOWCASE_PRIORITIES[i % SHOWCASE_PRIORITIES.length];
}

function providerForRouting(routing: string): {
  provider: string;
  hardware: string;
  device: 'cpu' | 'cuda';
} {
  if (routing === 'mock' || routing === 'local' || routing === 'local_first') {
    return { provider: 'local', hardware: 'RTX 5070 Ti (16 GB)', device: 'cuda' };
  }
  if (routing === 'local/cpu') {
    return { provider: 'local', hardware: 'CPU Fallback', device: 'cpu' };
  }
  if (routing === 'local/gpu') {
    return { provider: 'local', hardware: 'RTX 5070 Ti (16 GB)', device: 'cuda' };
  }
  if (routing.includes('runpod') || routing === 'cloud' || routing === 'low_latency') {
    return { provider: 'runpod', hardware: 'RTX 4090 (24 GB)', device: 'cuda' };
  }
  if (routing.includes('bedrock')) {
    return { provider: 'bedrock', hardware: 'AWS Bedrock', device: 'cuda' };
  }
  if (routing.includes('sagemaker')) {
    // Routing-strategy coverage only; modest Inferentia SKU (not hourly reserved).
    return { provider: 'sagemaker', hardware: 'Inferentia2 / G5 (24 GB)', device: 'cuda' };
  }
  if (routing === 'cost_optimized') {
    return { provider: 'vast_ai', hardware: 'RTX 4090 (24 GB)', device: 'cuda' };
  }
  return { provider: 'runpod', hardware: 'RTX 4090 (24 GB)', device: 'cuda' };
}

export function telemetryBackend(
  engineExecuted: string,
  device: 'cpu' | 'cuda',
  engineRequested: string
): string {
  const executed = engineExecuted.toLowerCase();
  const requested = engineRequested.toLowerCase();
  if (executed === 'auto' || requested === 'auto') {
    return `pytorch_torchscript_${device}`;
  }
  if (executed === 'numpy') return `numpy_${device}`;
  if (executed === 'onnx') return `onnx_${device}`;
  if (executed === 'vllm') return `vllm_${device}`;
  if (executed === 'torch-compile') return `pytorch_torch_compile_${device}`;
  if (executed === 'torchscript') return `pytorch_torchscript_${device}`;
  return `pytorch_${device}`;
}

function pushJob(jobs: SeedJobTemplate[], partial: SeedJobTemplate): void {
  jobs.push(partial);
}

/**
 * Build the full painted job template list for tenant-demo (+ sparse cross-tenant).
 * Coverage is asserted by {@link assertShowcaseCoverage}.
 */
export function buildShowcaseJobTemplates(): SeedJobTemplate[] {
  const jobs: SeedJobTemplate[] = [];

  // (A) One job per lifecycle status.
  for (let i = 0; i < SHOWCASE_STATUSES.length; i++) {
    const status = SHOWCASE_STATUSES[i];
    const prov = DURATION_METERED_PROVIDERS[i % DURATION_METERED_PROVIDERS.length];
    const model = modelForIndex(i);
    const isCpu = prov.provider === 'local' && i % 2 === 1;
    pushJob(jobs, {
      ...model,
      tenant: 'tenant-demo',
      status,
      provider: isCpu ? 'local' : prov.provider,
      routing: isCpu ? 'local/cpu' : prov.routing,
      hardware: isCpu ? 'CPU Fallback' : prov.hardware,
      priority: priorityForIndex(i),
      engineExecuted: isCpu ? 'eager' : 'torchscript',
      engineRequested: isCpu ? 'eager' : 'torchscript',
      device: isCpu ? 'cpu' : 'cuda',
      retryCount: status === 'RETRYING' ? 1 : 0,
      errorCode: status === 'FAILED' ? 'INFERENCE_ERROR' : null,
      errorMessage: status === 'FAILED' ? 'Simulated showcase failure for filter demos' : null,
    });
  }

  // (B) One SUCCEEDED job per duration-metered provider (placement modes).
  for (let i = 0; i < DURATION_METERED_PROVIDERS.length; i++) {
    const prov = DURATION_METERED_PROVIDERS[i];
    const model = modelForIndex(i + 1);
    pushJob(jobs, {
      ...model,
      inTok: model.inTok + i * 16,
      outTok: model.outTok + (model.outTok > 0 ? i * 4 : 0),
      durMs: model.durMs + i * 35,
      cost: model.cost + i * 12,
      tenant: 'tenant-demo',
      status: 'SUCCEEDED',
      provider: prov.provider,
      routing: prov.routing,
      hardware: prov.hardware,
      priority: priorityForIndex(i + 2),
      engineExecuted: 'torch-compile',
      engineRequested: 'torch-compile',
      device: 'cuda',
    });
  }

  // (C) Explicit local CPU + local GPU jobs.
  pushJob(jobs, {
    ...MODELS_BY_MODALITY.speech_to_text,
    tenant: 'tenant-demo',
    status: 'SUCCEEDED',
    provider: 'local',
    routing: 'local/cpu',
    hardware: 'CPU Fallback',
    priority: 5,
    engineExecuted: 'numpy',
    engineRequested: 'numpy',
    device: 'cpu',
  });
  pushJob(jobs, {
    ...MODELS_BY_MODALITY.text_to_text,
    tenant: 'tenant-demo',
    status: 'SUCCEEDED',
    provider: 'local',
    routing: 'local/gpu',
    hardware: 'RTX 5070 Ti (16 GB)',
    priority: 8,
    engineExecuted: 'torchscript',
    engineRequested: 'torchscript',
    device: 'cuda',
  });

  // (D) One job per engine option.
  for (let i = 0; i < SHOWCASE_ENGINES.length; i++) {
    const eng = SHOWCASE_ENGINES[i];
    const model =
      eng.device === 'cpu' ? MODELS_BY_MODALITY.speech_to_text : modelForIndex(i + 3);
    pushJob(jobs, {
      ...model,
      tenant: 'tenant-demo',
      status: 'SUCCEEDED',
      provider: 'local',
      routing: eng.device === 'cpu' ? 'local/cpu' : 'local/gpu',
      hardware: eng.device === 'cpu' ? 'CPU Fallback' : 'RTX 5070 Ti (16 GB)',
      priority: priorityForIndex(i),
      engineExecuted: eng.executed,
      engineRequested: eng.requested,
      device: eng.device,
    });
  }

  // (E) One job per submit-facing routing strategy.
  for (let i = 0; i < SHOWCASE_ROUTING_STRATEGIES.length; i++) {
    const routing = SHOWCASE_ROUTING_STRATEGIES[i];
    const target = providerForRouting(routing);
    const model = modelForIndex(i + 2);
    pushJob(jobs, {
      ...model,
      tenant: 'tenant-demo',
      status: i % 3 === 0 ? 'QUEUED' : 'SUCCEEDED',
      provider: target.provider,
      routing,
      hardware: target.hardware,
      priority: priorityForIndex(i + 1),
      engineExecuted: target.device === 'cpu' ? 'eager' : 'eager',
      engineRequested: 'eager',
      device: target.device,
    });
  }

  // (F) Modality gap-fill — ensure every ModelPurpose has a dedicated SUCCEEDED row.
  for (const modality of SHOWCASE_MODALITIES) {
    const model = MODELS_BY_MODALITY[modality];
    const useCpu = modality === 'speech_to_text' || modality === 'media_photo';
    pushJob(jobs, {
      ...model,
      tenant: 'tenant-demo',
      status: 'SUCCEEDED',
      provider: useCpu ? 'local' : 'fal',
      routing: useCpu ? 'local/cpu' : 'auto',
      hardware: useCpu ? 'CPU Fallback' : 'Tensor Core Pipeline',
      priority: 1,
      engineExecuted: useCpu ? 'numpy' : 'torchscript',
      engineRequested: useCpu ? 'numpy' : 'torchscript',
      device: useCpu ? 'cpu' : 'cuda',
    });
  }

  // (G) DLQ poison pill — FAILED after exhausting retries.
  pushJob(jobs, {
    ...MODELS_BY_MODALITY.text_to_image,
    tenant: 'tenant-demo',
    status: 'FAILED',
    provider: 'runpod',
    routing: 'cloud/runpod',
    hardware: 'RTX 4090 (24 GB)',
    priority: 10,
    engineExecuted: 'torchscript',
    engineRequested: 'torchscript',
    device: 'cuda',
    retryCount: 3,
    maxRetries: 3,
    errorCode: 'INFERENCE_ERROR',
    errorMessage: 'Showcase DLQ fixture: retries exhausted; envelope quarantined',
    seedDlq: true,
  });

  // (H) Extra in-flight variety on tenant-demo.
  pushJob(jobs, {
    ...MODELS_BY_MODALITY.code_reasoning,
    inTok: 4096,
    outTok: 1024,
    durMs: 2200,
    cost: 440,
    tenant: 'tenant-demo',
    status: 'PROCESSING',
    provider: 'runpod',
    routing: 'cloud/runpod',
    hardware: 'RTX 4090 (24 GB)',
    priority: 8,
    engineExecuted: 'vllm',
    engineRequested: 'vllm',
    device: 'cuda',
  });
  pushJob(jobs, {
    ...MODELS_BY_MODALITY.text_to_video,
    inTok: 90,
    outTok: 0,
    durMs: 9800,
    cost: 1960,
    tenant: 'tenant-demo',
    status: 'FAILED',
    provider: 'vast_ai',
    routing: 'auto',
    hardware: 'RTX 5090 Blackwell (32 GB)',
    priority: 5,
    engineExecuted: 'torch-compile',
    engineRequested: 'torch-compile',
    device: 'cuda',
    errorCode: 'PROVIDER_TIMEOUT',
    errorMessage: 'Provider auction timed out before worker claim',
  });
  pushJob(jobs, {
    ...MODELS_BY_MODALITY.speech_to_text,
    tenant: 'tenant-demo',
    status: 'RETRYING',
    provider: 'baseten',
    routing: 'auto',
    hardware: 'L4 Tensor Core (24 GB)',
    priority: 1,
    engineExecuted: 'eager',
    engineRequested: 'eager',
    device: 'cuda',
    retryCount: 2,
  });
  pushJob(jobs, {
    ...MODELS_BY_MODALITY.text_to_image,
    tenant: 'tenant-demo',
    status: 'CANCELLED',
    provider: 'fal',
    routing: 'auto',
    hardware: 'Tensor Core Pipeline',
    priority: 5,
    engineExecuted: 'torchscript',
    engineRequested: 'torchscript',
    device: 'cuda',
  });

  // (I) Sparse cross-tenant rows for "All Tenants".
  const otherTenants: Array<{ tenant: string; status: string; provider: string; routing: string; hardware: string }> =
    [
      {
        tenant: 'tenant-default',
        status: 'SUCCEEDED',
        provider: 'vast_ai',
        routing: 'auto',
        hardware: 'RTX 5090 Blackwell (32 GB)',
      },
      {
        tenant: 'tenant-acme',
        status: 'SUCCEEDED',
        provider: 'runpod',
        routing: 'auto',
        hardware: 'RTX 4090 (24 GB)',
      },
      {
        tenant: 'tenant-finops',
        status: 'SUCCEEDED',
        provider: 'vast_ai',
        routing: 'auto',
        hardware: 'RTX 5090 Blackwell (32 GB)',
      },
      {
        tenant: 'tenant-enterprise',
        status: 'SUCCEEDED',
        provider: 'fal',
        routing: 'auto',
        hardware: 'Tensor Core Pipeline',
      },
      {
        tenant: 'tenant-default',
        status: 'SUCCEEDED',
        provider: 'runpod',
        routing: 'auto',
        hardware: 'RTX 4090 (24 GB)',
      },
      {
        tenant: 'tenant-acme',
        status: 'SUCCEEDED',
        provider: 'baseten',
        routing: 'auto',
        hardware: 'L4 Tensor Core (24 GB)',
      },
      {
        tenant: 'tenant-finops',
        status: 'SUCCEEDED',
        provider: 'local',
        routing: 'local/gpu',
        hardware: 'RTX 5070 Ti (16 GB)',
      },
      {
        tenant: 'tenant-enterprise',
        status: 'PROCESSING',
        provider: 'vast_ai',
        routing: 'auto',
        hardware: 'RTX 5090 Blackwell (32 GB)',
      },
      {
        tenant: 'tenant-default',
        status: 'QUEUED',
        provider: 'runpod',
        routing: 'auto',
        hardware: 'RTX 4090 (24 GB)',
      },
    ];

  for (let i = 0; i < otherTenants.length; i++) {
    const row = otherTenants[i];
    const model = modelForIndex(i);
    pushJob(jobs, {
      ...model,
      tenant: row.tenant,
      status: row.status,
      provider: row.provider,
      routing: row.routing,
      hardware: row.hardware,
      priority: priorityForIndex(i),
      engineExecuted: 'torchscript',
      engineRequested: 'torchscript',
      device: 'cuda',
    });
  }

  assertShowcaseCoverage(jobs);
  return jobs;
}

export interface ShowcaseCoverageSnapshot {
  statuses: Set<string>;
  engines: Set<string>;
  modalities: Set<string>;
  routings: Set<string>;
  priorities: Set<number>;
  placements: Set<string>;
  hasLocalCpu: boolean;
  hasLocalGpu: boolean;
  hasDlqFixture: boolean;
  tenantDemoCount: number;
}

export function placementForProvider(provider: string, routing: string): ShowcasePlacement | 'unknown' {
  if (
    routing.includes('local') ||
    provider === 'local' ||
    provider === 'local_pytorch' ||
    provider === 'local_cpu_worker'
  ) {
    return 'local';
  }
  if (provider === 'jarvislabs' || provider === 'bedrock') return 'token_factory';
  if (provider === 'baseten' || provider === 'wavespeed') return 'serverless';
  if (provider === 'runware' || provider === 'fal') return 'pay_per_call';
  if (
    provider === 'runpod' ||
    provider === 'vast_ai' ||
    provider === 'coreweave' ||
    provider === 'hivenet'
  ) {
    return 'spot';
  }
  return 'unknown';
}

export function collectShowcaseCoverage(jobs: SeedJobTemplate[]): ShowcaseCoverageSnapshot {
  const demo = jobs.filter((j) => j.tenant === 'tenant-demo');
  return {
    statuses: new Set(demo.map((j) => j.status)),
    engines: new Set(demo.map((j) => j.engineExecuted)),
    modalities: new Set(demo.map((j) => j.modality)),
    routings: new Set(demo.map((j) => j.routing)),
    priorities: new Set(demo.map((j) => j.priority)),
    placements: new Set(
      demo.map((j) => placementForProvider(j.provider, j.routing)).filter((p) => p !== 'unknown')
    ),
    hasLocalCpu: demo.some(
      (j) => j.provider === 'local' && (j.routing === 'local/cpu' || j.device === 'cpu')
    ),
    hasLocalGpu: demo.some(
      (j) => j.provider === 'local' && (j.routing === 'local/gpu' || j.device === 'cuda')
    ),
    hasDlqFixture: demo.some((j) => j.seedDlq === true && j.status === 'FAILED'),
    tenantDemoCount: demo.length,
  };
}

/** Throws if the template list misses a required showcase dimension. */
export function assertShowcaseCoverage(jobs: SeedJobTemplate[]): void {
  const c = collectShowcaseCoverage(jobs);
  const missing: string[] = [];

  for (const s of SHOWCASE_STATUSES) {
    if (!c.statuses.has(s)) missing.push(`status:${s}`);
  }
  for (const e of SHOWCASE_ENGINES) {
    if (!c.engines.has(e.executed)) missing.push(`engine:${e.executed}`);
  }
  for (const m of SHOWCASE_MODALITIES) {
    if (!c.modalities.has(m)) missing.push(`modality:${m}`);
  }
  for (const r of SHOWCASE_ROUTING_STRATEGIES) {
    if (!c.routings.has(r)) missing.push(`routing:${r}`);
  }
  for (const p of SHOWCASE_PRIORITIES) {
    if (!c.priorities.has(p)) missing.push(`priority:${p}`);
  }
  for (const p of REQUIRED_PLACEMENTS) {
    if (!c.placements.has(p)) missing.push(`placement:${p}`);
  }
  if (!c.hasLocalCpu) missing.push('local_cpu');
  if (!c.hasLocalGpu) missing.push('local_gpu');
  if (!c.hasDlqFixture) missing.push('dlq_fixture');

  if (missing.length > 0) {
    throw new Error(`Showcase coverage gaps: ${missing.join(', ')}`);
  }
}

export function paintedJobId(index1Based: number): string {
  return `00000000-0000-4000-a000-${String(index1Based).padStart(12, '0')}`;
}

export function isPaintedShowcaseJobId(jobId: string): boolean {
  return jobId.startsWith('00000000-');
}
