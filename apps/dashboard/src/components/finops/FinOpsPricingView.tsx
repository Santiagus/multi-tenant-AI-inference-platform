import { useState, useEffect, useMemo } from 'react';
import { apiClient } from '../../api/client';
import type {
  GpuPricingItem,
  ModelPricingItem,
  PricingHistorySummary,
  PricingSyncAudit,
  ProviderBalanceStatus,
} from '../../types';
import { SortableHeader, genericSort, type SortDirection } from '../common/SortableHeader';
import { ProviderFleetBar, DEFAULT_PROVIDER_FLEET } from './ProviderFleetBar';
import { HistoricalPriceChart } from './HistoricalPriceChart';
import { CATALOG_MODELS } from './ModelRecommendationStudio';

export const HARDWARE_BENCHMARK_THROUGHPUT: Record<
  string,
  {
    tokensPerSec: number;
    architecture: string;
    description: string;
  }
> = {
  'nvidia-h100-sxm': {
    tokensPerSec: 180,
    architecture: 'Hopper Tensor Core',
    description: '180 tok/s on Llama-3-8B FP16/FP8 Tensor Cores',
  },
  'nvidia-h200-sxm': {
    tokensPerSec: 210,
    architecture: 'Hopper Ultra HBM3e',
    description: '210 tok/s with 141GB high-bandwidth memory',
  },
  'nvidia-a100-80gb': {
    tokensPerSec: 95,
    architecture: 'Ampere Tensor Core',
    description: '95 tok/s enterprise standard model inference',
  },
  'nvidia-rtx-5090': {
    tokensPerSec: 140,
    architecture: 'Blackwell Architecture',
    description: '140 tok/s next-gen consumer flagship compute',
  },
  'nvidia-rtx-4090': {
    tokensPerSec: 85,
    architecture: 'Ada Lovelace 24GB',
    description: '85 tok/s cost-performance champion',
  },
  'nvidia-a6000-ada': {
    tokensPerSec: 80,
    architecture: 'Ada Lovelace 48GB',
    description: '80 tok/s workstation-grade large context',
  },
  'nvidia-l4': {
    tokensPerSec: 45,
    architecture: 'Ada Lovelace Serverless',
    description: '45 tok/s energy-efficient micro-metered serverless',
  },
  'nvidia-a10g': {
    tokensPerSec: 40,
    architecture: 'Ampere G5 Cloud',
    description: '40 tok/s AWS G5 cloud baseline',
  },
  'nvidia-rtx-5070-ti': {
    tokensPerSec: 38,
    architecture: 'Blackwell Workstation',
    description: '38 tok/s dedicated local zero-cloud workstation',
  },
  'aws-inferentia2': {
    tokensPerSec: 110,
    architecture: 'AWS NeuronCore-v2',
    description: '110 tok/s cost-optimized AWS custom silicon',
  },
};

export const PROVIDER_CONSOLE_LINKS: Record<
  string,
  {
    capacityUrl: string;
    spotPolicyUrl: string;
  }
> = {
  runpod: {
    capacityUrl: 'https://www.runpod.io/console/gpu-cloud',
    spotPolicyUrl: 'https://docs.runpod.io/pods/pricing#spot-instances',
  },
  vast_ai: {
    capacityUrl: 'https://cloud.vast.ai/create/',
    spotPolicyUrl: 'https://vast.ai/docs/overview/pricing#interruptible-instances',
  },
  baseten: {
    capacityUrl: 'https://app.baseten.co/',
    spotPolicyUrl: 'https://docs.baseten.co/deploying-models/autoscaling',
  },
  nebius: {
    capacityUrl: 'https://console.nebius.com/',
    spotPolicyUrl: 'https://docs.nebius.com/compute/pricing#preemptible-vms',
  },
  jarvislabs: {
    capacityUrl: 'https://jarvislabs.ai/dashboard/',
    spotPolicyUrl: 'https://jarvislabs.ai/docs/faq/',
  },
  coreweave: {
    capacityUrl: 'https://cloud.coreweave.com/',
    spotPolicyUrl: 'https://docs.coreweave.com/coreweave-kubernetes-service-cks/interruptible-virtual-servers',
  },
  fal: {
    capacityUrl: 'https://fal.ai/models',
    spotPolicyUrl: 'https://fal.ai/pricing',
  },
  runware: {
    capacityUrl: 'https://runware.ai/',
    spotPolicyUrl: 'https://runware.ai/pricing',
  },
  hivenet: {
    capacityUrl: 'https://app.hivenet.com/',
    spotPolicyUrl: 'https://www.hivenet.com/technology',
  },
  wavespeed: {
    capacityUrl: 'https://wavespeed.ai/dashboard',
    spotPolicyUrl: 'https://wavespeed.ai/pricing',
  },
  neocloudz: {
    capacityUrl: 'https://portal.neocloudz.com/',
    spotPolicyUrl: 'https://neocloudz.com/pricing',
  },
  bedrock: {
    capacityUrl: 'https://console.aws.amazon.com/bedrock/',
    spotPolicyUrl: 'https://aws.amazon.com/bedrock/pricing/',
  },
  sagemaker: {
    capacityUrl: 'https://console.aws.amazon.com/sagemaker/',
    spotPolicyUrl: 'https://aws.amazon.com/ec2/spot/pricing/',
  },
  local_pytorch: {
    capacityUrl: '#local-hardware',
    spotPolicyUrl: '#local-hardware',
  },
};

/**
 * Normalizes hardware strings into short compact representations with VRAM (e.g. "5070 Ti (16GB)").
 */
export function formatHwShortName(rawName?: string, vramGb?: number): string {
  if (!rawName) return vramGb ? `GPU (${vramGb}GB)` : 'Standard GPU';

  let short = rawName;
  if (/5070\s*Ti/i.test(rawName)) short = '5070 Ti';
  else if (/5090/i.test(rawName)) short = '5090';
  else if (/4090/i.test(rawName)) short = '4090';
  else if (/h200/i.test(rawName)) short = 'H200 SXM';
  else if (/h100/i.test(rawName)) short = 'H100 SXM5';
  else if (/a100/i.test(rawName)) short = 'A100';
  else if (/a6000/i.test(rawName)) short = 'A6000 Ada';
  else if (/l4\b/i.test(rawName)) short = 'L4';
  else if (/a10g/i.test(rawName)) short = 'A10G';
  else if (/inferentia2/i.test(rawName)) short = 'Inferentia2';
  else if (/cpu/i.test(rawName)) short = 'CPU Xeon/EPYC';
  else {
    short = rawName
      .replace(/^NVIDIA\s+GeForce\s+/i, '')
      .replace(/^NVIDIA\s+/i, '')
      .replace(/\s*\(\d+GB.*?\)/i, '')
      .trim();
  }

  if (short.includes('(') && short.includes('GB)')) {
    return short;
  }

  const vram = vramGb && vramGb > 0 ? ` (${vramGb}GB)` : '';
  return `${short}${vram}`;
}

export function getGpuPerformance(item: GpuPricingItem) {
  const bench = HARDWARE_BENCHMARK_THROUGHPUT[item.hardwareSkuId] || {
    tokensPerSec: Math.max(25, Math.round(item.vramGb * 2.2)),
    architecture: 'Tensor Core Compute',
    description: `${Math.round(item.vramGb * 2.2)} tok/s baseline`,
  };

  const tokensPerSec = item.tokensPerSec || bench.tokensPerSec;
  const costPerMillion =
    tokensPerSec > 0
      ? (item.normalizedHourlyUsd / (tokensPerSec * 3600)) * 1_000_000
      : 999;
  const tokensPerDollar =
    item.normalizedHourlyUsd > 0
      ? Math.round((tokensPerSec * 3600) / item.normalizedHourlyUsd)
      : 0;

  return {
    tokensPerSec,
    costPerMillion,
    tokensPerDollar,
    architecture: bench.architecture,
    description: bench.description,
  };
}

export interface UnifiedPricingResult {
  id: string;
  itemType: 'gpu' | 'model';
  provider: string;
  providerDisplayName: string;
  hwShortName: string; // e.g. "5070 Ti (16GB)"
  hwArchitecture: string;
  vramGb: number;
  modelName?: string;
  modelId?: string;
  developer?: string;
  weightType?: 'open' | 'proprietary';
  modality: 'text_to_text' | 'text_to_image' | 'text_to_video' | 'speech_to_text' | 'code_reasoning' | 'raw_compute';
  executionType: 'dedicated_gpu' | 'token_factory' | 'serverless' | 'pay_per_call' | 'local';
  pricingModel: string;
  pricingModelLabel: string;
  preemptionPolicy: string;
  preemptionPolicyUrl: string;
  priceHourlyUsd: number;
  priceDisplay: string;
  priceSubtext?: string;
  throughputTokPerSec: number;
  throughputDisplay: string;
  throughputSubtext: string;
  tokensPerDollar: number;
  costPerMillionUsd: number;
  costEfficiencyDisplay: string;
  efficiencyBadge?: 'ultra_value' | 'top_efficiency' | 'sweet_spot' | 'max_speed';
  availabilityScore: number;
  availabilityLabel: string;
  availabilityUrl: string;
  reliability: string;
  riskTier: string;
  riskUrl: string;
}

export function FinOpsPricingView() {
  const [gpuPricing, setGpuPricing] = useState<GpuPricingItem[]>([]);
  const [modelPricing, setModelPricing] = useState<ModelPricingItem[]>([]);
  const [historySummaries, setHistorySummaries] = useState<PricingHistorySummary[]>([]);
  const [syncAudits, setSyncAudits] = useState<PricingSyncAudit[]>([]);
  const [providerBalances, setProviderBalances] = useState<Record<string, ProviderBalanceStatus>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [showHistoryChart, setShowHistoryChart] = useState(false);

  // Filters on top
  const [selectedProvider, setSelectedProvider] = useState<string>('all');
  const [selectedPricingModel, setSelectedPricingModel] = useState<string>('all');
  const [selectedModality, setSelectedModality] = useState<string>('all');
  const [selectedExecutionType, setSelectedExecutionType] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Table Sorting State
  const [sortKey, setSortKey] = useState<string>('costEfficiency');
  const [sortDir, setSortDir] = useState<SortDirection>('desc');

  const handleSort = (col: string) => {
    if (sortKey === col) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(col);
      setSortDir(
        col === 'throughput' || col === 'costEfficiency' || col === 'availability' || col === 'price'
          ? 'desc'
          : 'asc'
      );
    }
  };

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [gpuRes, modelRes, histRes, balancesRes] = await Promise.all([
        apiClient.getGpuPricing(),
        apiClient.getModelPricing(),
        apiClient.getPricingHistory(),
        apiClient.getProviderBalances().catch(() => ({ ok: false, balances: {} as Record<string, ProviderBalanceStatus> })),
      ]);
      setGpuPricing(gpuRes.data);
      setModelPricing(modelRes.data);
      setHistorySummaries(histRes.data);
      setSyncAudits(histRes.cadence_audits || []);
      setProviderBalances(balancesRes.balances || histRes.provider_balances || {});
    } catch (err) {
      console.error('Failed to load FinOps pricing intelligence:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSync = async () => {
    setIsSyncing(true);
    setSyncMessage(null);
    try {
      const res = await apiClient.syncPricing();
      setSyncMessage(
        `Synchronized ${res.recordsCount} records across ${res.syncedProviders.length} providers.`
      );
      await loadData();
    } catch (err) {
      setSyncMessage('Failed to trigger pricing catalog sync.');
    } finally {
      setIsSyncing(false);
      setTimeout(() => setSyncMessage(null), 5000);
    }
  };

  // Build Unified Pricing Results (combines GPU hardware offerings and Model offerings)
  const unifiedResults: UnifiedPricingResult[] = useMemo(() => {
    const list: UnifiedPricingResult[] = [];

    // 1. GPU Instances
    for (const g of gpuPricing) {
      const perf = getGpuPerformance(g);
      const hwShort = formatHwShortName(g.hardwareDisplayName, g.vramGb);
      const fleet = DEFAULT_PROVIDER_FLEET.find((p) => p.provider.toLowerCase() === g.provider.toLowerCase());
      const links = PROVIDER_CONSOLE_LINKS[g.provider.toLowerCase()] || {
        capacityUrl: fleet?.pricingUrl || '#',
        spotPolicyUrl: fleet?.spotPricingUrl || '#',
      };

      const isSpot = g.pricingModel === 'spot_bid' || g.pricingModel === 'preemptible';
      const preemptionPolicy = isSpot
        ? fleet?.spotPolicy?.noticeWindowLabel
          ? `${fleet.spotPolicy.noticeWindowLabel} (${fleet.spotPolicy.pricingTypeLabel})`
          : 'Spot bid preemption'
        : g.pricingModel === 'serverless'
          ? 'Scale-to-zero micro-metered'
          : 'Dedicated process (zero interruption)';

      const reliability =
        g.provider === 'local_pytorch'
          ? '100% Dedicated Workstation'
          : g.provider === 'bedrock' || g.provider === 'sagemaker'
            ? '99.9% Enterprise SLA'
            : g.provider === 'nebius' || g.provider === 'baseten' || g.provider === 'coreweave'
              ? '99.5% Tier 3+ DC'
              : 'Community Cluster (98%)';

      const isUltraValue = perf.tokensPerDollar >= 1_000_000;
      const isTopEfficiency = !isUltraValue && perf.tokensPerDollar >= 800_000;
      const isSweetSpot = !isUltraValue && !isTopEfficiency && perf.tokensPerDollar >= 500_000;
      const isMaxThroughput = perf.tokensPerSec >= 180;

      list.push({
        id: `gpu-${g.id}`,
        itemType: 'gpu',
        provider: g.provider,
        providerDisplayName: fleet?.displayName || g.provider.toUpperCase(),
        hwShortName: hwShort,
        hwArchitecture: perf.architecture,
        vramGb: g.vramGb,
        modality: 'raw_compute',
        executionType:
          g.provider === 'local_pytorch'
            ? 'local'
            : g.pricingModel === 'serverless'
              ? 'serverless'
              : 'dedicated_gpu',
        pricingModel: g.pricingModel,
        pricingModelLabel: g.pricingModel.replace('_', ' ').toUpperCase(),
        preemptionPolicy,
        preemptionPolicyUrl: links.spotPolicyUrl,
        priceHourlyUsd: g.normalizedHourlyUsd,
        priceDisplay: `$${g.normalizedHourlyUsd.toFixed(3)}/hr`,
        priceSubtext: `$${(g.normalizedHourlyUsd / g.vramGb).toFixed(4)}/GB`,
        throughputTokPerSec: perf.tokensPerSec,
        throughputDisplay: `${perf.tokensPerSec} tok/s`,
        throughputSubtext: 'FP16/FP8 Tensor',
        tokensPerDollar: perf.tokensPerDollar,
        costPerMillionUsd: perf.costPerMillion,
        costEfficiencyDisplay: `${(perf.tokensPerDollar / 1000).toFixed(0)}K tok/$`,
        efficiencyBadge: isUltraValue
          ? 'ultra_value'
          : isTopEfficiency
            ? 'top_efficiency'
            : isSweetSpot
              ? 'sweet_spot'
              : isMaxThroughput
                ? 'max_speed'
                : undefined,
        availabilityScore: g.obtainabilityScore,
        availabilityLabel: `${g.obtainabilityLabel} (${Math.round(g.obtainabilityScore * 100)}%)`,
        availabilityUrl: links.capacityUrl,
        reliability,
        riskTier: g.interruptionRiskTier,
        riskUrl: links.spotPolicyUrl,
      });
    }

    // 2. Model Endpoints & Token Factory
    for (const m of modelPricing) {
      const fleet = DEFAULT_PROVIDER_FLEET.find((p) => p.provider.toLowerCase() === m.provider.toLowerCase());
      const catalogMatch = CATALOG_MODELS.find(
        (c) =>
          c.id.toLowerCase() === m.modelId.toLowerCase() ||
          c.name.toLowerCase().includes(m.modelName.toLowerCase()) ||
          m.modelName.toLowerCase().includes(c.name.toLowerCase())
      );

      // Determine open weights vs proprietary badge
      const isProprietary =
        catalogMatch?.weightType === 'proprietary' ||
        m.developer.toLowerCase().includes('anthropic') ||
        m.developer.toLowerCase().includes('internal') ||
        m.developer.toLowerCase().includes('enterprise') ||
        m.modelName.toLowerCase().includes('claude') ||
        m.modelName.toLowerCase().includes('corporate') ||
        m.modelName.toLowerCase().includes('proprietary');

      const weightType: 'open' | 'proprietary' = isProprietary ? 'proprietary' : 'open';

      // Determine model modality
      let modality: UnifiedPricingResult['modality'] = 'text_to_text';
      if (catalogMatch?.purpose && catalogMatch.purpose !== 'all') {
        modality = catalogMatch.purpose;
      } else {
        const lowerName = m.modelName.toLowerCase();
        if (lowerName.includes('flux') || lowerName.includes('diffusion') || lowerName.includes('image')) {
          modality = 'text_to_image';
        } else if (lowerName.includes('video') || lowerName.includes('cogvideo')) {
          modality = 'text_to_video';
        } else if (lowerName.includes('whisper') || lowerName.includes('speech') || lowerName.includes('audio')) {
          modality = 'speech_to_text';
        } else if (lowerName.includes('r1') || lowerName.includes('coder') || lowerName.includes('reasoning')) {
          modality = 'code_reasoning';
        }
      }

      // Hardware Short Name association
      let hwShort = 'Cloud Serverless';
      let arch = 'Cloud Accelerated';
      let vram = 24;

      if (catalogMatch?.recommendedGpuSku) {
        if (catalogMatch.recommendedGpuSku.includes('h100')) {
          hwShort = 'H100 SXM5 (80GB)';
          arch = 'Hopper Tensor Core';
          vram = 80;
        } else if (catalogMatch.recommendedGpuSku.includes('5090')) {
          hwShort = '5090 (32GB)';
          arch = 'Blackwell Architecture';
          vram = 32;
        } else if (catalogMatch.recommendedGpuSku.includes('4090')) {
          hwShort = '4090 (24GB)';
          arch = 'Ada Lovelace 24GB';
          vram = 24;
        } else if (catalogMatch.recommendedGpuSku.includes('5070ti')) {
          hwShort = '5070 Ti (16GB)';
          arch = 'Blackwell Workstation';
          vram = 16;
        } else if (catalogMatch.recommendedGpuSku.includes('l4')) {
          hwShort = 'L4 (24GB)';
          arch = 'Ada Lovelace Serverless';
          vram = 24;
        }
      } else if (m.executionType === 'token_factory') {
        hwShort = 'H100 SXM5 (80GB)';
        arch = 'Hopper Cluster MaaS';
        vram = 80;
      } else if (m.executionType === 'pay_per_call') {
        hwShort = '5090 (32GB)';
        arch = 'Media Accelerators';
        vram = 32;
      } else if (m.provider === 'bedrock') {
        hwShort = 'Inferentia2 (32GB)';
        arch = 'AWS NeuronCore-v2';
        vram = 32;
      }

      const inputRate = m.inputPricePerMillionUsd ?? (m.perUnitUsd ? m.perUnitUsd * 100 : 0.5);
      const toksPerSec =
        modality === 'text_to_text' || modality === 'code_reasoning'
          ? m.executionType === 'token_factory' ? 140 : 95
          : 50;

      const tokensPerDollar = Math.round(1_000_000 / (inputRate > 0 ? inputRate : 0.1));
      const isUltraValue = tokensPerDollar >= 1_000_000;
      const isTopEfficiency = !isUltraValue && tokensPerDollar >= 500_000;

      const links = PROVIDER_CONSOLE_LINKS[m.provider.toLowerCase()] || {
        capacityUrl: fleet?.pricingUrl || '#',
        spotPolicyUrl: fleet?.spotPricingUrl || '#',
      };

      list.push({
        id: `model-${m.id}`,
        itemType: 'model',
        provider: m.provider,
        providerDisplayName: fleet?.displayName || m.provider.toUpperCase(),
        hwShortName: hwShort,
        hwArchitecture: arch,
        vramGb: vram,
        modelName: m.modelName,
        modelId: m.modelId,
        developer: m.developer,
        weightType,
        modality,
        executionType:
          m.executionType === 'token_factory'
            ? 'token_factory'
            : m.executionType === 'serverless_endpoint'
              ? 'serverless'
              : 'pay_per_call',
        pricingModel: m.executionType,
        pricingModelLabel:
          m.executionType === 'token_factory'
            ? 'TOKEN FACTORY (MaaS)'
            : m.executionType === 'serverless_endpoint'
              ? 'SERVERLESS CONTAINER'
              : 'PAY-PER-CALL MEDIA',
        preemptionPolicy: 'Dedicated SLA (zero interruption)',
        preemptionPolicyUrl: fleet?.pricingUrl || '#',
        priceHourlyUsd: (inputRate * toksPerSec * 3.6) / 1000,
        priceDisplay:
          m.inputPricePerMillionUsd !== undefined
            ? `$${m.inputPricePerMillionUsd.toFixed(2)}/1M tok`
            : m.perUnitUsd !== undefined
              ? `$${m.perUnitUsd} / ${m.unitType === 'megapixel' ? 'MP' : 'call'}`
              : '$0.50/1M tok',
        priceSubtext:
          m.outputPricePerMillionUsd !== undefined
            ? `+$${m.outputPricePerMillionUsd.toFixed(2)}/1M out`
            : 'Per Invocation',
        throughputTokPerSec: toksPerSec,
        throughputDisplay:
          modality === 'text_to_text' || modality === 'code_reasoning'
            ? `${toksPerSec} tok/s`
            : '~850 ms/call',
        throughputSubtext:
          m.executionType === 'token_factory'
            ? 'MaaS Cluster'
            : modality === 'text_to_image'
              ? 'Diffusion Latency'
              : 'Accelerated Container',
        tokensPerDollar,
        costPerMillionUsd: inputRate,
        costEfficiencyDisplay: `${(tokensPerDollar / 1000).toFixed(0)}K tok/$`,
        efficiencyBadge: isUltraValue ? 'ultra_value' : isTopEfficiency ? 'top_efficiency' : undefined,
        availabilityScore: 0.98,
        availabilityLabel: 'Instant (100%)',
        availabilityUrl: links.capacityUrl,
        reliability:
          m.provider === 'bedrock'
            ? '99.9% Enterprise SLA'
            : m.provider === 'fal' || m.provider === 'wavespeed'
              ? '99.9% Media Gateway SLA'
              : '99.5% Neocloud Tier 3+',
        riskTier: 'Guaranteed (0%)',
        riskUrl: links.spotPolicyUrl,
      });
    }

    return list;
  }, [gpuPricing, modelPricing]);

  // Filter unified results based on user selection
  const filteredResults = useMemo(() => {
    return unifiedResults.filter((item) => {
      // 1. Provider Filter
      if (selectedProvider !== 'all' && item.provider.toLowerCase() !== selectedProvider.toLowerCase()) {
        return false;
      }

      // 2. Pricing Model Filter
      if (selectedPricingModel !== 'all') {
        if (selectedPricingModel === 'spot_bid') {
          if (item.pricingModel !== 'spot_bid' && item.pricingModel !== 'spot' && item.pricingModel !== 'preemptible') {
            return false;
          }
        } else if (selectedPricingModel === 'on_demand') {
          if (item.pricingModel !== 'on_demand') return false;
        } else if (selectedPricingModel === 'serverless') {
          if (item.pricingModel !== 'serverless' && item.pricingModel !== 'serverless_endpoint') return false;
        } else if (selectedPricingModel === 'token_factory') {
          if (item.pricingModel !== 'token_factory') return false;
        } else if (selectedPricingModel === 'local') {
          if (item.provider !== 'local_pytorch') return false;
        }
      }

      // 3. Model Modality Filter
      if (selectedModality !== 'all') {
        if (selectedModality === 'raw_compute') {
          if (item.itemType !== 'gpu') return false;
        } else if (item.itemType === 'model') {
          if (item.modality !== selectedModality) return false;
        } else if (item.itemType === 'gpu') {
          // GPUs can execute LLMs and Diffusion
          if (selectedModality !== 'text_to_text' && selectedModality !== 'text_to_image') {
            return false;
          }
        }
      }

      // 4. Execution Type Filter
      if (selectedExecutionType !== 'all') {
        if (selectedExecutionType === 'dedicated_gpu') {
          if (item.executionType !== 'dedicated_gpu') return false;
        } else if (selectedExecutionType === 'token_factory') {
          if (item.executionType !== 'token_factory') return false;
        } else if (selectedExecutionType === 'serverless') {
          if (item.executionType !== 'serverless') return false;
        } else if (selectedExecutionType === 'pay_per_call') {
          if (item.executionType !== 'pay_per_call') return false;
        } else if (selectedExecutionType === 'local') {
          if (item.executionType !== 'local') return false;
        }
      }

      // 5. Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesHw = item.hwShortName.toLowerCase().includes(q);
        const matchesProv = item.providerDisplayName.toLowerCase().includes(q) || item.provider.toLowerCase().includes(q);
        const matchesModel = item.modelName ? item.modelName.toLowerCase().includes(q) : false;
        const matchesDev = item.developer ? item.developer.toLowerCase().includes(q) : false;
        const matchesArch = item.hwArchitecture.toLowerCase().includes(q);
        if (!matchesHw && !matchesProv && !matchesModel && !matchesDev && !matchesArch) {
          return false;
        }
      }

      return true;
    });
  }, [unifiedResults, selectedProvider, selectedPricingModel, selectedModality, selectedExecutionType, searchQuery]);

  // Sort unified results via SortableHeader
  const sortedResults = useMemo(() => {
    return genericSort(filteredResults, sortKey, sortDir, (item, key) => {
      if (key === 'provider') return item.providerDisplayName;
      if (key === 'hw') return item.hwShortName;
      if (key === 'price') return item.priceHourlyUsd;
      if (key === 'throughput') return item.throughputTokPerSec;
      if (key === 'costEfficiency') return item.tokensPerDollar;
      if (key === 'pricingModel') return item.pricingModelLabel;
      if (key === 'availability') return item.availabilityScore;
      if (key === 'reliability') return item.reliability;
      if (key === 'risk') return item.riskTier;
      return (item as unknown as Record<string, unknown>)[key];
    });
  }, [filteredResults, sortKey, sortDir]);

  const handleResetFilters = () => {
    setSelectedProvider('all');
    setSelectedPricingModel('all');
    setSelectedModality('all');
    setSelectedExecutionType('all');
    setSearchQuery('');
  };

  const hasActiveFilters =
    selectedProvider !== 'all' ||
    selectedPricingModel !== 'all' ||
    selectedModality !== 'all' ||
    selectedExecutionType !== 'all' ||
    searchQuery.trim().length > 0;

  return (
    <div
      style={{
        maxWidth: '1200px',
        width: '100%',
        margin: '0 auto',
        padding: '16px 20px',
        boxSizing: 'border-box',
      }}
    >
      {/* Top Header & Actions */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: '16px',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h1 style={{ fontSize: '22px', fontWeight: 700, color: '#f8fafc', margin: 0 }}>
              GPU &amp; Model Pricing
            </h1>
            <span
              style={{
                backgroundColor: '#10b98120',
                color: '#10b981',
                border: '1px solid #10b98140',
                borderRadius: '6px',
                padding: '2px 8px',
                fontSize: '11px',
                fontWeight: 600,
              }}
            >
              Real-Time Cross-Cloud Intelligence
            </span>
          </div>
          <p style={{ color: '#94a3b8', fontSize: '13px', marginTop: '4px', margin: 0 }}>
            Unified catalog across 14 providers: live GPU spot auctions, on-demand hardware, Token Factory MaaS &amp; serverless rates.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {syncMessage && (
            <span style={{ color: '#10b981', fontSize: '12px', fontWeight: 500 }}>
              {syncMessage}
            </span>
          )}
          <button
            onClick={() => setShowHistoryChart((prev) => !prev)}
            style={{
              backgroundColor: showHistoryChart ? '#334155' : '#1e293b',
              color: '#38bdf8',
              border: '1px solid #38bdf840',
              borderRadius: '6px',
              padding: '8px 12px',
              fontWeight: 600,
              fontSize: '12px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              transition: 'background-color 0.2s',
            }}
          >
            <span>{showHistoryChart ? '📉 Close History Chart' : '📈 Price Fluctuations'}</span>
          </button>
          <button
            onClick={handleSync}
            disabled={isSyncing}
            style={{
              backgroundColor: '#3b82f6',
              color: '#ffffff',
              border: 'none',
              borderRadius: '6px',
              padding: '8px 14px',
              fontWeight: 600,
              fontSize: '12px',
              cursor: isSyncing ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              transition: 'background-color 0.2s',
            }}
          >
            {isSyncing ? 'Syncing...' : '↻ Refresh Catalogs'}
          </button>
        </div>
      </div>

      {/* Multi-Cloud Provider Fleet & Real-Time Sync Status Bar (in table format that can be hidden) */}
      <ProviderFleetBar
        syncAudits={syncAudits}
        providerBalances={providerBalances}
        onRefreshSync={handleSync}
        isSyncing={isSyncing}
      />

      {/* Optional Collapsible Historical Price Chart */}
      {showHistoryChart && historySummaries.length > 0 && (
        <div style={{ marginBottom: '20px' }}>
          <HistoricalPriceChart summaries={historySummaries} />
        </div>
      )}

      {/* Top Filter Bar: Provider, Pricing Model, Model Modality, Execution Type */}
      <div
        style={{
          backgroundColor: '#0f172a',
          padding: '14px 16px',
          borderRadius: '10px',
          border: '1px solid #1e293b',
          display: 'flex',
          gap: '12px',
          alignItems: 'center',
          flexWrap: 'wrap',
          marginBottom: '16px',
        }}
      >
        {/* Search */}
        <div style={{ flex: '1 1 180px' }}>
          <input
            type="text"
            placeholder="Search chip, model, or provider..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: '100%',
              backgroundColor: '#1e293b',
              border: '1px solid #334155',
              borderRadius: '6px',
              padding: '7px 11px',
              color: '#f8fafc',
              fontSize: '12px',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Filter 1: Provider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <label style={{ color: '#94a3b8', fontSize: '12px', fontWeight: 500 }}>Provider:</label>
          <select
            value={selectedProvider}
            onChange={(e) => setSelectedProvider(e.target.value)}
            style={{
              backgroundColor: '#1e293b',
              color: '#f8fafc',
              border: '1px solid #334155',
              borderRadius: '6px',
              padding: '7px 10px',
              fontSize: '12px',
            }}
          >
            <option value="all">All Providers</option>
            <option value="runpod">RunPod</option>
            <option value="vast_ai">Vast.ai</option>
            <option value="baseten">Baseten</option>
            <option value="nebius">Nebius AI Studio</option>
            <option value="jarvislabs">JarvisLabs</option>
            <option value="coreweave">CoreWeave</option>
            <option value="fal">fal.ai</option>
            <option value="runware">Runware</option>
            <option value="hivenet">Hivenet</option>
            <option value="wavespeed">WaveSpeed</option>
            <option value="neocloudz">NeoCloudz</option>
            <option value="bedrock">AWS Bedrock</option>
            <option value="sagemaker">AWS SageMaker</option>
            <option value="local_pytorch">Local PyTorch</option>
          </select>
        </div>

        {/* Filter 2: Pricing Model */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <label style={{ color: '#94a3b8', fontSize: '12px', fontWeight: 500 }}>Pricing Model:</label>
          <select
            value={selectedPricingModel}
            onChange={(e) => setSelectedPricingModel(e.target.value)}
            style={{
              backgroundColor: '#1e293b',
              color: '#f8fafc',
              border: '1px solid #334155',
              borderRadius: '6px',
              padding: '7px 10px',
              fontSize: '12px',
            }}
          >
            <option value="all">All Models</option>
            <option value="spot_bid">Spot / Preemptible</option>
            <option value="on_demand">On-Demand ($0 Commit)</option>
            <option value="serverless">Serverless Micro-metered</option>
            <option value="token_factory">Token Factory (MaaS)</option>
            <option value="local">Dedicated Local HW</option>
          </select>
        </div>

        {/* Filter 3: Model Modality */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <label style={{ color: '#94a3b8', fontSize: '12px', fontWeight: 500 }}>Modality:</label>
          <select
            value={selectedModality}
            onChange={(e) => setSelectedModality(e.target.value)}
            style={{
              backgroundColor: '#1e293b',
              color: '#f8fafc',
              border: '1px solid #334155',
              borderRadius: '6px',
              padding: '7px 10px',
              fontSize: '12px',
            }}
          >
            <option value="all">All Modalities</option>
            <option value="text_to_text">Text-to-Text (LLM)</option>
            <option value="text_to_image">Text-to-Image (Diffusion)</option>
            <option value="text_to_video">Text-to-Video</option>
            <option value="speech_to_text">Speech-to-Text (Audio)</option>
            <option value="code_reasoning">Code &amp; Reasoning</option>
            <option value="raw_compute">Raw GPU Compute</option>
          </select>
        </div>

        {/* Filter 4: Execution Type */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <label style={{ color: '#94a3b8', fontSize: '12px', fontWeight: 500 }}>Execution:</label>
          <select
            value={selectedExecutionType}
            onChange={(e) => setSelectedExecutionType(e.target.value)}
            style={{
              backgroundColor: '#1e293b',
              color: '#f8fafc',
              border: '1px solid #334155',
              borderRadius: '6px',
              padding: '7px 10px',
              fontSize: '12px',
            }}
          >
            <option value="all">All Execution Types</option>
            <option value="dedicated_gpu">Dedicated Cloud GPU</option>
            <option value="token_factory">Token Factory (MaaS)</option>
            <option value="serverless">Serverless Container</option>
            <option value="pay_per_call">Pay-Per-Call Media</option>
            <option value="local">Local Workstation</option>
          </select>
        </div>

        {/* Reset Filters & Results Count */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: 'auto' }}>
          <span
            style={{
              backgroundColor: '#1e293b',
              color: '#38bdf8',
              padding: '4px 8px',
              borderRadius: '4px',
              fontSize: '11px',
              fontWeight: 600,
            }}
          >
            {sortedResults.length} Results
          </span>
          {hasActiveFilters && (
            <button
              onClick={handleResetFilters}
              style={{
                backgroundColor: 'transparent',
                color: '#94a3b8',
                border: '1px solid #475569',
                borderRadius: '4px',
                padding: '4px 8px',
                fontSize: '11px',
                cursor: 'pointer',
              }}
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {isLoading && unifiedResults.length === 0 && (
        <div style={{ textAlign: 'center', padding: '30px', color: '#94a3b8', fontSize: '14px' }}>
          Loading real-time pricing intelligence from neocloud provider catalogs...
        </div>
      )}

      {/* Results Table: Columns Provider, HW -short name, eg. 5070 Ti (16GB)-, Price, Throughput, Cost-Efficiency, Pricing Model (with preemption policy), Availability, Reliability, Risk */}
      <div
        style={{
          backgroundColor: '#0f172a',
          borderRadius: '10px',
          border: '1px solid #1e293b',
          overflow: 'hidden',
        }}
      >
        <div style={{ overflowX: 'auto' }}>
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              textAlign: 'left',
              fontSize: '12px',
            }}
          >
            <thead>
              <tr style={{ backgroundColor: '#1e293b', borderBottom: '1px solid #334155' }}>
                <SortableHeader
                  column="provider"
                  currentSortKey={sortKey}
                  currentSortDir={sortDir}
                  onSort={handleSort}
                  style={{ padding: '12px 14px' }}
                >
                  Provider
                </SortableHeader>
                <SortableHeader
                  column="hw"
                  currentSortKey={sortKey}
                  currentSortDir={sortDir}
                  onSort={handleSort}
                  style={{ padding: '12px 14px' }}
                >
                  HW (Chip &amp; Model)
                </SortableHeader>
                <SortableHeader
                  column="price"
                  currentSortKey={sortKey}
                  currentSortDir={sortDir}
                  onSort={handleSort}
                  style={{ padding: '12px 14px', color: '#10b981' }}
                >
                  Price
                </SortableHeader>
                <SortableHeader
                  column="throughput"
                  currentSortKey={sortKey}
                  currentSortDir={sortDir}
                  onSort={handleSort}
                  style={{ padding: '12px 14px', color: '#c084fc' }}
                >
                  Throughput
                </SortableHeader>
                <SortableHeader
                  column="costEfficiency"
                  currentSortKey={sortKey}
                  currentSortDir={sortDir}
                  onSort={handleSort}
                  style={{ padding: '12px 14px', color: '#34d399' }}
                >
                  Cost-Efficiency
                </SortableHeader>
                <SortableHeader
                  column="pricingModel"
                  currentSortKey={sortKey}
                  currentSortDir={sortDir}
                  onSort={handleSort}
                  style={{ padding: '12px 14px' }}
                >
                  Pricing Model (Preemption Policy)
                </SortableHeader>
                <SortableHeader
                  column="availability"
                  currentSortKey={sortKey}
                  currentSortDir={sortDir}
                  onSort={handleSort}
                  style={{ padding: '12px 14px' }}
                >
                  Availability
                </SortableHeader>
                <SortableHeader
                  column="reliability"
                  currentSortKey={sortKey}
                  currentSortDir={sortDir}
                  onSort={handleSort}
                  style={{ padding: '12px 14px' }}
                >
                  Reliability
                </SortableHeader>
                <SortableHeader
                  column="risk"
                  currentSortKey={sortKey}
                  currentSortDir={sortDir}
                  onSort={handleSort}
                  style={{ padding: '12px 14px' }}
                >
                  Risk
                </SortableHeader>
              </tr>
            </thead>
            <tbody>
              {sortedResults.length === 0 ? (
                <tr>
                  <td
                    colSpan={9}
                    style={{
                      textAlign: 'center',
                      padding: '36px',
                      color: '#64748b',
                      fontSize: '13px',
                    }}
                  >
                    No matching offerings found for the selected filter combination. Click Reset to clear filters.
                  </td>
                </tr>
              ) : (
                sortedResults.map((item, idx) => (
                  <tr
                    key={item.id}
                    style={{
                      borderBottom: '1px solid #1e293b',
                      backgroundColor: idx % 2 === 0 ? 'transparent' : '#1e293b20',
                      transition: 'background-color 0.15s ease',
                    }}
                  >
                    {/* 1. Provider */}
                    <td style={{ padding: '12px 14px', fontWeight: 600 }}>
                      <a
                        href={item.availabilityUrl}
                        target={item.availabilityUrl.startsWith('http') ? '_blank' : '_self'}
                        rel="noopener noreferrer"
                        title={`View ${item.providerDisplayName} console & infrastructure`}
                        style={{
                          backgroundColor: '#3b82f620',
                          color: '#60a5fa',
                          padding: '3px 7px',
                          borderRadius: '4px',
                          fontSize: '11px',
                          textDecoration: 'none',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '3px',
                        }}
                      >
                        {item.providerDisplayName}
                      </a>
                    </td>

                    {/* 2. HW (short name, eg. 5070 Ti (16GB)) with Model & Open vs Proprietary Badge */}
                    <td style={{ padding: '12px 14px' }}>
                      {item.modelName ? (
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                            <span style={{ fontWeight: 700, color: '#f8fafc', fontSize: '13px' }}>
                              {item.modelName}
                            </span>
                            {/* Open vs Proprietary Badge (no filter on top, marked with badge/icon) */}
                            {item.weightType === 'open' ? (
                              <span
                                title="Open Weights Model (Community / Apache 2.0 License)"
                                style={{
                                  backgroundColor: 'rgba(16, 185, 129, 0.15)',
                                  color: '#34d399',
                                  border: '1px solid rgba(16, 185, 129, 0.3)',
                                  borderRadius: '4px',
                                  padding: '1px 5px',
                                  fontSize: '10px',
                                  fontWeight: 700,
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '2px',
                                }}
                              >
                                🟢 Open
                              </span>
                            ) : (
                              <span
                                title="Proprietary / Closed Enterprise Weights"
                                style={{
                                  backgroundColor: 'rgba(245, 158, 11, 0.15)',
                                  color: '#fbbf24',
                                  border: '1px solid rgba(245, 158, 11, 0.3)',
                                  borderRadius: '4px',
                                  padding: '1px 5px',
                                  fontSize: '10px',
                                  fontWeight: 700,
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '2px',
                                }}
                              >
                                🔒 Proprietary
                              </span>
                            )}
                          </div>
                          <div
                            style={{
                              fontSize: '11px',
                              color: '#94a3b8',
                              marginTop: '2px',
                              display: 'flex',
                              gap: '6px',
                              alignItems: 'center',
                            }}
                          >
                            <span style={{ color: '#38bdf8', fontWeight: 600 }}>{item.hwShortName}</span>
                            <span>•</span>
                            <span>{item.hwArchitecture}</span>
                          </div>
                        </div>
                      ) : (
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ fontWeight: 700, color: '#f8fafc', fontSize: '13px' }}>
                              {item.hwShortName}
                            </span>
                            <span
                              style={{
                                backgroundColor: 'rgba(56, 189, 248, 0.15)',
                                color: '#38bdf8',
                                border: '1px solid rgba(56, 189, 248, 0.3)',
                                borderRadius: '4px',
                                padding: '1px 5px',
                                fontSize: '10px',
                                fontWeight: 700,
                              }}
                            >
                              Hardware Chip
                            </span>
                          </div>
                          <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>
                            {item.hwArchitecture}
                          </div>
                        </div>
                      )}
                    </td>

                    {/* 3. Price */}
                    <td style={{ padding: '12px 14px' }}>
                      <div style={{ color: '#10b981', fontWeight: 700, fontSize: '13px' }}>
                        {item.priceDisplay}
                      </div>
                      {item.priceSubtext && (
                        <div style={{ fontSize: '10px', color: '#64748b', marginTop: '1px' }}>
                          {item.priceSubtext}
                        </div>
                      )}
                    </td>

                    {/* 4. Throughput */}
                    <td style={{ padding: '12px 14px' }}>
                      <div style={{ color: '#c084fc', fontWeight: 700, fontSize: '12px' }}>
                        {item.throughputDisplay}
                      </div>
                      <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '1px' }}>
                        {item.throughputSubtext}
                      </div>
                    </td>

                    {/* 5. Cost-Efficiency */}
                    <td style={{ padding: '12px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <span style={{ color: '#34d399', fontWeight: 700, fontSize: '12px' }}>
                          {item.costEfficiencyDisplay}
                        </span>
                        {item.efficiencyBadge === 'ultra_value' && (
                          <span
                            style={{
                              backgroundColor: 'rgba(52, 211, 153, 0.15)',
                              color: '#34d399',
                              fontSize: '9px',
                              padding: '1px 4px',
                              borderRadius: '3px',
                              fontWeight: 700,
                            }}
                          >
                            🚀 ULTRA
                          </span>
                        )}
                        {item.efficiencyBadge === 'top_efficiency' && (
                          <span
                            style={{
                              backgroundColor: 'rgba(16, 185, 129, 0.15)',
                              color: '#10b981',
                              fontSize: '9px',
                              padding: '1px 4px',
                              borderRadius: '3px',
                              fontWeight: 700,
                            }}
                          >
                            🏆 TOP
                          </span>
                        )}
                        {item.efficiencyBadge === 'sweet_spot' && (
                          <span
                            style={{
                              backgroundColor: 'rgba(56, 189, 248, 0.15)',
                              color: '#38bdf8',
                              fontSize: '9px',
                              padding: '1px 4px',
                              borderRadius: '3px',
                              fontWeight: 700,
                            }}
                          >
                            ⚡ SWEET
                          </span>
                        )}
                        {item.efficiencyBadge === 'max_speed' && (
                          <span
                            style={{
                              backgroundColor: 'rgba(239, 68, 68, 0.15)',
                              color: '#f87171',
                              fontSize: '9px',
                              padding: '1px 4px',
                              borderRadius: '3px',
                              fontWeight: 700,
                            }}
                          >
                            🔥 SPEED
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '1px' }}>
                        ${item.costPerMillionUsd.toFixed(2)}/1M tok
                      </div>
                    </td>

                    {/* 6. Pricing Model (with preemption policy) */}
                    <td style={{ padding: '12px 14px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                        <span
                          style={{
                            color:
                              item.pricingModel === 'spot_bid' || item.pricingModel === 'spot'
                                ? '#34d399'
                                : item.pricingModel === 'serverless' || item.pricingModel === 'serverless_endpoint'
                                  ? '#a78bfa'
                                  : item.pricingModel === 'token_factory'
                                    ? '#c084fc'
                                    : item.pricingModel === 'local'
                                      ? '#38bdf8'
                                      : '#60a5fa',
                            fontWeight: 700,
                            fontSize: '11px',
                            textTransform: 'uppercase',
                          }}
                        >
                          {item.pricingModelLabel}
                        </span>
                        <a
                          href={item.preemptionPolicyUrl}
                          target={item.preemptionPolicyUrl.startsWith('http') ? '_blank' : '_self'}
                          rel="noopener noreferrer"
                          title={`Preemption & Spot Eviction Policy: ${item.preemptionPolicy}. Click to inspect provider documentation.`}
                          style={{
                            fontSize: '10px',
                            color: '#94a3b8',
                            textDecoration: 'none',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '3px',
                            borderBottom: '1px dotted #475569',
                          }}
                        >
                          <span>{item.preemptionPolicy}</span>
                        </a>
                      </div>
                    </td>

                    {/* 7. Availability */}
                    <td style={{ padding: '12px 14px' }}>
                      <a
                        href={item.availabilityUrl}
                        target={item.availabilityUrl.startsWith('http') ? '_blank' : '_self'}
                        rel="noopener noreferrer"
                        title={`Availability: ${(item.availabilityScore * 100).toFixed(0)}% instant placement probability. Click to inspect live console capacity.`}
                        style={{
                          backgroundColor:
                            item.availabilityLabel.includes('High') || item.availabilityLabel.includes('Instant')
                              ? '#10b98120'
                              : item.availabilityLabel.includes('Medium')
                                ? '#f59e0b20'
                                : '#ef444420',
                          color:
                            item.availabilityLabel.includes('High') || item.availabilityLabel.includes('Instant')
                              ? '#34d399'
                              : item.availabilityLabel.includes('Medium')
                                ? '#fbbf24'
                                : '#f87171',
                          padding: '2px 7px',
                          borderRadius: '4px',
                          fontSize: '11px',
                          fontWeight: 600,
                          textDecoration: 'none',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '3px',
                        }}
                      >
                        {item.availabilityLabel}
                      </a>
                    </td>

                    {/* 8. Reliability */}
                    <td style={{ padding: '12px 14px', color: '#f1f5f9', fontSize: '11px', fontWeight: 600 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <span
                          style={{
                            width: '6px',
                            height: '6px',
                            borderRadius: '50%',
                            backgroundColor:
                              item.reliability.includes('99.') || item.reliability.includes('100%')
                                ? '#10b981'
                                : '#f59e0b',
                            flexShrink: 0,
                          }}
                        />
                        <span>{item.reliability}</span>
                      </div>
                    </td>

                    {/* 9. Risk */}
                    <td style={{ padding: '12px 14px', fontSize: '11px' }}>
                      <a
                        href={item.riskUrl}
                        target={item.riskUrl.startsWith('http') ? '_blank' : '_self'}
                        rel="noopener noreferrer"
                        title={`Interruption Risk Profile: ${item.riskTier}. Click to inspect spot preemption policy.`}
                        style={{
                          color:
                            item.riskTier === 'guaranteed' || item.riskTier === 'Guaranteed (0%)'
                              ? '#38bdf8'
                              : item.riskTier === '<5%'
                                ? '#34d399'
                                : '#f59e0b',
                          fontWeight: 600,
                          textDecoration: 'none',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '3px',
                          borderBottom: '1px dotted currentColor',
                        }}
                      >
                        {item.riskTier}
                      </a>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
