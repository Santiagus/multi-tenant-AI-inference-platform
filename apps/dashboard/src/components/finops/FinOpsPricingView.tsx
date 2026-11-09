import { useState, useEffect } from 'react';
import { apiClient } from '../../api/client';
import type {
  GpuPricingItem,
  ModelPricingItem,
  PricingHistorySummary,
  PricingSyncAudit,
} from '../../types';
import { ModelComputeAdvisor } from './ModelComputeAdvisor';
import { SyncTracesModal } from './SyncTracesModal';

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
    capacityUrl: 'https://id.coreweave.com/login?utm_source=coreweave.com&utm_medium=site',
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
 * Vendor prefixes ("NVIDIA", "NVIDIA RTX", "GeForce") are stripped for clean visualization.
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
      .replace(/^NVIDIA\s+GeForce\s+RTX\s+/i, '')
      .replace(/^NVIDIA\s+RTX\s+/i, '')
      .replace(/^NVIDIA\s+GeForce\s+/i, '')
      .replace(/^NVIDIA\s+/i, '')
      .replace(/\bRTX\s+/i, '')
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

interface FinOpsPricingViewProps {
  onNavigateToProviderStatus?: () => void;
}

export function FinOpsPricingView({}: FinOpsPricingViewProps = {}) {
  const [gpuPricing, setGpuPricing] = useState<GpuPricingItem[]>([]);
  const [modelPricing, setModelPricing] = useState<ModelPricingItem[]>([]);
  const [historySummaries, setHistorySummaries] = useState<PricingHistorySummary[]>([]);
  const [syncAudits, setSyncAudits] = useState<PricingSyncAudit[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [showTracesModal, setShowTracesModal] = useState(false);
  const [syncMessage, setSyncMessage] = useState<{ text: string; isError?: boolean } | null>(null);

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
      if (histRes.cadence_audits) {
        setSyncAudits(histRes.cadence_audits);
      }
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
      if (res.failedProviders && res.failedProviders.length > 0) {
        setSyncMessage({
          text: `Synced ${res.syncedProviders.length} providers · ⚠️ ${res.failedProviders.length} failed (${res.failedProviders.map((p) => p.provider).join(', ')})`,
          isError: true,
        });
      } else {
        setSyncMessage({
          text: `Synchronized ${res.recordsCount} records across ${res.syncedProviders.length} providers.`,
        });
      }
      if (res.auditRecords) {
        setSyncAudits(res.auditRecords);
      }
      await loadData();
    } catch (err) {
      setSyncMessage({ text: 'Failed to trigger pricing catalog sync.', isError: true });
    } finally {
      setIsSyncing(false);
      setTimeout(() => setSyncMessage(null), 7000);
    }
  };

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
          alignItems: 'center',
          marginBottom: '16px',
          flexWrap: 'nowrap',
          gap: '16px',
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
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
                whiteSpace: 'nowrap',
              }}
            >
              Real-Time Cross-Cloud Intelligence
            </span>
          </div>
          <p style={{ color: '#94a3b8', fontSize: '13px', marginTop: '4px', margin: 0 }}>
            Unified catalog across 14 providers: live GPU spot auctions, on-demand hardware, Token Factory MaaS &amp; serverless rates.
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px', flexShrink: 0 }}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button
              onClick={() => setShowTracesModal(true)}
              style={{
                backgroundColor: '#1e293b',
                color: '#38bdf8',
                border: '1px solid #334155',
                borderRadius: '6px',
                padding: '8px 12px',
                fontWeight: 600,
                fontSize: '12px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                whiteSpace: 'nowrap',
              }}
            >
              📋 View Sync Traces
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
                whiteSpace: 'nowrap',
              }}
            >
              {isSyncing ? 'Syncing...' : '↻ Refresh Catalogs'}
            </button>
          </div>
          {syncMessage && (
            <span
              style={{
                color: syncMessage.isError ? '#f87171' : '#10b981',
                fontSize: '11px',
                fontWeight: 500,
                whiteSpace: 'nowrap',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              {syncMessage.isError ? '⚠️' : '✓'} {syncMessage.text}
            </span>
          )}
        </div>
      </div>

      {isLoading ? (
        <div style={{ padding: '40px', textAlign: 'center', color: '#94a3b8', fontSize: '14px' }}>
          Loading real-time hardware benchmarks and catalog rates...
        </div>
      ) : (
        <ModelComputeAdvisor
          gpuPricing={gpuPricing}
          modelPricing={modelPricing}
          baseTokensPerSec={(g) => getGpuPerformance(g).tokensPerSec}
          history={historySummaries}
        />
      )}

      {/* Sync Traces Modal Popup */}
      <SyncTracesModal
        isOpen={showTracesModal}
        onClose={() => setShowTracesModal(false)}
        syncAudits={syncAudits}
        onRetrySync={handleSync}
        isSyncing={isSyncing}
      />
    </div>
  );
}
