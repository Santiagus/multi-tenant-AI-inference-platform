import { useState, useMemo } from 'react';
import type {
  GpuPricingItem,
  ModelPricingItem,
  ModelPurpose,
  ModelWeightType,
  CuratedModelDefinition,
} from '../../types';

interface ModelRecommendationStudioProps {
  gpuPricing: GpuPricingItem[];
  modelPricing: ModelPricingItem[];
  onSelectModelOption?: (modelId: string, option: any) => void;
}

export const CATALOG_MODELS: CuratedModelDefinition[] = [
  // 1. Text LLMs
  {
    id: 'meta-llama/Llama-3-8B-Instruct',
    name: 'Llama 3 8B Instruct',
    developer: 'Meta',
    purpose: 'text_to_text',
    weightType: 'open',
    minVramGb: 16,
    weightsSizeGb: 16,
    defaultProvider: 'local_pytorch',
    storageCostMonthlyUsd: 1.12, // 16GB * $0.07/GB-mo
    coldStartSec: 3.5,
    cacheTtlMinutes: 30,
    recommendedGpuSku: 'nvidia-h100-sxm',
    cheapestGpuSku: 'nvidia-rtx-5070ti',
    description: 'Premier 8B open weights LLM for high-throughput reasoning, chat & tool calling.',
  },
  {
    id: 'meta-llama/Llama-3-70B-Instruct',
    name: 'Llama 3 70B Instruct',
    developer: 'Meta',
    purpose: 'text_to_text',
    weightType: 'open',
    minVramGb: 48,
    weightsSizeGb: 72,
    defaultProvider: 'runpod',
    storageCostMonthlyUsd: 5.04,
    coldStartSec: 14.0,
    cacheTtlMinutes: 60,
    recommendedGpuSku: 'nvidia-h100-sxm',
    cheapestGpuSku: 'nvidia-a100-80gb',
    description: 'High-capability 70B enterprise reasoning model requiring multi-GPU or 80GB VRAM.',
  },
  {
    id: 'deepseek-ai/DeepSeek-V3',
    name: 'DeepSeek-V3 (671B MoE)',
    developer: 'DeepSeek',
    purpose: 'text_to_text',
    weightType: 'open',
    minVramGb: 80,
    weightsSizeGb: 140,
    defaultProvider: 'jarvislabs',
    storageCostMonthlyUsd: 9.8,
    coldStartSec: 25.0,
    cacheTtlMinutes: 120,
    recommendedGpuSku: 'nvidia-h100-sxm',
    cheapestGpuSku: 'jarvislabs-token-factory',
    description: 'Ultra-low cost MoE model optimal for Token Factory MaaS or 8xH100 clusters.',
  },
  {
    id: 'mistralai/Mistral-7B-Instruct-v0.2',
    name: 'Mistral 7B Instruct v0.2',
    developer: 'Mistral AI',
    purpose: 'text_to_text',
    weightType: 'open',
    minVramGb: 14,
    weightsSizeGb: 14,
    defaultProvider: 'local_pytorch',
    storageCostMonthlyUsd: 0.98,
    coldStartSec: 2.8,
    cacheTtlMinutes: 30,
    recommendedGpuSku: 'nvidia-rtx-5090',
    cheapestGpuSku: 'nvidia-rtx-5070ti',
    description: 'Compact 7B model with 32k context window and sliding window attention.',
  },
  {
    id: 'corporate/private-finetune-7b',
    name: 'Proprietary Corporate LoRA (7B)',
    developer: 'Internal / Enterprise',
    purpose: 'text_to_text',
    weightType: 'proprietary',
    minVramGb: 16,
    weightsSizeGb: 15,
    defaultProvider: 'runpod',
    storageCostMonthlyUsd: 1.05,
    coldStartSec: 4.2,
    cacheTtlMinutes: 45,
    recommendedGpuSku: 'nvidia-h100-sxm',
    cheapestGpuSku: 'nvidia-rtx-4090',
    description: 'Private fine-tuned domain model containing proprietary customer & enterprise data.',
  },

  // 2. Text to Image
  {
    id: 'black-forest-labs/FLUX.1-schnell',
    name: 'FLUX.1 Schnell',
    developer: 'Black Forest Labs',
    purpose: 'text_to_image',
    weightType: 'open',
    minVramGb: 16,
    weightsSizeGb: 23,
    defaultProvider: 'fal',
    storageCostMonthlyUsd: 1.61,
    coldStartSec: 6.0,
    cacheTtlMinutes: 30,
    recommendedGpuSku: 'nvidia-rtx-5090',
    cheapestGpuSku: 'fal-media-fast',
    description: 'State-of-the-art 12B rectified flow transformer for 1-4 step ultra-fast generation.',
  },
  {
    id: 'stabilityai/stable-diffusion-xl-base-1.0',
    name: 'Stable Diffusion XL 1.0',
    developer: 'Stability AI',
    purpose: 'text_to_image',
    weightType: 'open',
    minVramGb: 12,
    weightsSizeGb: 12,
    defaultProvider: 'runware',
    storageCostMonthlyUsd: 0.84,
    coldStartSec: 3.0,
    cacheTtlMinutes: 30,
    recommendedGpuSku: 'nvidia-rtx-4090',
    cheapestGpuSku: 'runware-fast-diffusion',
    description: 'Flagship 1024x1024 text-to-image foundation model widely supported across neoclouds.',
  },
  {
    id: 'corporate/private-fashion-diffusion',
    name: 'Proprietary Brand Catalog Diffusion',
    developer: 'Internal Creative Dept',
    purpose: 'text_to_image',
    weightType: 'proprietary',
    minVramGb: 24,
    weightsSizeGb: 18,
    defaultProvider: 'runpod',
    storageCostMonthlyUsd: 1.26,
    coldStartSec: 5.5,
    cacheTtlMinutes: 60,
    recommendedGpuSku: 'nvidia-h100-sxm',
    cheapestGpuSku: 'nvidia-rtx-4090',
    description: 'Custom diffusion weights trained exclusively on proprietary product catalogs.',
  },

  // 3. Text to Video
  {
    id: 'THUDM/CogVideoX-5b',
    name: 'CogVideoX 5B',
    developer: 'Zhipu AI / THUDM',
    purpose: 'text_to_video',
    weightType: 'open',
    minVramGb: 24,
    weightsSizeGb: 20,
    defaultProvider: 'runpod',
    storageCostMonthlyUsd: 1.4,
    coldStartSec: 8.5,
    cacheTtlMinutes: 60,
    recommendedGpuSku: 'nvidia-h100-sxm',
    cheapestGpuSku: 'nvidia-rtx-5090',
    description: 'High-fidelity video diffusion generating 6-second clips at 720x480 resolution.',
  },
  {
    id: 'corporate/private-video-engine',
    name: 'Proprietary Synthetic Video Generator',
    developer: 'Internal Studio',
    purpose: 'text_to_video',
    weightType: 'proprietary',
    minVramGb: 32,
    weightsSizeGb: 28,
    defaultProvider: 'vast_ai',
    storageCostMonthlyUsd: 1.96,
    coldStartSec: 12.0,
    cacheTtlMinutes: 60,
    recommendedGpuSku: 'nvidia-h100-sxm',
    cheapestGpuSku: 'nvidia-rtx-5090',
    description: 'In-house proprietary generative video model with watermarking & brand assets.',
  },

  // 4. Speech to Text / Audio
  {
    id: 'openai/whisper-large-v3',
    name: 'Whisper Large v3',
    developer: 'OpenAI',
    purpose: 'speech_to_text',
    weightType: 'open',
    minVramGb: 6,
    weightsSizeGb: 3,
    defaultProvider: 'local_pytorch',
    storageCostMonthlyUsd: 0.21,
    coldStartSec: 1.2,
    cacheTtlMinutes: 30,
    recommendedGpuSku: 'nvidia-l4',
    cheapestGpuSku: 'nvidia-rtx-5070ti',
    description: 'Robust multilingual speech transcription and translation model.',
  },
  {
    id: 'corporate/audio-voice-cloning',
    name: 'Proprietary Voice Cloning Engine',
    developer: 'Internal Speech Lab',
    purpose: 'speech_to_text',
    weightType: 'proprietary',
    minVramGb: 16,
    weightsSizeGb: 8,
    defaultProvider: 'baseten',
    storageCostMonthlyUsd: 0.56,
    coldStartSec: 3.0,
    cacheTtlMinutes: 45,
    recommendedGpuSku: 'nvidia-l4',
    cheapestGpuSku: 'nvidia-rtx-4090',
    description: 'Custom neural voice synthesis & acoustic matching model under NDA.',
  },

  // 5. Code & Reasoning
  {
    id: 'deepseek-ai/DeepSeek-R1',
    name: 'DeepSeek-R1 (Distill 70B)',
    developer: 'DeepSeek',
    purpose: 'code_reasoning',
    weightType: 'open',
    minVramGb: 48,
    weightsSizeGb: 70,
    defaultProvider: 'nebius',
    storageCostMonthlyUsd: 4.9,
    coldStartSec: 15.0,
    cacheTtlMinutes: 90,
    recommendedGpuSku: 'nvidia-h100-sxm',
    cheapestGpuSku: 'nebius-token-factory',
    description: 'Open reasoning & chain-of-thought frontier model rivaling o1 on coding benchmarks.',
  },
  {
    id: 'Qwen/Qwen2.5-Coder-32B-Instruct',
    name: 'Qwen 2.5 Coder 32B',
    developer: 'Alibaba Cloud',
    purpose: 'code_reasoning',
    weightType: 'open',
    minVramGb: 32,
    weightsSizeGb: 34,
    defaultProvider: 'runpod',
    storageCostMonthlyUsd: 2.38,
    coldStartSec: 7.5,
    cacheTtlMinutes: 60,
    recommendedGpuSku: 'nvidia-rtx-5090',
    cheapestGpuSku: 'nvidia-rtx-5090',
    description: 'State-of-the-art coding specialist with 128k context support.',
  },
];

export function ModelRecommendationStudio({
  gpuPricing,
  modelPricing,
  onSelectModelOption,
}: ModelRecommendationStudioProps) {
  // Filters
  const [selectedPurpose, setSelectedPurpose] = useState<ModelPurpose>('all');
  const [selectedWeightType, setSelectedWeightType] = useState<ModelWeightType>('open');
  const [selectedModelId, setSelectedModelId] = useState<string>(CATALOG_MODELS[0].id);

  // Proprietary Hardware & Risk Filters
  const [minAvailability, setMinAvailability] = useState<'all' | 'high' | 'medium'>('all');
  const [maxInterruptionRisk, setMaxInterruptionRisk] = useState<'all' | 'guaranteed' | 'low_risk'>('all');

  // Filtered Model Catalog
  const filteredModels = useMemo(() => {
    return CATALOG_MODELS.filter((m) => {
      if (selectedPurpose !== 'all' && m.purpose !== selectedPurpose) return false;
      if (m.weightType !== selectedWeightType) return false;
      return true;
    });
  }, [selectedPurpose, selectedWeightType]);

  // Keep selected model valid
  const currentModel = useMemo(() => {
    return (
      filteredModels.find((m) => m.id === selectedModelId) ||
      filteredModels[0] ||
      CATALOG_MODELS[0]
    );
  }, [filteredModels, selectedModelId]);

  // 1. Compatible GPUs for Proprietary Model
  const compatibleGpus = useMemo(() => {
    if (!currentModel) return [];

    // Providers that allow running custom/owned weights
    const ALLOWED_PROPRIETARY_PROVIDERS = ['runpod', 'vast_ai', 'baseten', 'jarvislabs', 'nebius', 'local_pytorch', 'sagemaker'];

    return gpuPricing.filter((gpu) => {
      // Must be allowed provider
      if (!ALLOWED_PROPRIETARY_PROVIDERS.includes(gpu.provider)) return false;

      // Must have enough VRAM
      if (gpu.vramGb < currentModel.minVramGb) return false;

      // Availability filter
      if (minAvailability === 'high' && gpu.obtainabilityLabel !== 'High') return false;
      if (minAvailability === 'medium' && gpu.obtainabilityLabel === 'Out of Stock') return false;

      // Interruption risk filter
      if (maxInterruptionRisk === 'guaranteed' && gpu.interruptionRiskTier !== 'guaranteed') return false;
      if (maxInterruptionRisk === 'low_risk' && gpu.interruptionRiskTier === '>20%') return false;

      return true;
    });
  }, [gpuPricing, currentModel, minAvailability, maxInterruptionRisk]);

  // Rank GPUs: Cheapest vs Optimal
  const { cheapestGpu, optimalGpu, sortedCompatibleGpus } = useMemo(() => {
    if (compatibleGpus.length === 0) return { cheapestGpu: null, optimalGpu: null, sortedCompatibleGpus: [] };

    // Cheapest: lowest hourly rate
    const cheapest = [...compatibleGpus].sort((a, b) => a.normalizedHourlyUsd - b.normalizedHourlyUsd)[0];

    // Throughput estimation (tokens/sec or operations multiplier based on chip)
    const getThroughputScore = (sku: string) => {
      if (sku.includes('h100') || sku.includes('h200') || sku.includes('b200')) return 3.2;
      if (sku.includes('5090') || sku.includes('a100')) return 2.1;
      if (sku.includes('4090') || sku.includes('5070')) return 1.5;
      if (sku.includes('l40')) return 1.7;
      if (sku.includes('l4') || sku.includes('a10g')) return 0.9;
      return 1.0;
    };

    // Optimal: High throughput minimizes job duration, giving lower net cost or minimal latency
    // Score = CostPerSec / Throughput
    const optimal = [...compatibleGpus].sort((a, b) => {
      const effA = (a.normalizedHourlyUsd / 3600) / getThroughputScore(a.hardwareSkuId);
      const effB = (b.normalizedHourlyUsd / 3600) / getThroughputScore(b.hardwareSkuId);
      return effA - effB;
    })[0];

    const sorted = [...compatibleGpus].sort((a, b) => a.normalizedHourlyUsd - b.normalizedHourlyUsd);

    return { cheapestGpu: cheapest, optimalGpu: optimal, sortedCompatibleGpus: sorted };
  }, [compatibleGpus]);

  // 2. Open Model Execution Modalities
  const openModelOptions = useMemo(() => {
    if (selectedWeightType !== 'open' || !currentModel) return [];

    const matches = modelPricing.filter(
      (m) =>
        m.modelName.toLowerCase().includes(currentModel.name.toLowerCase().split(' ')[0]) ||
        m.modelId.toLowerCase().includes(currentModel.id.toLowerCase().split('/')[1] || '')
    );

    return matches;
  }, [selectedWeightType, currentModel, modelPricing]);

  // Interruption window lookup helper
  const getInterruptionWindow = (provider: string, pricingModel: string) => {
    if (pricingModel === 'on_demand' || pricingModel === 'serverless') return 'Guaranteed (Zero interruption)';
    if (provider === 'runpod') return '2-min grace notice via webhook';
    if (provider === 'vast_ai') return 'Immediate when outbid in auction';
    if (provider === 'nebius') return '30-sec SIGTERM warning';
    if (provider === 'sagemaker') return '2-min AWS CloudWatch event';
    return 'Standard spot notice';
  };

  return (
    <div
      style={{
        backgroundColor: '#0f172a',
        borderRadius: '12px',
        border: '1px solid #1e293b',
        padding: '24px',
        marginBottom: '28px',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
      }}
    >
      {/* Title & Purpose Filter Bar */}
      <div style={{ marginBottom: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#f8fafc', margin: 0 }}>
              Model Purpose &amp; Hardware Execution Optimizer
            </h2>
            <p style={{ color: '#94a3b8', fontSize: '13px', margin: '4px 0 0 0' }}>
              Select purpose and model classification to evaluate VRAM requirements, cold-start latency, storage TTL, and identify the cheapest vs optimal hardware.
            </p>
          </div>

          {/* Model Type Toggle: Open vs Proprietary */}
          <div style={{ display: 'flex', backgroundColor: '#1e293b', padding: '3px', borderRadius: '8px' }}>
            <button
              onClick={() => setSelectedWeightType('open')}
              style={{
                padding: '6px 14px',
                borderRadius: '6px',
                border: 'none',
                backgroundColor: selectedWeightType === 'open' ? '#3b82f6' : 'transparent',
                color: selectedWeightType === 'open' ? '#ffffff' : '#94a3b8',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              🌐 Open Weights Model
            </button>
            <button
              onClick={() => setSelectedWeightType('proprietary')}
              style={{
                padding: '6px 14px',
                borderRadius: '6px',
                border: 'none',
                backgroundColor: selectedWeightType === 'proprietary' ? '#8b5cf6' : 'transparent',
                color: selectedWeightType === 'proprietary' ? '#ffffff' : '#94a3b8',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              🔒 Proprietary / Owned Weights
            </button>
          </div>
        </div>

        {/* Purpose Filter Pills */}
        <div style={{ display: 'flex', gap: '8px', marginTop: '16px', flexWrap: 'wrap' }}>
          {[
            { id: 'all', label: 'All Modalities' },
            { id: 'text_to_text', label: '💬 Text-to-Text (LLMs)' },
            { id: 'text_to_image', label: '🎨 Text-to-Image (Diffusion)' },
            { id: 'text_to_video', label: '🎬 Text-to-Video' },
            { id: 'speech_to_text', label: '🎙️ Speech-to-Text / Audio' },
            { id: 'code_reasoning', label: '⚡ Code & Reasoning' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setSelectedPurpose(tab.id as ModelPurpose)}
              style={{
                backgroundColor: selectedPurpose === tab.id ? '#1e293b' : 'transparent',
                color: selectedPurpose === tab.id ? '#f8fafc' : '#94a3b8',
                border: `1px solid ${selectedPurpose === tab.id ? '#38bdf8' : '#334155'}`,
                borderRadius: '20px',
                padding: '5px 12px',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Model Selection Row */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: '16px',
          marginBottom: '24px',
        }}
      >
        <div>
          <label style={{ color: '#94a3b8', fontSize: '12px', fontWeight: 600, textTransform: 'uppercase' }}>
            Select Target Model ({filteredModels.length} Available):
          </label>
          <select
            value={currentModel.id}
            onChange={(e) => setSelectedModelId(e.target.value)}
            style={{
              width: '100%',
              backgroundColor: '#1e293b',
              color: '#f8fafc',
              border: '1px solid #334155',
              borderRadius: '8px',
              padding: '10px 14px',
              fontSize: '14px',
              fontWeight: 600,
              marginTop: '6px',
              outline: 'none',
              cursor: 'pointer',
            }}
          >
            {filteredModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.developer}) - Min {m.minVramGb}GB VRAM
              </option>
            ))}
          </select>
        </div>

        {/* Model Spec & Storage Telemetry Card */}
        <div
          style={{
            backgroundColor: '#1e293b40',
            border: '1px solid #334155',
            borderRadius: '8px',
            padding: '12px 16px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: '#f8fafc', fontWeight: 700, fontSize: '13px' }}>
              {currentModel.name}
            </span>
            <span
              style={{
                backgroundColor: currentModel.weightType === 'proprietary' ? '#8b5cf620' : '#3b82f620',
                color: currentModel.weightType === 'proprietary' ? '#a78bfa' : '#60a5fa',
                padding: '2px 8px',
                borderRadius: '4px',
                fontSize: '11px',
                fontWeight: 700,
              }}
            >
              {currentModel.weightType.toUpperCase()}
            </span>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: '8px',
              marginTop: '8px',
              fontSize: '11px',
            }}
          >
            <div>
              <span style={{ color: '#64748b' }}>MIN VRAM:</span>
              <div style={{ color: '#38bdf8', fontWeight: 700 }}>{currentModel.minVramGb} GB</div>
            </div>
            <div>
              <span style={{ color: '#64748b' }}>WEIGHTS:</span>
              <div style={{ color: '#cbd5e1', fontWeight: 600 }}>{currentModel.weightsSizeGb} GB</div>
            </div>
            <div>
              <span style={{ color: '#64748b' }}>STORAGE/MO:</span>
              <div style={{ color: '#34d399', fontWeight: 600 }}>${currentModel.storageCostMonthlyUsd}/mo</div>
            </div>
            <div>
              <span style={{ color: '#64748b' }}>COLD START:</span>
              <div style={{ color: '#fbbf24', fontWeight: 600 }}>~{currentModel.coldStartSec}s</div>
            </div>
          </div>
        </div>
      </div>

      {/* SECTION A: PROPRIETARY MODEL HARDWARE SIZING ENGINE */}
      {selectedWeightType === 'proprietary' && (
        <div>
          {/* Controls: Availability & Interruption Thresholds */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '12px',
              marginBottom: '16px',
              padding: '12px 16px',
              backgroundColor: '#1e293b30',
              borderRadius: '8px',
              border: '1px solid #1e293b',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
              <span style={{ color: '#94a3b8', fontSize: '13px', fontWeight: 600 }}>
                🛡️ Provider Filters:
              </span>

              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <label style={{ color: '#94a3b8', fontSize: '12px' }}>Min Availability:</label>
                <select
                  value={minAvailability}
                  onChange={(e: any) => setMinAvailability(e.target.value)}
                  style={{
                    backgroundColor: '#1e293b',
                    color: '#f8fafc',
                    border: '1px solid #334155',
                    borderRadius: '6px',
                    padding: '4px 8px',
                    fontSize: '12px',
                  }}
                >
                  <option value="all">All Available</option>
                  <option value="high">High Availability Only (≥80%)</option>
                  <option value="medium">In-Stock Only</option>
                </select>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <label style={{ color: '#94a3b8', fontSize: '12px' }}>Max Interruption Risk:</label>
                <select
                  value={maxInterruptionRisk}
                  onChange={(e: any) => setMaxInterruptionRisk(e.target.value)}
                  style={{
                    backgroundColor: '#1e293b',
                    color: '#f8fafc',
                    border: '1px solid #334155',
                    borderRadius: '6px',
                    padding: '4px 8px',
                    fontSize: '12px',
                  }}
                >
                  <option value="all">Any Risk (Max Discounts)</option>
                  <option value="low_risk">Low Risk Only (&lt;10%)</option>
                  <option value="guaranteed">Guaranteed Only (0% Risk)</option>
                </select>
              </div>
            </div>

            <div style={{ color: '#38bdf8', fontSize: '12px', fontWeight: 600 }}>
              {sortedCompatibleGpus.length} Compatible GPUs Found (VRAM ≥ {currentModel.minVramGb}GB)
            </div>
          </div>

          {/* Highlights: Cheapest vs Optimal Recommendation Cards */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
              gap: '16px',
              marginBottom: '20px',
            }}
          >
            {/* Cheapest Card */}
            {cheapestGpu && (
              <div
                style={{
                  backgroundColor: '#064e3b20',
                  border: '1px solid #10b981',
                  borderRadius: '10px',
                  padding: '16px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <span
                    style={{
                      backgroundColor: '#10b981',
                      color: '#0f172a',
                      padding: '3px 8px',
                      borderRadius: '4px',
                      fontSize: '11px',
                      fontWeight: 800,
                    }}
                  >
                    💰 CHEAPEST COMPATIBLE GPU
                  </span>
                  <span style={{ color: '#34d399', fontSize: '16px', fontWeight: 700 }}>
                    ${cheapestGpu.normalizedHourlyUsd.toFixed(2)}/hr
                  </span>
                </div>
                <div style={{ fontSize: '14px', fontWeight: 700, color: '#f8fafc' }}>
                  {cheapestGpu.hardwareDisplayName} ({cheapestGpu.provider.toUpperCase()})
                </div>
                <div style={{ color: '#94a3b8', fontSize: '12px', marginTop: '4px' }}>
                  {cheapestGpu.vramGb} GB VRAM • {cheapestGpu.pricingModel.replace('_', ' ').toUpperCase()} • Risk: {cheapestGpu.interruptionRiskTier}
                </div>
                <div style={{ color: '#10b981', fontSize: '11px', marginTop: '8px' }}>
                  Notice Window: {getInterruptionWindow(cheapestGpu.provider, cheapestGpu.pricingModel)}
                </div>
              </div>
            )}

            {/* Optimal / Recommended Card */}
            {optimalGpu && (
              <div
                style={{
                  backgroundColor: '#1e3a8a20',
                  border: '1px solid #38bdf8',
                  borderRadius: '10px',
                  padding: '16px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <span
                    style={{
                      backgroundColor: '#38bdf8',
                      color: '#0f172a',
                      padding: '3px 8px',
                      borderRadius: '4px',
                      fontSize: '11px',
                      fontWeight: 800,
                    }}
                  >
                    ⭐ OPTIMAL / RECOMMENDED (BEST $/JOB)
                  </span>
                  <span style={{ color: '#60a5fa', fontSize: '16px', fontWeight: 700 }}>
                    ${optimalGpu.normalizedHourlyUsd.toFixed(2)}/hr
                  </span>
                </div>
                <div style={{ fontSize: '14px', fontWeight: 700, color: '#f8fafc' }}>
                  {optimalGpu.hardwareDisplayName} ({optimalGpu.provider.toUpperCase()})
                </div>
                <div style={{ color: '#94a3b8', fontSize: '12px', marginTop: '4px' }}>
                  {optimalGpu.vramGb} GB VRAM • High Tensor Core Throughput finishes job 3-5x faster, minimizing billed GPU seconds!
                </div>
                <div style={{ color: '#38bdf8', fontSize: '11px', marginTop: '8px' }}>
                  Notice Window: {getInterruptionWindow(optimalGpu.provider, optimalGpu.pricingModel)}
                </div>
              </div>
            )}
          </div>

          {/* Compatible Hardware Table */}
          <div
            style={{
              backgroundColor: '#0f172a',
              borderRadius: '8px',
              border: '1px solid #1e293b',
              overflow: 'hidden',
            }}
          >
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '12px' }}>
                <thead>
                  <tr style={{ backgroundColor: '#1e293b', borderBottom: '1px solid #334155', color: '#94a3b8' }}>
                    <th style={{ padding: '12px 16px', fontWeight: 600 }}>Hardware / GPU SKU</th>
                    <th style={{ padding: '12px 16px', fontWeight: 600 }}>Provider</th>
                    <th style={{ padding: '12px 16px', fontWeight: 600 }}>VRAM (GB)</th>
                    <th style={{ padding: '12px 16px', fontWeight: 600 }}>Mode</th>
                    <th style={{ padding: '12px 16px', fontWeight: 600 }}>Hourly Rate</th>
                    <th style={{ padding: '12px 16px', fontWeight: 600 }}>Availability</th>
                    <th style={{ padding: '12px 16px', fontWeight: 600 }}>Interruption Notice</th>
                    <th style={{ padding: '12px 16px', fontWeight: 600 }}>Classification</th>
                    {onSelectModelOption && <th style={{ padding: '12px 16px', fontWeight: 600, textAlign: 'right' }}>Action</th>}
                  </tr>
                </thead>
                <tbody>
                  {sortedCompatibleGpus.map((gpu) => {
                    const isCheapest = cheapestGpu?.id === gpu.id;
                    const isOptimal = optimalGpu?.id === gpu.id;

                    return (
                      <tr
                        key={gpu.id}
                        style={{
                          borderBottom: '1px solid #1e293b',
                          backgroundColor: isOptimal
                            ? 'rgba(56, 189, 248, 0.08)'
                            : isCheapest
                              ? 'rgba(16, 185, 129, 0.08)'
                              : 'transparent',
                        }}
                      >
                        <td style={{ padding: '12px 16px', fontWeight: 700, color: '#f8fafc' }}>
                          {gpu.hardwareDisplayName}
                        </td>
                        <td style={{ padding: '12px 16px', color: '#cbd5e1' }}>
                          {gpu.provider.toUpperCase()}
                        </td>
                        <td style={{ padding: '12px 16px', color: '#38bdf8', fontWeight: 600 }}>
                          {gpu.vramGb} GB
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          <span
                            style={{
                              padding: '2px 6px',
                              borderRadius: '4px',
                              fontSize: '11px',
                              fontWeight: 600,
                              backgroundColor: gpu.pricingModel === 'spot_bid' ? '#10b98120' : '#3b82f620',
                              color: gpu.pricingModel === 'spot_bid' ? '#34d399' : '#60a5fa',
                            }}
                          >
                            {gpu.pricingModel.replace('_', ' ').toUpperCase()}
                          </span>
                        </td>
                        <td style={{ padding: '12px 16px', fontWeight: 700, color: '#f8fafc' }}>
                          ${gpu.normalizedHourlyUsd.toFixed(2)}/hr
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          <span
                            style={{
                              color:
                                gpu.obtainabilityLabel === 'High'
                                  ? '#34d399'
                                  : gpu.obtainabilityLabel === 'Medium'
                                    ? '#fbbf24'
                                    : '#f87171',
                              fontWeight: 600,
                            }}
                          >
                            {gpu.obtainabilityLabel}
                          </span>
                        </td>
                        <td style={{ padding: '12px 16px', color: '#94a3b8', fontSize: '11px' }}>
                          {getInterruptionWindow(gpu.provider, gpu.pricingModel)}
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          {isOptimal && (
                            <span
                              style={{
                                backgroundColor: '#38bdf820',
                                color: '#38bdf8',
                                padding: '2px 6px',
                                borderRadius: '4px',
                                fontSize: '11px',
                                fontWeight: 700,
                              }}
                            >
                              ⭐ OPTIMAL
                            </span>
                          )}
                          {isCheapest && !isOptimal && (
                            <span
                              style={{
                                backgroundColor: '#10b98120',
                                color: '#10b981',
                                padding: '2px 6px',
                                borderRadius: '4px',
                                fontSize: '11px',
                                fontWeight: 700,
                              }}
                            >
                              💰 CHEAPEST
                            </span>
                          )}
                          {!isOptimal && !isCheapest && <span style={{ color: '#64748b' }}>Compatible</span>}
                        </td>
                        {onSelectModelOption && (
                          <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                            <button
                              onClick={() => onSelectModelOption(currentModel.id, { gpuId: gpu.id, provider: gpu.provider })}
                              style={{
                                backgroundColor: '#1e293b',
                                color: '#38bdf8',
                                border: '1px solid #0284c7',
                                padding: '4px 10px',
                                borderRadius: '6px',
                                fontSize: '11px',
                                fontWeight: 600,
                                cursor: 'pointer',
                              }}
                            >
                              Select GPU
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* SECTION B: OPEN MODEL EXECUTION MODALITIES */}
      {selectedWeightType === 'open' && (
        <div>
          <div style={{ marginBottom: '16px' }}>
            <h3 style={{ fontSize: '15px', fontWeight: 700, color: '#f8fafc', margin: '0 0 6px 0' }}>
              Execution Modality Comparison for {currentModel.name}
            </h3>
            <p style={{ color: '#94a3b8', fontSize: '13px', margin: 0 }}>
              Compare Token Factory (MaaS) pay-per-token APIs, Serverless micro-metered endpoints, and dedicated spot GPU options across neocloud providers.
            </p>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: '16px',
            }}
          >
            {/* 1. Token Factory / MaaS */}
            <div
              style={{
                backgroundColor: '#1e1b4b30',
                border: '1px solid #6366f1',
                borderRadius: '10px',
                padding: '16px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '11px', fontWeight: 800, color: '#818cf8', textTransform: 'uppercase' }}>
                    Token Factory (MaaS)
                  </span>
                  <span style={{ color: '#10b981', fontSize: '11px', fontWeight: 700 }}>Zero Cold Start (0s)</span>
                </div>
                <div style={{ fontSize: '15px', fontWeight: 700, color: '#f8fafc', marginTop: '6px' }}>
                  JarvisLabs / Nebius Token Factory
                </div>
                <p style={{ color: '#94a3b8', fontSize: '12px', marginTop: '4px' }}>
                  Pay strictly per input and output token. No container setup, no GPU provisioning or idle costs.
                </p>
              </div>

              <div style={{ marginTop: '14px', borderTop: '1px solid #312e81', paddingTop: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                  <span style={{ color: '#94a3b8' }}>Input Rate:</span>
                  <span style={{ color: '#34d399', fontWeight: 700 }}>$0.07 / 1M tokens</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginTop: '4px' }}>
                  <span style={{ color: '#94a3b8' }}>Output Rate:</span>
                  <span style={{ color: '#60a5fa', fontWeight: 700 }}>$0.49 / 1M tokens</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginTop: '4px', color: '#a5b4fc' }}>
                  <span>Cached Discount:</span>
                  <span>$0.018 / 1M tokens</span>
                </div>
                {onSelectModelOption && (
                  <button
                    onClick={() => onSelectModelOption(currentModel.id, { mode: 'token_factory' })}
                    style={{
                      marginTop: '10px',
                      width: '100%',
                      backgroundColor: '#6366f1',
                      color: '#ffffff',
                      border: 'none',
                      padding: '6px 12px',
                      borderRadius: '6px',
                      fontSize: '11px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Select Token Factory
                  </button>
                )}
              </div>
            </div>

            {/* 2. Serverless Micro-Metered */}
            <div
              style={{
                backgroundColor: '#08334430',
                border: '1px solid #06b6d4',
                borderRadius: '10px',
                padding: '16px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '11px', fontWeight: 800, color: '#22d3ee', textTransform: 'uppercase' }}>
                    Serverless Micro-Metered
                  </span>
                  <span style={{ color: '#fbbf24', fontSize: '11px', fontWeight: 700 }}>Scale-to-Zero (~2.5s)</span>
                </div>
                <div style={{ fontSize: '15px', fontWeight: 700, color: '#f8fafc', marginTop: '6px' }}>
                  Baseten Truss / RunPod Serverless
                </div>
                <p style={{ color: '#94a3b8', fontSize: '12px', marginTop: '4px' }}>
                  Autoscaling container with sub-second billing. Automatically spins down to $0 when queue is idle.
                </p>
              </div>

              <div style={{ marginTop: '14px', borderTop: '1px solid #155e75', paddingTop: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                  <span style={{ color: '#94a3b8' }}>Execution Meter:</span>
                  <span style={{ color: '#22d3ee', fontWeight: 700 }}>$0.000236 / second</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginTop: '4px' }}>
                  <span style={{ color: '#94a3b8' }}>Idle Cost:</span>
                  <span style={{ color: '#34d399', fontWeight: 700 }}>$0.00 (Zero commit)</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginTop: '4px', color: '#67e8f9' }}>
                  <span>Hardware Target:</span>
                  <span>NVIDIA L4 / A10G (24GB)</span>
                </div>
                {onSelectModelOption && (
                  <button
                    onClick={() => onSelectModelOption(currentModel.id, { mode: 'serverless' })}
                    style={{
                      marginTop: '10px',
                      width: '100%',
                      backgroundColor: '#06b6d4',
                      color: '#ffffff',
                      border: 'none',
                      padding: '6px 12px',
                      borderRadius: '6px',
                      fontSize: '11px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Select Serverless
                  </button>
                )}
              </div>
            </div>

            {/* 3. Dedicated Spot Pod */}
            <div
              style={{
                backgroundColor: '#064e3b30',
                border: '1px solid #10b981',
                borderRadius: '10px',
                padding: '16px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '11px', fontWeight: 800, color: '#34d399', textTransform: 'uppercase' }}>
                    Dedicated Spot Pod
                  </span>
                  <span style={{ color: '#38bdf8', fontSize: '11px', fontWeight: 700 }}>Continuous High Throughput</span>
                </div>
                <div style={{ fontSize: '15px', fontWeight: 700, color: '#f8fafc', marginTop: '6px' }}>
                  Vast.ai / RunPod Spot Pods
                </div>
                <p style={{ color: '#94a3b8', fontSize: '12px', marginTop: '4px' }}>
                  Dedicated GPU instance for high-volume sustained inference, bulk embeddings, or model serving.
                </p>
              </div>

              <div style={{ marginTop: '14px', borderTop: '1px solid #065f46', paddingTop: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                  <span style={{ color: '#94a3b8' }}>Hourly Rate:</span>
                  <span style={{ color: '#34d399', fontWeight: 700 }}>$0.24 - $0.34 / hr</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginTop: '4px' }}>
                  <span style={{ color: '#94a3b8' }}>Throughput Cap:</span>
                  <span style={{ color: '#f8fafc', fontWeight: 700 }}>Uncapped (~130 tok/s)</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginTop: '4px', color: '#6ee7b7' }}>
                  <span>Interruption Risk:</span>
                  <span>5-10% (Spot Auction)</span>
                </div>
                {onSelectModelOption && (
                  <button
                    onClick={() => onSelectModelOption(currentModel.id, { mode: 'spot' })}
                    style={{
                      marginTop: '10px',
                      width: '100%',
                      backgroundColor: '#10b981',
                      color: '#ffffff',
                      border: 'none',
                      padding: '6px 12px',
                      borderRadius: '6px',
                      fontSize: '11px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Select Dedicated Spot
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Live Catalog Matching Indicator */}
          {openModelOptions.length > 0 && (
            <div
              style={{
                marginTop: '16px',
                padding: '12px 16px',
                backgroundColor: '#1e293b40',
                borderRadius: '8px',
                border: '1px solid #334155',
                fontSize: '12px',
                display: 'flex',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '8px',
              }}
            >
              <span style={{ color: '#94a3b8', fontWeight: 600 }}>Active Multi-Cloud Catalog Feeds:</span>
              {openModelOptions.map((opt) => (
                <span
                  key={opt.id}
                  style={{
                    backgroundColor: '#1e293b',
                    border: '1px solid #475569',
                    borderRadius: '4px',
                    padding: '2px 8px',
                    color: '#e2e8f0',
                    fontSize: '11px',
                  }}
                >
                  <strong style={{ color: '#38bdf8' }}>{opt.provider.toUpperCase()}</strong>: {opt.executionType.replace('_', ' ')} (
                  {opt.inputPricePerMillionUsd ? `$${opt.inputPricePerMillionUsd.toFixed(2)}/1M` : `$${opt.perUnitUsd}`}
                  )
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
