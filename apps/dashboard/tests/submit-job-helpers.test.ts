import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { GpuPricingItem } from '../src/types';
import {
  defaultPromptForPurpose,
  maybeSwapDefaultPrompt,
  providerToRoutingPreference,
  compatibleRoutingPreferences,
  ensureCompatibleRouting,
  dispatchRoutingForCloudOption,
  deviceInferHint,
  resolveDeviceFromRouting,
  resolveBidMode,
  isBidEditable,
  isInterruptiblePlacement,
  forecastJobCostTime,
  buildPlacementParameters,
  matchGpuFromPrefill,
  filterGpusForModel,
  estimatePromptTokens,
  resolveSpotPolicy,
  buildInferenceParameters,
  supportsLocalProductionWeights,
  formatModelCacheLabel,
  formatModelDiskCacheNote,
  formatBytes,
  isEngineSoftDisabled,
  DEFAULT_INFERENCE_PARAMS,
  paramSectionsForPurpose,
  geometryDefaultsForPurpose,
  inferenceDefaultsForModel,
  preferredModelForPurpose,
  fitsLocalVramBudget,
  predictVramPlacement,
  formatModelOptionLabel,
  findPopularModel,
  POPULAR_MODELS,
  normalizeUploadContentType,
} from '../src/components/jobs/submitJobHelpers';
import {
  MODEL_PROVIDER_COVERAGE,
  isCrossProviderComparable,
  compareProvidersForModel,
} from '../src/components/jobs/modelProviderCoverage';

function makeGpu(overrides: Partial<GpuPricingItem> = {}): GpuPricingItem {
  return {
    id: 'gpu-1',
    provider: 'runpod',
    hardwareSkuId: 'nvidia-rtx-4090',
    hardwareDisplayName: 'RTX 4090 (24 GB)',
    vramGb: 24,
    zone: 'us-east',
    pricingModel: 'spot_bid',
    rateMicrocents: 34_000_000,
    billingUnit: 'hour',
    normalizedHourlyMicrocents: 34_000_000,
    normalizedHourlyUsd: 0.34,
    obtainabilityScore: 0.9,
    obtainabilityLabel: 'High',
    interruptionRiskTier: '<5%',
    isAvailable: true,
    commitment: 'none',
    recordedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('submitJobHelpers default prompts', () => {
  it('returns purpose-specific defaults', () => {
    assert.match(defaultPromptForPurpose('text_to_text'), /Spain/);
    assert.match(defaultPromptForPurpose('code_reasoning'), /TypeScript/);
    assert.match(defaultPromptForPurpose('text_to_image'), /Mediterranean/);
  });

  it('swaps prompt only when still on previous default', () => {
    const swapped = maybeSwapDefaultPrompt(
      defaultPromptForPurpose('text_to_text'),
      'text_to_text',
      'code_reasoning'
    );
    assert.equal(swapped, defaultPromptForPurpose('code_reasoning'));

    const preserved = maybeSwapDefaultPrompt(
      'Custom user prompt',
      'text_to_text',
      'code_reasoning'
    );
    assert.equal(preserved, 'Custom user prompt');
  });
});

describe('submitJobHelpers routing and bid modes', () => {
  it('maps providers to routing preferences', () => {
    assert.equal(providerToRoutingPreference('runpod'), 'cloud/runpod');
    assert.equal(providerToRoutingPreference('local_pytorch'), 'local/gpu');
    assert.equal(providerToRoutingPreference('bedrock'), 'cloud/bedrock');
    assert.equal(providerToRoutingPreference('vast_ai'), 'cost_optimized');
  });

  it('filters routing options to provider-compatible dispatch prefs', () => {
    assert.deepEqual(compatibleRoutingPreferences('runpod'), [
      'cloud/runpod',
      'cloud',
      'low_latency',
    ]);
    assert.ok(compatibleRoutingPreferences('local_pytorch').includes('local/gpu'));
    assert.ok(compatibleRoutingPreferences('local_pytorch').includes('auto'));
    assert.ok(!compatibleRoutingPreferences('runpod').includes('auto'));
    assert.ok(!compatibleRoutingPreferences('runpod').includes('local/cpu'));
  });

  it('coerces incompatible routing when provider changes', () => {
    assert.equal(ensureCompatibleRouting('auto', 'runpod'), 'cloud/runpod');
    assert.equal(ensureCompatibleRouting('cloud/runpod', 'local_pytorch'), 'local/gpu');
    assert.equal(ensureCompatibleRouting('local/gpu', 'local_pytorch'), 'local/gpu');
    assert.equal(ensureCompatibleRouting('auto', 'local'), 'auto');
  });

  it('binds FinOps cloud options to concrete executor routing', () => {
    assert.equal(
      dispatchRoutingForCloudOption({
        provider: 'runpod',
        routingPreference: 'low_latency',
      }),
      'cloud/runpod'
    );
    assert.equal(
      dispatchRoutingForCloudOption({
        provider: 'local_pytorch',
        routingPreference: 'local_first',
      }),
      'local/gpu'
    );
    assert.equal(
      dispatchRoutingForCloudOption({
        provider: 'runpod',
        routingPreference: 'cloud/runpod',
      }),
      'cloud/runpod'
    );
  });

  it('infers device hints from routing', () => {
    assert.equal(resolveDeviceFromRouting('local/cpu'), 'cpu');
    assert.equal(resolveDeviceFromRouting('local/gpu'), 'cuda');
    assert.equal(resolveDeviceFromRouting('auto'), '');
    assert.equal(deviceInferHint('local/gpu'), 'cuda');
    assert.equal(deviceInferHint('cloud/runpod'), 'provider-managed');
    assert.equal(deviceInferHint('auto'), 'local cpu/cuda (worker)');
  });

  it('marks floating spot bids as editable recommended bids', () => {
    const runpodPolicy = resolveSpotPolicy('runpod');
    assert.ok(runpodPolicy);
    assert.equal(resolveBidMode('spot_bid', runpodPolicy), 'recommended');
    assert.equal(isBidEditable('recommended', runpodPolicy), true);
    assert.equal(isInterruptiblePlacement('spot_bid', runpodPolicy), true);
  });

  it('locks guaranteed / serverless rates', () => {
    const basetenPolicy = resolveSpotPolicy('baseten');
    assert.ok(basetenPolicy);
    assert.equal(resolveBidMode('serverless', basetenPolicy), 'fixed');
    assert.equal(isBidEditable('fixed', basetenPolicy), false);
    assert.equal(isInterruptiblePlacement('serverless', basetenPolicy), false);
  });
});

describe('submitJobHelpers forecast and placement payload', () => {
  it('forecasts cost and time from tok/s and hourly bid', () => {
    const gpu = makeGpu({ tokensPerSec: 100, normalizedHourlyUsd: 3.6 });
    const forecast = forecastJobCostTime({
      gpu,
      bidUsdPerHour: 3.6,
      maxNewTokens: 100,
      coldStartSec: 0,
    });
    // 100 tokens / 100 tok/s = 1s; $3.6/hr => $0.001 per second
    assert.equal(forecast.tokensPerSec, 100);
    assert.equal(forecast.forecastedExecutionMs, 1000);
    assert.equal(forecast.forecastedCostUsd, 0.001);
    assert.equal(forecast.throughputEvidence, 'provider-reported');
  });

  it('zeroes cost for local providers', () => {
    const local = makeGpu({ provider: 'local', pricingModel: 'on_demand', tokensPerSec: 80 });
    const forecast = forecastJobCostTime({
      gpu: local,
      bidUsdPerHour: 0,
      maxNewTokens: 80,
      coldStartSec: 0,
    });
    assert.equal(forecast.forecastedCostUsd, 0);
  });

  it('builds placement parameters for job metadata', () => {
    const placement = buildPlacementParameters({
      provider: 'runpod',
      pricingModel: 'spot_bid',
      hardwareSkuId: 'nvidia-rtx-4090',
      hardwareDisplayName: 'RTX 4090',
      gpuId: 'gpu-1',
      bidUsdPerHour: 0.4,
      bidMode: 'user',
      tokensPerSec: 85,
      forecastedExecutionMs: 1500,
      forecastedCostUsd: 0.00017,
      interruptionRiskTier: '<5%',
      noticeWindowLabel: '2m grace notice',
      rateEvidence: 'provider-reported',
      throughputEvidence: 'estimated',
    });
    assert.equal(placement.provider, 'runpod');
    assert.equal(placement.bidUsdPerHour, 0.4);
    assert.equal(placement.bidMode, 'user');
    assert.equal(placement.noticeWindowLabel, '2m grace notice');
  });

  it('matches prefill gpu by id and provider/sku', () => {
    const gpus = [
      makeGpu({ id: 'a', provider: 'vast_ai', hardwareSkuId: 'rtx-5090' }),
      makeGpu({ id: 'b', provider: 'runpod', hardwareSkuId: 'nvidia-rtx-4090' }),
    ];
    assert.equal(matchGpuFromPrefill(gpus, { gpuId: 'b' })?.id, 'b');
    assert.equal(
      matchGpuFromPrefill(gpus, {
        provider: 'vast_ai',
        hardwareSkuId: 'rtx-5090',
        pricingModel: 'spot_bid',
      })?.id,
      'a'
    );
  });

  it('filters out unavailable and under-vram gpus for TinyLlama', () => {
    const gpus = [
      makeGpu({ id: 'ok', vramGb: 16, isAvailable: true }),
      makeGpu({ id: 'oos', vramGb: 24, obtainabilityLabel: 'Out of Stock', isAvailable: false }),
      makeGpu({ id: 'tiny', vramGb: 2, isAvailable: true }),
    ];
    const filtered = filterGpusForModel(gpus, 'TinyLlama/TinyLlama-1.1B-Chat-v1.0');
    assert.deepEqual(
      filtered.map((g) => g.id),
      ['ok']
    );
  });

  it('estimates prompt tokens from character length', () => {
    assert.equal(estimatePromptTokens(''), 0);
    assert.equal(estimatePromptTokens('abcd'), 1);
    assert.equal(estimatePromptTokens('a'.repeat(40)), 10);
  });
});

describe('submitJobHelpers inference engine and parameters', () => {
  it('defaults engine to auto and builds text-purpose payload without diffusion fields', () => {
    const params = buildInferenceParameters(DEFAULT_INFERENCE_PARAMS, {
      useProductionWeights: true,
      purpose: 'text_to_text',
    });
    assert.equal(params.engine, 'auto');
    assert.equal(params.temperature, 0.7);
    assert.equal(params.max_new_tokens, 128);
    assert.equal(params.weights, 'production');
    assert.equal(params.allow_auto_upgrade, true);
    assert.equal(params.num_inference_steps, undefined);
    assert.equal(params.fps, undefined);
  });

  it('allows local pretrained checkpoints for open-weight catalog models only', () => {
    assert.equal(supportsLocalProductionWeights('Wan-AI/Wan2.1-T2V-1.3B'), true);
    assert.equal(supportsLocalProductionWeights('stabilityai/sd-turbo'), true);
    assert.equal(supportsLocalProductionWeights('openai/whisper-tiny'), true);
    assert.equal(supportsLocalProductionWeights('anthropic/claude-3-haiku'), false);
  });

  it('labels catalog options with local HF cache state', () => {
    const wan = findPopularModel('Wan-AI/Wan2.1-T2V-1.3B');
    assert.ok(wan);
    assert.match(formatModelCacheLabel(wan, true), /cached/);
    assert.match(formatModelCacheLabel(wan, false), /not downloaded/);
    assert.equal(formatBytes(2202464926).endsWith('GB'), true);
    assert.match(formatModelDiskCacheNote(wan, 27 * 1024 ** 3), /disk/);
    assert.match(formatModelDiskCacheNote(wan, 27 * 1024 ** 3), /offload/);
    assert.match(String(wan.promptTips), /Single subject/i);
  });

  it('includes image diffusion fields for text_to_image purpose', () => {
    const params = buildInferenceParameters(
      {
        ...DEFAULT_INFERENCE_PARAMS,
        device: 'cuda',
        seed: '42',
        mediaAssetUri: 's3://bucket/media.png',
      },
      { useProductionWeights: false, purpose: 'text_to_image' }
    );
    assert.equal(params.device, 'cuda');
    assert.equal(params.num_inference_steps, 4);
    assert.equal(params.guidance_scale, 0);
    assert.equal(params.seed, 42);
    assert.equal(params.temperature, undefined);
    assert.equal(params.weights, 'synthetic');
  });

  it('exposes purpose-specific param sections', () => {
    assert.equal(paramSectionsForPurpose('text_to_text').text, true);
    assert.equal(paramSectionsForPurpose('text_to_text').image, false);
    assert.equal(paramSectionsForPurpose('text_to_image').image, true);
    assert.equal(paramSectionsForPurpose('text_to_video').video, true);
    assert.equal(paramSectionsForPurpose('speech_to_text').audio, true);
    assert.equal(paramSectionsForPurpose('speech_to_text').mediaInput, true);
  });

  it('includes open local-capable video and audio models in the submit catalog', () => {
    assert.ok(findPopularModel('Lightricks/LTX-Video'));
    assert.ok(findPopularModel('Wan-AI/Wan2.1-T2V-1.3B'));
    assert.equal(findPopularModel('THUDM/CogVideoX-2b'), undefined);
    assert.ok(findPopularModel('openai/whisper-tiny'));
    assert.ok(findPopularModel('openai/whisper-large-v3'));
    assert.equal(findPopularModel('Lightricks/LTX-Video')?.purpose, 'text_to_video');
    assert.equal(findPopularModel('openai/whisper-tiny')?.purpose, 'speech_to_text');
  });

  it('prefers VRAM-resident models and applies per-model defaults', () => {
    assert.equal(preferredModelForPurpose('text_to_text')?.id, 'TinyLlama/TinyLlama-1.1B-Chat-v1.0');
    assert.equal(preferredModelForPurpose('text_to_image')?.id, 'stabilityai/sd-turbo');
    assert.equal(preferredModelForPurpose('speech_to_text')?.id, 'openai/whisper-tiny');
    assert.equal(preferredModelForPurpose('text_to_video')?.id, 'Lightricks/LTX-Video');
    assert.equal(preferredModelForPurpose('text_to_video')?.localFit, 'offload');
    assert.equal(fitsLocalVramBudget(findPopularModel('stabilityai/sd-turbo')!), true);
    assert.equal(findPopularModel('Lightricks/LTX-Video')?.diskGbHint, 28);
    assert.equal(fitsLocalVramBudget(findPopularModel('Lightricks/LTX-Video')!), false);
    assert.equal(fitsLocalVramBudget(findPopularModel('Wan-AI/Wan2.1-T2V-1.3B')!), false);
    assert.equal(predictVramPlacement(findPopularModel('Lightricks/LTX-Video')!, 16), 'offload');
    assert.equal(predictVramPlacement(findPopularModel('Wan-AI/Wan2.1-T2V-1.3B')!, 16), 'offload');
    const ltxDefaults = inferenceDefaultsForModel('Lightricks/LTX-Video');
    assert.equal(ltxDefaults.width, 544);
    assert.equal(ltxDefaults.numInferenceSteps, 12);
    const wanDefaults = inferenceDefaultsForModel('Wan-AI/Wan2.1-T2V-1.3B');
    assert.equal(wanDefaults.width, 480);
    assert.equal(wanDefaults.numInferenceSteps, 20);
    assert.equal(wanDefaults.durationSeconds, 2);
    const sd = inferenceDefaultsForModel('stabilityai/sd-turbo');
    assert.equal(sd.width, 512);
    assert.equal(sd.numInferenceSteps, 4);
    assert.equal(sd.guidanceScale, 0);
  });

  it('builds video and audio parameter payloads for their purposes', () => {
    const video = buildInferenceParameters(
      { ...DEFAULT_INFERENCE_PARAMS, width: 640, height: 368, fps: 24, durationSeconds: 3 },
      { useProductionWeights: true, purpose: 'text_to_video' }
    );
    assert.equal(video.width, 640);
    assert.equal(video.fps, 24);
    assert.equal(video.duration_seconds, 3);
    assert.equal(video.guidance_scale, DEFAULT_INFERENCE_PARAMS.guidanceScale);
    assert.equal(video.temperature, undefined);
    const videoGeom = geometryDefaultsForPurpose('text_to_video');
    assert.equal(videoGeom.numInferenceSteps, 30);
    assert.equal(videoGeom.guidanceScale, 5);

    const audio = buildInferenceParameters(
      {
        ...DEFAULT_INFERENCE_PARAMS,
        language: 'en',
        audioTask: 'translate',
        mediaAssetUri: 's3://bucket/clip.wav',
      },
      { useProductionWeights: true, purpose: 'speech_to_text' }
    );
    assert.equal(audio.language, 'en');
    assert.equal(audio.task, 'translate');
    assert.equal(audio.media_asset_uri, 's3://bucket/clip.wav');
    assert.equal(audio.max_new_tokens, undefined);
  });

  it('formats model option labels with VRAM and quantization metadata', () => {
    const flux = findPopularModel('black-forest-labs/FLUX.1-schnell');
    assert.ok(flux);
    assert.match(formatModelOptionLabel(flux!), /NF4|FP8|fits 16 GB/);
    assert.match(formatModelOptionLabel(flux!), /fits 16 GB/);
    assert.match(formatModelOptionLabel(flux!), /~8 GB VRAM/);
  });

  it('maps every popular model to provider coverage for local vs cloud compare', () => {
    for (const model of POPULAR_MODELS) {
      assert.ok(
        MODEL_PROVIDER_COVERAGE[model.id],
        `missing MODEL_PROVIDER_COVERAGE for ${model.id}`
      );
    }
    assert.equal(isCrossProviderComparable('Qwen/Qwen2.5-7B-Instruct'), true);
    assert.equal(isCrossProviderComparable('anthropic/claude-3-haiku'), false);
    assert.ok(compareProvidersForModel('black-forest-labs/FLUX.1-schnell').includes('fal'));
    assert.ok(compareProvidersForModel('Lightricks/LTX-Video').includes('fal'));
    assert.ok(compareProvidersForModel('Wan-AI/Wan2.1-T2V-1.3B').includes('runpod'));
    assert.ok(compareProvidersForModel('Wan-AI/Wan2.1-T2V-1.3B').includes('fal'));
  });

  it('normalizes upload content types from File-like names', () => {
    assert.equal(
      normalizeUploadContentType({ name: 'shot.png', type: '' } as File),
      'image/png'
    );
    assert.equal(
      normalizeUploadContentType({ name: 'clip.mp4', type: 'video/mp4' } as File),
      'video/mp4'
    );
    assert.equal(
      normalizeUploadContentType({ name: 'talk.wav', type: '' } as File),
      'audio/wav'
    );
    assert.equal(normalizeUploadContentType({ name: 'x.gif', type: '' } as File), null);
  });

  it('soft-disables vLLM for image purposes and non-auto engines under mock routing', () => {
    assert.equal(isEngineSoftDisabled('vllm', 'text_to_image', 'local/gpu').disabled, true);
    assert.equal(isEngineSoftDisabled('vllm', 'text_to_text', 'local/gpu').disabled, false);
    assert.equal(isEngineSoftDisabled('torch-compile', 'text_to_text', 'mock').disabled, true);
    assert.equal(isEngineSoftDisabled('auto', 'text_to_text', 'mock').disabled, false);
  });
});
