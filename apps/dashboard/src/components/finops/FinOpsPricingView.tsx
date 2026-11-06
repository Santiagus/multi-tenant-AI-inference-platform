import { useState, useEffect, useMemo } from 'react';
import { apiClient } from '../../api/client';
import type {
  GpuPricingItem,
  ModelPricingItem,
  PricingHistorySummary,
  PricingSyncAudit,
} from '../../types';
import { StatCard } from '../common/StatCard';
import { StatusBadge } from '../common/Badge';
import { SortableHeader, genericSort, type SortDirection } from '../common/SortableHeader';
import { ProviderFleetBar } from './ProviderFleetBar';
import { HistoricalPriceChart } from './HistoricalPriceChart';
import { ModelRecommendationStudio } from './ModelRecommendationStudio';

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

export function FinOpsPricingView() {
  const [activeSubTab, setActiveSubTab] = useState<'gpus' | 'recommendations' | 'vram_matrix' | 'models' | 'history'>('gpus');
  const [gpuPricing, setGpuPricing] = useState<GpuPricingItem[]>([]);
  const [modelPricing, setModelPricing] = useState<ModelPricingItem[]>([]);
  const [historySummaries, setHistorySummaries] = useState<PricingHistorySummary[]>([]);
  const [syncAudits, setSyncAudits] = useState<PricingSyncAudit[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  // Filters
  const [selectedProvider, setSelectedProvider] = useState<string>('all');
  const [selectedPricingModel, setSelectedPricingModel] = useState<string>('all');
  const [selectedExecutionType, setSelectedExecutionType] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Table Sorting State (SortableHeader)
  const [gpuSortKey, setGpuSortKey] = useState<string>('normalizedHourlyUsd');
  const [gpuSortDir, setGpuSortDir] = useState<SortDirection>('asc');
  const [modelSortKey, setModelSortKey] = useState<string>('modelName');
  const [modelSortDir, setModelSortDir] = useState<SortDirection>('asc');

  const handleGpuSort = (col: string) => {
    if (gpuSortKey === col) {
      setGpuSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setGpuSortKey(col);
      setGpuSortDir(
        col === 'throughput' || col === 'costEfficiency' || col === 'obtainabilityScore'
          ? 'desc'
          : 'asc'
      );
    }
  };

  const handleModelSort = (col: string) => {
    if (modelSortKey === col) {
      setModelSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setModelSortKey(col);
      setModelSortDir(col === 'modelName' || col === 'provider' ? 'asc' : 'asc');
    }
  };

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [gpuRes, modelRes, histRes] = await Promise.all([
        apiClient.getGpuPricing(),
        apiClient.getModelPricing(),
        apiClient.getPricingHistory(),
      ]);
      setGpuPricing(gpuRes.data);
      setModelPricing(modelRes.data);
      setHistorySummaries(histRes.data);
      setSyncAudits(histRes.cadence_audits || []);
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

  // KPIs
  const lowestSpotGpu = useMemo(() => {
    const spotItems = gpuPricing.filter((g) => g.pricingModel === 'spot_bid');
    if (spotItems.length === 0) return null;
    return spotItems.reduce((min, cur) =>
      cur.normalizedHourlyUsd < min.normalizedHourlyUsd ? cur : min
    );
  }, [gpuPricing]);

  const lowestVramPriceGpu = useMemo(() => {
    if (gpuPricing.length === 0) return null;
    return gpuPricing.reduce((min, cur) => {
      const curRate = cur.normalizedHourlyUsd / cur.vramGb;
      const minRate = min.normalizedHourlyUsd / min.vramGb;
      return curRate < minRate ? cur : min;
    });
  }, [gpuPricing]);

  const lowestOnDemandH100 = useMemo(() => {
    const h100s = gpuPricing.filter(
      (g) => g.hardwareSkuId === 'nvidia-h100-sxm' && g.pricingModel === 'on_demand'
    );
    if (h100s.length === 0) return null;
    return h100s.reduce((min, cur) =>
      cur.normalizedHourlyUsd < min.normalizedHourlyUsd ? cur : min
    );
  }, [gpuPricing]);

  const lowestTokenFactory = useMemo(() => {
    const tokenModels = modelPricing.filter(
      (m) => m.executionType === 'token_factory' && m.inputPricePerMillionUsd
    );
    if (tokenModels.length === 0) return null;
    return tokenModels.reduce((min, cur) =>
      (cur.inputPricePerMillionUsd || 999) < (min.inputPricePerMillionUsd || 999) ? cur : min
    );
  }, [modelPricing]);

  // VRAM Tier Matrix
  const vramTierMatrix = useMemo(() => {
    const tiers = [
      { label: '16 GB Tier', min: 14, max: 18, desc: 'Entry-level fine-tuning & 8B inference (RTX 5070 Ti / V100)' },
      { label: '24 GB Tier', min: 20, max: 28, desc: 'Mid-range LLM & diffusion workloads (RTX 4090 / L4 / A10G)' },
      { label: '32 GB Tier', min: 30, max: 36, desc: 'High-speed Blackwell compute (RTX 5090)' },
      { label: '80 GB Tier', min: 70, max: 90, desc: 'Enterprise 70B+ & batch training (H100 SXM5 / A100)' },
    ];

    return tiers.map((tier) => {
      const matches = gpuPricing.filter((g) => g.vramGb >= tier.min && g.vramGb <= tier.max);
      const spotItems = matches.filter((g) => g.pricingModel === 'spot_bid' || g.pricingModel === 'preemptible');
      const onDemandItems = matches.filter((g) => g.pricingModel === 'on_demand');

      const bestSpot =
        spotItems.length > 0
          ? spotItems.reduce((min, cur) => (cur.normalizedHourlyUsd < min.normalizedHourlyUsd ? cur : min))
          : null;

      const bestOnDemand =
        onDemandItems.length > 0
          ? onDemandItems.reduce((min, cur) => (cur.normalizedHourlyUsd < min.normalizedHourlyUsd ? cur : min))
          : null;

      return {
        ...tier,
        totalOptions: matches.length,
        bestSpot,
        bestOnDemand,
      };
    });
  }, [gpuPricing]);

  // Open Model Best Deals
  const openModelBestDeals = useMemo(() => {
    const map = new Map<string, { modelName: string; developer: string; options: ModelPricingItem[] }>();
    for (const m of modelPricing) {
      if (!map.has(m.modelName)) {
        map.set(m.modelName, { modelName: m.modelName, developer: m.developer, options: [] });
      }
      map.get(m.modelName)!.options.push(m);
    }

    return Array.from(map.values()).map((entry) => {
      const best = entry.options.reduce((cheapest, cur) => {
        const curCost = cur.inputPricePerMillionUsd ?? cur.perUnitUsd ?? 999;
        const cheapCost = cheapest.inputPricePerMillionUsd ?? cheapest.perUnitUsd ?? 999;
        return curCost < cheapCost ? cur : cheapest;
      }, entry.options[0]);

      return {
        modelName: entry.modelName,
        developer: entry.developer,
        bestOption: best,
        totalProviders: entry.options.length,
      };
    });
  }, [modelPricing]);

  // Filtered GPU list
  const filteredGpus = useMemo(() => {
    return gpuPricing.filter((item) => {
      if (selectedProvider !== 'all' && item.provider !== selectedProvider) return false;
      if (selectedPricingModel !== 'all' && item.pricingModel !== selectedPricingModel) return false;
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesName = item.hardwareDisplayName.toLowerCase().includes(query);
        const matchesSku = item.hardwareSkuId.toLowerCase().includes(query);
        const matchesProv = item.provider.toLowerCase().includes(query);
        if (!matchesName && !matchesSku && !matchesProv) return false;
      }
      return true;
    });
  }, [gpuPricing, selectedProvider, selectedPricingModel, searchQuery]);

  // Sorted GPU list via SortableHeader
  const sortedGpus = useMemo(() => {
    return genericSort(filteredGpus, gpuSortKey, gpuSortDir, (item, key) => {
      if (key === 'vramPrice') return item.normalizedHourlyUsd / item.vramGb;
      if (key === 'hourlyPrice') return item.normalizedHourlyUsd;
      if (key === 'throughput') return getGpuPerformance(item).tokensPerSec;
      if (key === 'costEfficiency') return getGpuPerformance(item).tokensPerDollar;
      return (item as unknown as Record<string, unknown>)[key];
    });
  }, [filteredGpus, gpuSortKey, gpuSortDir]);

  // Filtered Models list
  const filteredModels = useMemo(() => {
    return modelPricing.filter((item) => {
      if (selectedProvider !== 'all' && item.provider !== selectedProvider) return false;
      if (selectedExecutionType !== 'all' && item.executionType !== selectedExecutionType) return false;
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesName = item.modelName.toLowerCase().includes(query);
        const matchesId = item.modelId.toLowerCase().includes(query);
        const matchesDev = item.developer.toLowerCase().includes(query);
        if (!matchesName && !matchesId && !matchesDev) return false;
      }
      return true;
    });
  }, [modelPricing, selectedProvider, selectedExecutionType, searchQuery]);

  // Sorted Models list via SortableHeader
  const sortedModels = useMemo(() => {
    return genericSort(filteredModels, modelSortKey, modelSortDir, (item, key) => {
      if (key === 'inputPrice') return item.inputPricePerMillionUsd ?? item.perUnitUsd ?? 999;
      if (key === 'outputPrice') return item.outputPricePerMillionUsd ?? 999;
      if (key === 'cachedPrice') return item.cachedPricePerMillionUsd ?? 999;
      return (item as unknown as Record<string, unknown>)[key];
    });
  }, [filteredModels, modelSortKey, modelSortDir]);

  return (
    <div style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>
      {/* Top Header & Sync Action */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: '24px',
          flexWrap: 'wrap',
          gap: '16px',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h1 style={{ fontSize: '24px', fontWeight: 700, color: '#f8fafc', margin: 0 }}>
              Neocloud & FinOps Pricing Intelligence
            </h1>
            <span
              style={{
                backgroundColor: '#10b98120',
                color: '#10b981',
                border: '1px solid #10b98140',
                borderRadius: '6px',
                padding: '2px 8px',
                fontSize: '12px',
                fontWeight: 600,
              }}
            >
              $0 Long-Term Commitments
            </span>
          </div>
          <p style={{ color: '#94a3b8', fontSize: '14px', marginTop: '4px', margin: 0 }}>
            Real-time cross-provider GPU availability, on-demand vs spot rates, Token Factory pricing & update cadence.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {syncMessage && (
            <span style={{ color: '#10b981', fontSize: '13px', fontWeight: 500 }}>
              {syncMessage}
            </span>
          )}
          <button
            onClick={handleSync}
            disabled={isSyncing}
            style={{
              backgroundColor: '#3b82f6',
              color: '#ffffff',
              border: 'none',
              borderRadius: '8px',
              padding: '10px 16px',
              fontWeight: 600,
              fontSize: '13px',
              cursor: isSyncing ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              transition: 'background-color 0.2s',
            }}
          >
            {isSyncing ? 'Syncing Providers...' : '↻ Refresh Catalogs'}
          </button>
        </div>
      </div>

      {/* KPI Stats Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: '16px',
          marginBottom: '24px',
        }}
      >
        <StatCard
          label="Lowest Spot GPU Rate"
          value={lowestSpotGpu ? `$${lowestSpotGpu.normalizedHourlyUsd.toFixed(3)}/hr` : '--'}
          subtext={lowestSpotGpu ? `${lowestSpotGpu.hardwareDisplayName} (${lowestSpotGpu.provider})` : 'Spot Auction'}
          accentColor="#10b981"
          trend="-55% vs on-demand"
          trendPositive={true}
        />
        <StatCard
          label="Lowest Price / GB VRAM"
          value={
            lowestVramPriceGpu
              ? `$${(lowestVramPriceGpu.normalizedHourlyUsd / lowestVramPriceGpu.vramGb).toFixed(4)}/GB-hr`
              : '--'
          }
          subtext={
            lowestVramPriceGpu
              ? `${lowestVramPriceGpu.hardwareDisplayName} (${lowestVramPriceGpu.provider})`
              : 'Best VRAM Deal'
          }
          accentColor="#06b6d4"
          trend="Highest VRAM Value"
          trendPositive={true}
        />
        <StatCard
          label="Lowest On-Demand H100 (80GB)"
          value={lowestOnDemandH100 ? `$${lowestOnDemandH100.normalizedHourlyUsd.toFixed(2)}/hr` : '--'}
          subtext={lowestOnDemandH100 ? `${lowestOnDemandH100.provider} (Dedicated SXM5)` : 'Enterprise H100'}
          accentColor="#3b82f6"
          trend="No annual commit"
          trendPositive={true}
        />
        <StatCard
          label="Lowest Token Factory Input"
          value={lowestTokenFactory ? `$${lowestTokenFactory.inputPricePerMillionUsd}/1M` : '--'}
          subtext={lowestTokenFactory ? `${lowestTokenFactory.modelName} (${lowestTokenFactory.provider})` : 'MaaS API'}
          accentColor="#8b5cf6"
          trend="1M context window"
          trendPositive={true}
        />
        <StatCard
          label="Monitored Neocloud Catalogs"
          value={syncAudits.length > 0 ? `${syncAudits.length} Providers` : '7 Neoclouds'}
          subtext="RunPod, Vast.ai, Baseten, Nebius, JarvisLabs, fal, Runware"
          accentColor="#f59e0b"
          trend="Pay-as-you-go"
          trendPositive={true}
        />
      </div>

      {/* Provider Fleet & Real-Time Sync Status Bar */}
      <ProviderFleetBar
        syncAudits={syncAudits}
        onRefreshSync={handleSync}
        isSyncing={isSyncing}
      />

      {isLoading && gpuPricing.length === 0 && (
        <div style={{ textAlign: 'center', padding: '30px', color: '#94a3b8', fontSize: '14px' }}>
          Loading real-time pricing intelligence from neocloud provider catalogs...
        </div>
      )}

      {/* Navigation Sub-Tabs */}
      <div
        style={{
          display: 'flex',
          borderBottom: '1px solid #1e293b',
          marginBottom: '20px',
          gap: '8px',
          overflowX: 'auto',
        }}
      >
        <button
          onClick={() => setActiveSubTab('gpus')}
          style={{
            padding: '12px 18px',
            backgroundColor: 'transparent',
            border: 'none',
            borderBottom: activeSubTab === 'gpus' ? '2px solid #3b82f6' : '2px solid transparent',
            color: activeSubTab === 'gpus' ? '#f8fafc' : '#94a3b8',
            fontWeight: 600,
            fontSize: '14px',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          GPU Availability &amp; Pricing ({gpuPricing.length})
        </button>
        <button
          onClick={() => setActiveSubTab('recommendations')}
          style={{
            padding: '12px 18px',
            backgroundColor: 'transparent',
            border: 'none',
            borderBottom: activeSubTab === 'recommendations' ? '2px solid #8b5cf6' : '2px solid transparent',
            color: activeSubTab === 'recommendations' ? '#f8fafc' : '#94a3b8',
            fontWeight: 600,
            fontSize: '14px',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          🎯 Purpose &amp; Model Studio
        </button>
        <button
          onClick={() => setActiveSubTab('vram_matrix')}
          style={{
            padding: '12px 18px',
            backgroundColor: 'transparent',
            border: 'none',
            borderBottom: activeSubTab === 'vram_matrix' ? '2px solid #06b6d4' : '2px solid transparent',
            color: activeSubTab === 'vram_matrix' ? '#f8fafc' : '#94a3b8',
            fontWeight: 600,
            fontSize: '14px',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          ⭐ Best Value &amp; VRAM Matrix
        </button>
        <button
          onClick={() => setActiveSubTab('models')}
          style={{
            padding: '12px 18px',
            backgroundColor: 'transparent',
            border: 'none',
            borderBottom: activeSubTab === 'models' ? '2px solid #3b82f6' : '2px solid transparent',
            color: activeSubTab === 'models' ? '#f8fafc' : '#94a3b8',
            fontWeight: 600,
            fontSize: '14px',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          Open Models &amp; Token Factory ({modelPricing.length})
        </button>
        <button
          onClick={() => setActiveSubTab('history')}
          style={{
            padding: '12px 18px',
            backgroundColor: 'transparent',
            border: 'none',
            borderBottom: activeSubTab === 'history' ? '2px solid #3b82f6' : '2px solid transparent',
            color: activeSubTab === 'history' ? '#f8fafc' : '#94a3b8',
            fontWeight: 600,
            fontSize: '14px',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          📈 Pricing History &amp; Fluctuations ({historySummaries.length})
        </button>
      </div>

      {/* Filter Bar */}
      <div
        style={{
          backgroundColor: '#0f172a',
          padding: '16px',
          borderRadius: '10px',
          border: '1px solid #1e293b',
          display: 'flex',
          gap: '16px',
          alignItems: 'center',
          flexWrap: 'wrap',
          marginBottom: '20px',
        }}
      >
        <div style={{ flex: '1 1 200px' }}>
          <input
            type="text"
            placeholder="Search GPU chip, model name, or provider..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: '100%',
              backgroundColor: '#1e293b',
              border: '1px solid #334155',
              borderRadius: '6px',
              padding: '8px 12px',
              color: '#f8fafc',
              fontSize: '13px',
              outline: 'none',
            }}
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <label style={{ color: '#94a3b8', fontSize: '13px', fontWeight: 500 }}>Provider:</label>
          <select
            value={selectedProvider}
            onChange={(e) => setSelectedProvider(e.target.value)}
            style={{
              backgroundColor: '#1e293b',
              color: '#f8fafc',
              border: '1px solid #334155',
              borderRadius: '6px',
              padding: '8px 12px',
              fontSize: '13px',
            }}
          >
            <option value="all">All Providers</option>
            <option value="runpod">RunPod</option>
            <option value="vast_ai">Vast.ai</option>
            <option value="baseten">Baseten</option>
            <option value="nebius">Nebius AI Studio</option>
            <option value="jarvislabs">JarvisLabs</option>
            <option value="coreweave">CoreWeave Forge</option>
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

        {activeSubTab === 'gpus' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <label style={{ color: '#94a3b8', fontSize: '13px', fontWeight: 500 }}>Pricing Model:</label>
            <select
              value={selectedPricingModel}
              onChange={(e) => setSelectedPricingModel(e.target.value)}
              style={{
                backgroundColor: '#1e293b',
                color: '#f8fafc',
                border: '1px solid #334155',
                borderRadius: '6px',
                padding: '8px 12px',
                fontSize: '13px',
              }}
            >
              <option value="all">All Models</option>
              <option value="on_demand">On-Demand</option>
              <option value="spot_bid">Spot / Preemptible</option>
              <option value="serverless">Serverless Micro-metered</option>
            </select>
          </div>
        )}

        {activeSubTab === 'models' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <label style={{ color: '#94a3b8', fontSize: '13px', fontWeight: 500 }}>Execution:</label>
            <select
              value={selectedExecutionType}
              onChange={(e) => setSelectedExecutionType(e.target.value)}
              style={{
                backgroundColor: '#1e293b',
                color: '#f8fafc',
                border: '1px solid #334155',
                borderRadius: '6px',
                padding: '8px 12px',
                fontSize: '13px',
              }}
            >
              <option value="all">All Execution Types</option>
              <option value="token_factory">Token Factory (MaaS)</option>
              <option value="serverless_endpoint">Serverless Container</option>
              <option value="pay_per_call">Pay-Per-Call Media</option>
            </select>
          </div>
        )}
      </div>

      {/* SUBTAB: Model Recommendation & Hardware Studio */}
      {activeSubTab === 'recommendations' && (
        <ModelRecommendationStudio
          gpuPricing={gpuPricing}
          modelPricing={modelPricing}
        />
      )}

      {/* TAB A: GPU Availability & Pricing */}
      {activeSubTab === 'gpus' && (
        <div
          style={{
            backgroundColor: '#0f172a',
            borderRadius: '12px',
            border: '1px solid #1e293b',
            overflow: 'hidden',
          }}
        >
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
              <thead>
                <tr style={{ backgroundColor: '#1e293b', borderBottom: '1px solid #334155' }}>
                  <SortableHeader
                    column="provider"
                    currentSortKey={gpuSortKey}
                    currentSortDir={gpuSortDir}
                    onSort={handleGpuSort}
                    style={{ padding: '14px 16px' }}
                  >
                    Provider
                  </SortableHeader>
                  <SortableHeader
                    column="hardwareDisplayName"
                    currentSortKey={gpuSortKey}
                    currentSortDir={gpuSortDir}
                    onSort={handleGpuSort}
                    style={{ padding: '14px 16px' }}
                  >
                    Hardware Chip
                  </SortableHeader>
                  <SortableHeader
                    column="vramGb"
                    currentSortKey={gpuSortKey}
                    currentSortDir={gpuSortDir}
                    onSort={handleGpuSort}
                    style={{ padding: '14px 16px' }}
                  >
                    VRAM
                  </SortableHeader>
                  <SortableHeader
                    column="hourlyPrice"
                    currentSortKey={gpuSortKey}
                    currentSortDir={gpuSortDir}
                    onSort={handleGpuSort}
                    style={{ padding: '14px 16px' }}
                  >
                    Price ($/hr)
                  </SortableHeader>
                  <SortableHeader
                    column="throughput"
                    currentSortKey={gpuSortKey}
                    currentSortDir={gpuSortDir}
                    onSort={handleGpuSort}
                    style={{ padding: '14px 16px', color: '#c084fc' }}
                  >
                    HW Throughput (8B Ref)
                  </SortableHeader>
                  <SortableHeader
                    column="costEfficiency"
                    currentSortKey={gpuSortKey}
                    currentSortDir={gpuSortDir}
                    onSort={handleGpuSort}
                    style={{ padding: '14px 16px', color: '#34d399' }}
                  >
                    Cost-Efficiency (Tokens / $)
                  </SortableHeader>
                  <SortableHeader
                    column="vramPrice"
                    currentSortKey={gpuSortKey}
                    currentSortDir={gpuSortDir}
                    onSort={handleGpuSort}
                    style={{ padding: '14px 16px', color: '#06b6d4' }}
                  >
                    Cost / GB VRAM
                  </SortableHeader>
                  <SortableHeader
                    column="pricingModel"
                    currentSortKey={gpuSortKey}
                    currentSortDir={gpuSortDir}
                    onSort={handleGpuSort}
                    style={{ padding: '14px 16px' }}
                  >
                    Pricing Model
                  </SortableHeader>
                  <SortableHeader
                    column="obtainabilityScore"
                    currentSortKey={gpuSortKey}
                    currentSortDir={gpuSortDir}
                    onSort={handleGpuSort}
                    style={{ padding: '14px 16px' }}
                  >
                    Availability &amp; Source
                  </SortableHeader>
                  <SortableHeader
                    column="interruptionRiskTier"
                    currentSortKey={gpuSortKey}
                    currentSortDir={gpuSortDir}
                    onSort={handleGpuSort}
                    style={{ padding: '14px 16px' }}
                  >
                    Risk Tier &amp; Policy
                  </SortableHeader>
                  <SortableHeader
                    column="commitment"
                    currentSortKey={gpuSortKey}
                    currentSortDir={gpuSortDir}
                    onSort={handleGpuSort}
                    style={{ padding: '14px 16px' }}
                  >
                    Commitment
                  </SortableHeader>
                </tr>
              </thead>
              <tbody>
                {sortedGpus.map((item, idx) => {
                  const vramRate = item.normalizedHourlyUsd / item.vramGb;
                  const isTopVramValue = vramRate <= 0.015;
                  const perf = getGpuPerformance(item);
                  const links = PROVIDER_CONSOLE_LINKS[item.provider.toLowerCase()] || {
                    capacityUrl: '#',
                    spotPolicyUrl: '#',
                  };

                  const isUltraValue = perf.tokensPerDollar >= 1_000_000;
                  const isTopEfficiency = !isUltraValue && perf.tokensPerDollar >= 800_000;
                  const isSweetSpot = !isUltraValue && !isTopEfficiency && perf.tokensPerDollar >= 500_000;
                  const isMaxThroughput = perf.tokensPerSec >= 180;

                  return (
                    <tr
                      key={item.id}
                      style={{
                        borderBottom: '1px solid #1e293b',
                        backgroundColor: idx % 2 === 0 ? 'transparent' : '#1e293b20',
                      }}
                    >
                      <td style={{ padding: '14px 16px', fontWeight: 600, color: '#f8fafc' }}>
                        <a
                          href={links.capacityUrl}
                          target={links.capacityUrl.startsWith('http') ? '_blank' : '_self'}
                          rel="noopener noreferrer"
                          title={`View ${item.provider.toUpperCase()} GPU console`}
                          style={{
                            backgroundColor: '#3b82f620',
                            color: '#60a5fa',
                            padding: '3px 8px',
                            borderRadius: '4px',
                            fontSize: '12px',
                            textDecoration: 'none',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '3px',
                          }}
                        >
                          {item.provider.toUpperCase()}
                          {links.capacityUrl.startsWith('http') && <span style={{ fontSize: '9px', opacity: 0.7 }}>↗</span>}
                        </a>
                      </td>
                      <td style={{ padding: '14px 16px', color: '#f1f5f9', fontWeight: 500 }}>
                        <div style={{ fontWeight: 600 }}>{item.hardwareDisplayName}</div>
                        <div style={{ fontSize: '11px', color: '#64748b' }}>{perf.architecture}</div>
                      </td>
                      <td style={{ padding: '14px 16px', color: '#94a3b8' }}>{item.vramGb} GB</td>
                      <td style={{ padding: '14px 16px', color: '#10b981', fontWeight: 700, fontSize: '14px' }}>
                        ${item.normalizedHourlyUsd.toFixed(3)}
                      </td>
                      {/* HW Performance in Tokens/sec */}
                      <td style={{ padding: '14px 16px' }}>
                        <div
                          title={perf.description}
                          style={{ cursor: 'help' }}
                        >
                          <div style={{ color: '#c084fc', fontWeight: 700, fontSize: '13px' }}>
                            {perf.tokensPerSec} tok/s
                          </div>
                          <div style={{ fontSize: '10px', color: '#94a3b8' }}>
                            FP16 / FP8 Tensor
                          </div>
                        </div>
                      </td>
                      {/* Cost-Efficiency: Tokens per Dollar & $/1M tokens */}
                      <td style={{ padding: '14px 16px' }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ color: '#34d399', fontWeight: 700, fontSize: '13px' }}>
                              {(perf.tokensPerDollar / 1000).toFixed(0)}K tok/$
                            </span>
                            {isUltraValue && (
                              <span
                                style={{
                                  backgroundColor: 'rgba(52, 211, 153, 0.15)',
                                  color: '#34d399',
                                  fontSize: '9px',
                                  padding: '1px 5px',
                                  borderRadius: '3px',
                                  fontWeight: 700,
                                }}
                              >
                                🚀 ULTRA VALUE
                              </span>
                            )}
                            {isTopEfficiency && (
                              <span
                                style={{
                                  backgroundColor: 'rgba(16, 185, 129, 0.15)',
                                  color: '#10b981',
                                  fontSize: '9px',
                                  padding: '1px 5px',
                                  borderRadius: '3px',
                                  fontWeight: 700,
                                }}
                              >
                                🏆 TOP EFFICIENCY
                              </span>
                            )}
                            {isSweetSpot && (
                              <span
                                style={{
                                  backgroundColor: 'rgba(56, 189, 248, 0.15)',
                                  color: '#38bdf8',
                                  fontSize: '9px',
                                  padding: '1px 5px',
                                  borderRadius: '3px',
                                  fontWeight: 700,
                                }}
                              >
                                ⚡ SWEET SPOT
                              </span>
                            )}
                            {isMaxThroughput && !isUltraValue && !isTopEfficiency && (
                              <span
                                style={{
                                  backgroundColor: 'rgba(239, 68, 68, 0.15)',
                                  color: '#f87171',
                                  fontSize: '9px',
                                  padding: '1px 5px',
                                  borderRadius: '3px',
                                  fontWeight: 700,
                                }}
                              >
                                🔥 MAX SPEED
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                            ${perf.costPerMillion.toFixed(2)} / 1M tokens
                          </div>
                        </div>
                      </td>
                      <td style={{ padding: '14px 16px', color: '#06b6d4', fontWeight: 600 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span>${vramRate.toFixed(4)}/GB</span>
                          {isTopVramValue && (
                            <span
                              style={{
                                backgroundColor: '#06b6d420',
                                color: '#06b6d4',
                                fontSize: '10px',
                                padding: '1px 5px',
                                borderRadius: '3px',
                                fontWeight: 700,
                              }}
                            >
                              TOP VALUE
                            </span>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: '14px 16px' }}>
                        <span
                          style={{
                            color:
                              item.pricingModel === 'spot_bid'
                                ? '#34d399'
                                : item.pricingModel === 'serverless'
                                  ? '#a78bfa'
                                  : '#38bdf8',
                            fontWeight: 600,
                            fontSize: '12px',
                          }}
                        >
                          {item.pricingModel.replace('_', ' ').toUpperCase()}
                        </span>
                      </td>
                      {/* Availability Score with Tooltip and Capacity Link */}
                      <td style={{ padding: '14px 16px' }}>
                        <a
                          href={links.capacityUrl}
                          target={links.capacityUrl.startsWith('http') ? '_blank' : '_self'}
                          rel="noopener noreferrer"
                          title={`Availability Calculation: Obtainability Score = (Available Instances / Total Capacity Pool) × (1 - Queue Saturation). ${(item.obtainabilityScore * 100).toFixed(0)}% instant placement probability in ${item.zone}. Click to inspect live capacity.`}
                          style={{
                            backgroundColor:
                              item.obtainabilityLabel === 'High'
                                ? '#10b98120'
                                : item.obtainabilityLabel === 'Medium'
                                  ? '#f59e0b20'
                                  : '#ef444420',
                            color:
                              item.obtainabilityLabel === 'High'
                                ? '#34d399'
                                : item.obtainabilityLabel === 'Medium'
                                  ? '#fbbf24'
                                  : '#f87171',
                            padding: '2px 8px',
                            borderRadius: '4px',
                            fontSize: '12px',
                            fontWeight: 600,
                            textDecoration: 'none',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            cursor: 'pointer',
                          }}
                        >
                          {item.obtainabilityLabel} ({(item.obtainabilityScore * 100).toFixed(0)}%)
                          <span style={{ fontSize: '9px', opacity: 0.8 }}>↗</span>
                        </a>
                      </td>
                      {/* Risk Tier with Tooltip and Spot Policy Link */}
                      <td style={{ padding: '14px 16px', fontSize: '12px' }}>
                        <a
                          href={links.spotPolicyUrl}
                          target={links.spotPolicyUrl.startsWith('http') ? '_blank' : '_self'}
                          rel="noopener noreferrer"
                          title={`Interruption Risk Profile: ${item.interruptionRiskTier} based on 30-day preemption frequency. Click to inspect provider spot eviction policy & notice window.`}
                          style={{
                            color: item.interruptionRiskTier === 'guaranteed' ? '#38bdf8' : '#f59e0b',
                            fontWeight: 600,
                            textDecoration: 'none',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            borderBottom: '1px dotted currentColor',
                          }}
                        >
                          {item.interruptionRiskTier}
                          <span style={{ fontSize: '9px', opacity: 0.8 }}>↗</span>
                        </a>
                      </td>
                      <td style={{ padding: '14px 16px', color: '#64748b', fontSize: '12px' }}>
                        {item.commitment}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB B: Best Value & VRAM Matrix */}
      {activeSubTab === 'vram_matrix' && (
        <div>
          {/* VRAM Tiers Cards */}
          <div style={{ marginBottom: '32px' }}>
            <h3 style={{ color: '#f8fafc', fontSize: '16px', fontWeight: 600, marginBottom: '6px' }}>
              Best Price per VRAM Capacity Tier ($/hr & $/GB-hr)
            </h3>
            <p style={{ color: '#94a3b8', fontSize: '13px', marginBottom: '16px', marginTop: 0 }}>
              Workloads requiring specific memory budgets (16GB, 24GB, 32GB, 80GB) mapped to the cheapest verified provider.
            </p>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                gap: '16px',
              }}
            >
              {vramTierMatrix.map((tier) => (
                <div
                  key={tier.label}
                  style={{
                    backgroundColor: '#0f172a',
                    border: '1px solid #1e293b',
                    borderRadius: '12px',
                    padding: '20px',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '16px', fontWeight: 700, color: '#f8fafc' }}>
                        {tier.label}
                      </span>
                      <span
                        style={{
                          backgroundColor: '#06b6d420',
                          color: '#06b6d4',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          fontSize: '11px',
                          fontWeight: 600,
                        }}
                      >
                        {tier.totalOptions} Options
                      </span>
                    </div>
                    <p style={{ color: '#64748b', fontSize: '12px', marginTop: '4px', marginBottom: '16px' }}>
                      {tier.desc}
                    </p>

                    {/* Best Spot Deal */}
                    <div
                      style={{
                        backgroundColor: '#1e293b',
                        borderRadius: '8px',
                        padding: '12px',
                        marginBottom: '10px',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                        <span style={{ color: '#10b981', fontSize: '11px', fontWeight: 700 }}>
                          BEST SPOT / PREEMPTIBLE
                        </span>
                        {tier.bestSpot && (
                          <span style={{ color: '#34d399', fontSize: '13px', fontWeight: 700 }}>
                            ${tier.bestSpot.normalizedHourlyUsd.toFixed(3)}/hr
                          </span>
                        )}
                      </div>
                      {tier.bestSpot ? (
                        <div>
                          <div style={{ color: '#f8fafc', fontWeight: 600, fontSize: '13px' }}>
                            {tier.bestSpot.hardwareDisplayName} ({tier.bestSpot.provider.toUpperCase()})
                          </div>
                          <div style={{ color: '#06b6d4', fontSize: '11px', marginTop: '2px' }}>
                            ${(tier.bestSpot.normalizedHourlyUsd / tier.bestSpot.vramGb).toFixed(4)} / GB-hr • Risk: {tier.bestSpot.interruptionRiskTier}
                          </div>
                        </div>
                      ) : (
                        <span style={{ color: '#64748b', fontSize: '12px' }}>No spot offers available</span>
                      )}
                    </div>

                    {/* Best On-Demand Deal */}
                    <div
                      style={{
                        backgroundColor: '#1e293b',
                        borderRadius: '8px',
                        padding: '12px',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                        <span style={{ color: '#38bdf8', fontSize: '11px', fontWeight: 700 }}>
                          BEST ON-DEMAND ($0 COMMIT)
                        </span>
                        {tier.bestOnDemand && (
                          <span style={{ color: '#60a5fa', fontSize: '13px', fontWeight: 700 }}>
                            ${tier.bestOnDemand.normalizedHourlyUsd.toFixed(2)}/hr
                          </span>
                        )}
                      </div>
                      {tier.bestOnDemand ? (
                        <div>
                          <div style={{ color: '#f8fafc', fontWeight: 600, fontSize: '13px' }}>
                            {tier.bestOnDemand.hardwareDisplayName} ({tier.bestOnDemand.provider.toUpperCase()})
                          </div>
                          <div style={{ color: '#94a3b8', fontSize: '11px', marginTop: '2px' }}>
                            ${(tier.bestOnDemand.normalizedHourlyUsd / tier.bestOnDemand.vramGb).toFixed(4)} / GB-hr • Availability: {tier.bestOnDemand.obtainabilityLabel}
                          </div>
                        </div>
                      ) : (
                        <span style={{ color: '#64748b', fontSize: '12px' }}>No on-demand offers</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Open Model Best Deals Comparison Table */}
          <div style={{ marginBottom: '32px' }}>
            <h3 style={{ color: '#f8fafc', fontSize: '16px', fontWeight: 600, marginBottom: '6px' }}>
              Best Price per Open Model Across Providers
            </h3>
            <p style={{ color: '#94a3b8', fontSize: '13px', marginBottom: '16px', marginTop: 0 }}>
              Identifies the lowest cost provider for each open model family (Token Factory MaaS vs Serverless vs Pay-Per-Call).
            </p>
            <div
              style={{
                backgroundColor: '#0f172a',
                borderRadius: '12px',
                border: '1px solid #1e293b',
                overflow: 'hidden',
              }}
            >
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#1e293b', borderBottom: '1px solid #334155' }}>
                      <th style={{ padding: '14px 16px', color: '#94a3b8', fontWeight: 600 }}>Model Name</th>
                      <th style={{ padding: '14px 16px', color: '#94a3b8', fontWeight: 600 }}>Developer</th>
                      <th style={{ padding: '14px 16px', color: '#94a3b8', fontWeight: 600 }}>Cheapest Provider</th>
                      <th style={{ padding: '14px 16px', color: '#94a3b8', fontWeight: 600 }}>Execution Modality</th>
                      <th style={{ padding: '14px 16px', color: '#10b981', fontWeight: 600 }}>Best Input Rate</th>
                      <th style={{ padding: '14px 16px', color: '#60a5fa', fontWeight: 600 }}>Output Rate</th>
                      <th style={{ padding: '14px 16px', color: '#94a3b8', fontWeight: 600 }}>Cached Discount</th>
                      <th style={{ padding: '14px 16px', color: '#94a3b8', fontWeight: 600 }}>Options Count</th>
                    </tr>
                  </thead>
                  <tbody>
                    {openModelBestDeals.map((deal, idx) => (
                      <tr
                        key={deal.modelName}
                        style={{
                          borderBottom: '1px solid #1e293b',
                          backgroundColor: idx % 2 === 0 ? 'transparent' : '#1e293b20',
                        }}
                      >
                        <td style={{ padding: '14px 16px', color: '#f8fafc', fontWeight: 600 }}>
                          {deal.modelName}
                        </td>
                        <td style={{ padding: '14px 16px', color: '#cbd5e1' }}>{deal.developer}</td>
                        <td style={{ padding: '14px 16px' }}>
                          <span
                            style={{
                              backgroundColor: '#10b98120',
                              color: '#34d399',
                              padding: '3px 8px',
                              borderRadius: '4px',
                              fontSize: '12px',
                              fontWeight: 700,
                            }}
                          >
                            {deal.bestOption.provider.toUpperCase()}
                          </span>
                        </td>
                        <td style={{ padding: '14px 16px', color: '#cbd5e1', fontSize: '12px' }}>
                          {deal.bestOption.executionType.replace('_', ' ').toUpperCase()}
                        </td>
                        <td style={{ padding: '14px 16px', color: '#10b981', fontWeight: 700 }}>
                          {deal.bestOption.inputPricePerMillionUsd !== undefined
                            ? `$${deal.bestOption.inputPricePerMillionUsd.toFixed(2)} / 1M`
                            : deal.bestOption.perUnitUsd !== undefined
                              ? `$${deal.bestOption.perUnitUsd} / ${deal.bestOption.unitType}`
                              : '--'}
                        </td>
                        <td style={{ padding: '14px 16px', color: '#60a5fa', fontWeight: 600 }}>
                          {deal.bestOption.outputPricePerMillionUsd !== undefined
                            ? `$${deal.bestOption.outputPricePerMillionUsd.toFixed(2)} / 1M`
                            : '--'}
                        </td>
                        <td style={{ padding: '14px 16px', color: '#94a3b8', fontSize: '12px' }}>
                          {deal.bestOption.cachedPricePerMillionUsd !== undefined
                            ? `$${deal.bestOption.cachedPricePerMillionUsd.toFixed(3)} / 1M`
                            : '--'}
                        </td>
                        <td style={{ padding: '14px 16px', color: '#64748b', fontSize: '12px' }}>
                          {deal.totalProviders} Provider{deal.totalProviders > 1 ? 's' : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB C: Open Models & Token Factory */}
      {activeSubTab === 'models' && (
        <div
          style={{
            backgroundColor: '#0f172a',
            borderRadius: '12px',
            border: '1px solid #1e293b',
            overflow: 'hidden',
          }}
        >
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
              <thead>
                <tr style={{ backgroundColor: '#1e293b', borderBottom: '1px solid #334155' }}>
                  <SortableHeader
                    column="provider"
                    currentSortKey={modelSortKey}
                    currentSortDir={modelSortDir}
                    onSort={handleModelSort}
                    style={{ padding: '14px 16px' }}
                  >
                    Provider
                  </SortableHeader>
                  <SortableHeader
                    column="modelName"
                    currentSortKey={modelSortKey}
                    currentSortDir={modelSortDir}
                    onSort={handleModelSort}
                    style={{ padding: '14px 16px' }}
                  >
                    Model ID &amp; Name
                  </SortableHeader>
                  <SortableHeader
                    column="developer"
                    currentSortKey={modelSortKey}
                    currentSortDir={modelSortDir}
                    onSort={handleModelSort}
                    style={{ padding: '14px 16px' }}
                  >
                    Developer
                  </SortableHeader>
                  <SortableHeader
                    column="executionType"
                    currentSortKey={modelSortKey}
                    currentSortDir={modelSortDir}
                    onSort={handleModelSort}
                    style={{ padding: '14px 16px' }}
                  >
                    Execution Type
                  </SortableHeader>
                  <SortableHeader
                    column="inputPrice"
                    currentSortKey={modelSortKey}
                    currentSortDir={modelSortDir}
                    onSort={handleModelSort}
                    style={{ padding: '14px 16px', color: '#10b981' }}
                  >
                    Input Rate
                  </SortableHeader>
                  <SortableHeader
                    column="outputPrice"
                    currentSortKey={modelSortKey}
                    currentSortDir={modelSortDir}
                    onSort={handleModelSort}
                    style={{ padding: '14px 16px', color: '#60a5fa' }}
                  >
                    Output Rate
                  </SortableHeader>
                  <SortableHeader
                    column="cachedPrice"
                    currentSortKey={modelSortKey}
                    currentSortDir={modelSortDir}
                    onSort={handleModelSort}
                    style={{ padding: '14px 16px' }}
                  >
                    Cached Input
                  </SortableHeader>
                  <SortableHeader
                    column="contextLength"
                    currentSortKey={modelSortKey}
                    currentSortDir={modelSortDir}
                    onSort={handleModelSort}
                    style={{ padding: '14px 16px' }}
                  >
                    Context Window
                  </SortableHeader>
                  <th style={{ padding: '14px 16px', color: '#94a3b8', fontWeight: 600 }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {sortedModels.map((item, idx) => (
                  <tr
                    key={item.id}
                    style={{
                      borderBottom: '1px solid #1e293b',
                      backgroundColor: idx % 2 === 0 ? 'transparent' : '#1e293b20',
                    }}
                  >
                    <td style={{ padding: '14px 16px', fontWeight: 600 }}>
                      <span
                        style={{
                          backgroundColor: '#8b5cf620',
                          color: '#a78bfa',
                          padding: '3px 8px',
                          borderRadius: '4px',
                          fontSize: '12px',
                        }}
                      >
                        {item.provider.toUpperCase()}
                      </span>
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      <div style={{ color: '#f8fafc', fontWeight: 600 }}>{item.modelName}</div>
                      <div style={{ color: '#64748b', fontSize: '11px', fontFamily: 'monospace' }}>
                        {item.modelId}
                      </div>
                    </td>
                    <td style={{ padding: '14px 16px', color: '#cbd5e1' }}>{item.developer}</td>
                    <td style={{ padding: '14px 16px' }}>
                      <span
                        style={{
                          color: item.executionType === 'token_factory' ? '#38bdf8' : '#fb923c',
                          fontWeight: 500,
                          fontSize: '12px',
                        }}
                      >
                        {item.executionType.replace('_', ' ').toUpperCase()}
                      </span>
                    </td>
                    <td style={{ padding: '14px 16px', color: '#10b981', fontWeight: 600 }}>
                      {item.inputPricePerMillionUsd !== undefined
                        ? `$${item.inputPricePerMillionUsd.toFixed(2)} / 1M`
                        : item.perUnitUsd !== undefined
                          ? `$${item.perUnitUsd} / ${item.unitType}`
                          : '--'}
                    </td>
                    <td style={{ padding: '14px 16px', color: '#60a5fa', fontWeight: 600 }}>
                      {item.outputPricePerMillionUsd !== undefined
                        ? `$${item.outputPricePerMillionUsd.toFixed(2)} / 1M`
                        : '--'}
                    </td>
                    <td style={{ padding: '14px 16px', color: '#94a3b8', fontSize: '12px' }}>
                      {item.cachedPricePerMillionUsd !== undefined
                        ? `$${item.cachedPricePerMillionUsd.toFixed(3)} / 1M`
                        : '--'}
                    </td>
                    <td style={{ padding: '14px 16px', color: '#cbd5e1', fontSize: '12px' }}>
                      {item.contextLength
                        ? `${(item.contextLength / 1024).toFixed(0)}k tokens`
                        : 'Fixed'}
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      <StatusBadge status={item.isAvailable ? 'healthy' : 'degraded'} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB D: Pricing History & Update Cadence */}
      {activeSubTab === 'history' && (
        <div>
          {/* Interactive Historical Price SVG Line Chart */}
          <HistoricalPriceChart summaries={historySummaries} />

          {/* Provider Update Frequency Cards */}
          <div style={{ marginBottom: '24px' }}>
            <h3 style={{ color: '#f8fafc', fontSize: '16px', fontWeight: 600, marginBottom: '12px' }}>
              Provider Pricing Update Cadence &amp; Telemetry
            </h3>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                gap: '16px',
              }}
            >
              {syncAudits.map((audit) => (
                <div
                  key={audit.id}
                  style={{
                    backgroundColor: '#0f172a',
                    border: '1px solid #1e293b',
                    borderRadius: '10px',
                    padding: '16px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span
                      style={{
                        backgroundColor: '#3b82f620',
                        color: '#60a5fa',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        fontSize: '12px',
                        fontWeight: 700,
                      }}
                    >
                      {audit.provider.toUpperCase()}
                    </span>
                    <span
                      style={{
                        color:
                          audit.updateCadenceCategory === 'realtime_auction'
                            ? '#34d399'
                            : audit.updateCadenceCategory === 'dynamic_shifts'
                              ? '#38bdf8'
                              : '#a78bfa',
                        fontSize: '11px',
                        fontWeight: 600,
                      }}
                    >
                      {audit.updateCadenceCategory.replace('_', ' ').toUpperCase()}
                    </span>
                  </div>
                  <div style={{ marginTop: '12px', color: '#f8fafc', fontSize: '13px', fontWeight: 600 }}>
                    {audit.updateFrequencyDescription}
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      marginTop: '8px',
                      color: '#64748b',
                      fontSize: '12px',
                    }}
                  >
                    <span>Expected Interval: ~{(audit.estimatedUpdateIntervalSec / 60).toFixed(0)} mins</span>
                    <span>Records: {audit.recordsCount}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
