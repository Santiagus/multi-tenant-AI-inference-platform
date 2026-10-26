import { useState, useMemo } from 'react';
import { StatusBadge } from '../common/Badge';
import { SortableHeader, genericSort, type SortDirection } from '../common/SortableHeader';
import type { JobItem, ProviderProfile } from '../../types';

interface ProvidersViewProps {
  providers: Record<string, ProviderProfile>;
  jobs?: JobItem[];
  isLoading: boolean;
  onToggleHealth: (provider: string, healthy: boolean) => Promise<void>;
}

const CURATED_MODELS = [
  {
    id: 'meta-llama/Llama-3-8B-Instruct',
    name: 'Llama 3 8B Instruct',
    modality: 'text_to_text',
    minVramMb: 8192,
    latencyTier: 'Fast (150-300ms)',
    defaultProvider: 'local_pytorch',
    pricingTier: 'Standard',
  },
  {
    id: 'TinyLlama/TinyLlama-1.1B-Chat-v1.0',
    name: 'TinyLlama 1.1B Chat',
    modality: 'text_to_text',
    minVramMb: 2048,
    latencyTier: 'Ultra-Fast (<80ms)',
    defaultProvider: 'local_pytorch',
    pricingTier: 'Free/Low',
  },
  {
    id: 'mistralai/Mistral-7B-Instruct-v0.2',
    name: 'Mistral 7B Instruct v0.2',
    modality: 'text_to_text',
    minVramMb: 7680,
    latencyTier: 'Fast (180-350ms)',
    defaultProvider: 'local_pytorch',
    pricingTier: 'Standard',
  },
  {
    id: 'anthropic/claude-3-haiku',
    name: 'Claude 3 Haiku',
    modality: 'text_to_text',
    minVramMb: 0,
    latencyTier: 'Managed API (400ms)',
    defaultProvider: 'bedrock',
    pricingTier: 'Proprietary API',
  },
  {
    id: 'runwayml/stable-diffusion-v1-5',
    name: 'Stable Diffusion v1.5',
    modality: 'text_to_image',
    minVramMb: 6144,
    latencyTier: 'Batch (1.2s - 2.5s)',
    defaultProvider: 'local_pytorch',
    pricingTier: 'Standard',
  },
  {
    id: 'stabilityai/stable-diffusion-xl-base-1.0',
    name: 'SDXL Base 1.0',
    modality: 'text_to_image',
    minVramMb: 12288,
    latencyTier: 'High VRAM (3.0s - 6.0s)',
    defaultProvider: 'runpod',
    pricingTier: 'Premium Cloud',
  },
  {
    id: 'openai/whisper-large-v3',
    name: 'Whisper Large v3',
    modality: 'speech_to_text',
    minVramMb: 4096,
    latencyTier: 'Medium (500ms - 1.5s)',
    defaultProvider: 'local_pytorch',
    pricingTier: 'Standard',
  },
  {
    id: 'openai/whisper-tiny',
    name: 'Whisper Tiny',
    modality: 'speech_to_text',
    minVramMb: 1024,
    latencyTier: 'Realtime (<100ms)',
    defaultProvider: 'local_pytorch',
    pricingTier: 'Free/Low',
  },
  {
    id: 'THUDM/CogVideoX-2b',
    name: 'CogVideoX 2B',
    modality: 'text_to_video',
    minVramMb: 18432,
    latencyTier: 'Heavy DAG (15s - 45s)',
    defaultProvider: 'runpod',
    pricingTier: 'Heavy GPU',
  },
];

export function ProvidersView({ providers, jobs = [], isLoading, onToggleHealth }: ProvidersViewProps) {
  const [togglingProvider, setTogglingProvider] = useState<string | null>(null);
  const [modelSortKey, setModelSortKey] = useState<string>('name');
  const [modelSortDir, setModelSortDir] = useState<SortDirection>('asc');

  const handleModelSort = (col: string) => {
    if (modelSortKey === col) {
      setModelSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setModelSortKey(col);
      setModelSortDir(col === 'minVramMb' || col === 'liveCount' ? 'desc' : 'asc');
    }
  };

  const modelStatsMap = useMemo(() => {
    const stats: Record<string, { count: number; totalDurationMs: number; okCount: number }> = {};
    for (const j of jobs) {
      if (!stats[j.model_id]) {
        stats[j.model_id] = { count: 0, totalDurationMs: 0, okCount: 0 };
      }
      stats[j.model_id].count++;
      if (j.status === 'SUCCEEDED') stats[j.model_id].okCount++;
      if (j.duration_ms) stats[j.model_id].totalDurationMs += j.duration_ms;
    }
    return stats;
  }, [jobs]);

  const sortedCuratedModels = useMemo(() => {
    return genericSort(CURATED_MODELS, modelSortKey, modelSortDir, (item, key) => {
      if (key === 'liveCount') {
        const live = modelStatsMap[item.id];
        return live?.count ?? 0;
      }
      return (item as Record<string, unknown>)[key];
    });
  }, [modelSortKey, modelSortDir, modelStatsMap]);

  const handleToggle = async (name: string, currentHealth: boolean) => {
    setTogglingProvider(name);
    try {
      await onToggleHealth(name, !currentHealth);
    } finally {
      setTogglingProvider(null);
    }
  };

  const providerList = Object.entries(providers);

  return (
    <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Overview Header */}
      <div>
        <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#f8fafc', margin: 0 }}>
          Inference Providers &amp; Hardware Tier Catalog
        </h2>
        <p style={{ fontSize: '13px', color: '#94a3b8', margin: '4px 0 0 0' }}>
          Multi-provider compute placement engine. Toggle provider health to test real-time failover and SLO spillover routing.
        </p>
      </div>

      {/* Provider Cards Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
        {providerList.map(([name, prof]) => {
          const isToggling = togglingProvider === name;
          const costPer1k = ((prof.costMicrocentsPerToken || prof.cost_per_token_microcents || 0) * 1000) / 100_000_000;

          let hardwareDesc = 'Cloud Inference API';
          let badgeColor = '#6366f1';
          if (name === 'local_pytorch') {
            hardwareDesc = 'Local NVIDIA RTX 5070 Ti (16GB GDDR7)';
            badgeColor = '#10b981';
          } else if (name === 'runpod') {
            hardwareDesc = 'RunPod Serverless GPU Worker (24GB VRAM)';
            badgeColor = '#8b5cf6';
          } else if (name === 'bedrock') {
            hardwareDesc = 'AWS Bedrock Managed Anthropic Claude 3';
            badgeColor = '#f59e0b';
          } else if (name === 'sagemaker') {
            hardwareDesc = 'AWS SageMaker Private VPC Endpoint';
            badgeColor = '#06b6d4';
          }

          return (
            <div
              key={name}
              style={{
                backgroundColor: '#0f172a',
                borderRadius: '12px',
                border: '1px solid #1e293b',
                padding: '20px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                position: 'relative',
              }}
            >
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span
                      style={{
                        width: '10px',
                        height: '10px',
                        borderRadius: '50%',
                        backgroundColor: badgeColor,
                      }}
                    />
                    <h3 style={{ fontSize: '15px', fontWeight: 700, color: '#f8fafc', margin: 0, textTransform: 'capitalize' }}>
                      {name.replace('_', ' ')}
                    </h3>
                  </div>
                  <StatusBadge status={prof.healthy ? 'HEALTHY' : 'UNHEALTHY'} size="sm" />
                </div>

                <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '14px' }}>
                  {hardwareDesc}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '12px', color: '#64748b' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Marginal Token Cost:</span>
                    <strong style={{ color: costPer1k === 0 ? '#10b981' : '#f8fafc' }}>
                      {costPer1k === 0 ? '$0.00 / 1k (Zero Marginal)' : `$${costPer1k.toFixed(4)} / 1k tok`}
                    </strong>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>VRAM Capacity:</span>
                    <strong style={{ color: '#f8fafc' }}>
                      {prof.vramTotalMb ? `${prof.vramTotalMb.toLocaleString()} MB` : 'Serverless Managed'}
                    </strong>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>VPC Isolation:</span>
                    <strong style={{ color: prof.supportsVpc ? '#34d399' : '#94a3b8' }}>
                      {prof.supportsVpc ? 'Yes (Private VPC)' : 'Public Cloud / Local'}
                    </strong>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Mode:</span>
                    <strong style={{ color: prof.mockMode ? '#fbbf24' : '#34d399' }}>
                      {prof.mockMode ? 'Mock Emulation' : 'Live Worker'}
                    </strong>
                  </div>
                </div>
              </div>

              <div style={{ marginTop: '20px', paddingTop: '14px', borderTop: '1px solid #1e293b' }}>
                <button
                  onClick={() => handleToggle(name, prof.healthy)}
                  disabled={isToggling || isLoading}
                  style={{
                    width: '100%',
                    backgroundColor: prof.healthy ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.15)',
                    color: prof.healthy ? '#f87171' : '#34d399',
                    border: `1px solid ${prof.healthy ? 'rgba(239, 68, 68, 0.4)' : 'rgba(16, 185, 129, 0.4)'}`,
                    padding: '8px 12px',
                    borderRadius: '8px',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: isToggling ? 'wait' : 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {isToggling
                    ? 'Updating Health...'
                    : prof.healthy
                      ? 'Simulate Outage (Mark Unhealthy)'
                      : 'Restore Health (Mark Healthy)'}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Model Catalog Section */}
      <div
        style={{
          backgroundColor: '#0f172a',
          borderRadius: '12px',
          border: '1px solid #1e293b',
          overflow: 'hidden',
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
        }}
      >
        <div style={{ padding: '18px 20px', borderBottom: '1px solid #1e293b' }}>
          <h3 style={{ fontSize: '15px', fontWeight: 700, color: '#f8fafc', margin: 0 }}>
            Curated Domain Model Registry
          </h3>
          <p style={{ fontSize: '12px', color: '#64748b', margin: '4px 0 0 0' }}>
            Domain-organized models mapped to optimal compute tiers and VRAM constraints.
          </p>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
            <thead>
              <tr style={{ backgroundColor: '#1e293b', borderBottom: '1px solid #334155', color: '#94a3b8' }}>
                <SortableHeader
                  column="name"
                  currentSortKey={modelSortKey}
                  currentSortDir={modelSortDir}
                  onSort={handleModelSort}
                  style={{ padding: '12px 16px' }}
                >
                  Model Name &amp; ID
                </SortableHeader>
                <SortableHeader
                  column="modality"
                  currentSortKey={modelSortKey}
                  currentSortDir={modelSortDir}
                  onSort={handleModelSort}
                  style={{ padding: '12px 16px' }}
                >
                  Modality
                </SortableHeader>
                <SortableHeader
                  column="minVramMb"
                  currentSortKey={modelSortKey}
                  currentSortDir={modelSortDir}
                  onSort={handleModelSort}
                  style={{ padding: '12px 16px' }}
                >
                  Min VRAM
                </SortableHeader>
                <SortableHeader
                  column="latencyTier"
                  currentSortKey={modelSortKey}
                  currentSortDir={modelSortDir}
                  onSort={handleModelSort}
                  style={{ padding: '12px 16px' }}
                >
                  Latency Expectation
                </SortableHeader>
                <SortableHeader
                  column="defaultProvider"
                  currentSortKey={modelSortKey}
                  currentSortDir={modelSortDir}
                  onSort={handleModelSort}
                  style={{ padding: '12px 16px' }}
                >
                  Optimal Placement
                </SortableHeader>
                <SortableHeader
                  column="pricingTier"
                  currentSortKey={modelSortKey}
                  currentSortDir={modelSortDir}
                  onSort={handleModelSort}
                  style={{ padding: '12px 16px' }}
                >
                  Pricing Tier
                </SortableHeader>
                <SortableHeader
                  column="liveCount"
                  currentSortKey={modelSortKey}
                  currentSortDir={modelSortDir}
                  onSort={handleModelSort}
                  style={{ padding: '12px 16px' }}
                >
                  Live Telemetry (Inferences / Latency)
                </SortableHeader>
              </tr>
            </thead>
            <tbody>
              {sortedCuratedModels.map((m) => {
                const live = modelStatsMap[m.id];
                const avgMs = live && live.count > 0 ? Math.round(live.totalDurationMs / live.count) : null;
                return (
                  <tr
                    key={m.id}
                    style={{ borderBottom: '1px solid #1e293b' }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1e293b')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ fontWeight: 600, color: '#f8fafc' }}>{m.name}</div>
                      <div style={{ fontSize: '11px', color: '#818cf8', fontFamily: 'monospace' }}>{m.id}</div>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <span
                        style={{
                          fontSize: '11px',
                          padding: '2px 8px',
                          borderRadius: '6px',
                          backgroundColor: '#1e293b',
                          color: '#94a3b8',
                          border: '1px solid #334155',
                        }}
                      >
                        {m.modality}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px', color: '#f8fafc', fontWeight: 600 }}>
                      {m.minVramMb > 0 ? `${(m.minVramMb / 1024).toFixed(1)} GB` : 'API Driven'}
                    </td>
                    <td style={{ padding: '12px 16px', color: '#94a3b8' }}>
                      {m.latencyTier}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <span
                        style={{
                          fontSize: '12px',
                          padding: '3px 8px',
                          borderRadius: '6px',
                          backgroundColor: 'rgba(99, 102, 241, 0.1)',
                          color: '#a5b4fc',
                          fontWeight: 600,
                        }}
                      >
                        {m.defaultProvider}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px', color: '#34d399', fontWeight: 500 }}>
                      {m.pricingTier}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      {live && live.count > 0 ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span
                            style={{
                              padding: '2px 8px',
                              borderRadius: '6px',
                              backgroundColor: 'rgba(16, 185, 129, 0.15)',
                              color: '#34d399',
                              fontSize: '12px',
                              fontWeight: 600,
                            }}
                          >
                            {live.count} {live.count === 1 ? 'job' : 'jobs'}
                          </span>
                          {avgMs !== null && avgMs > 0 && (
                            <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                              ~{avgMs} ms avg
                            </span>
                          )}
                        </div>
                      ) : (
                        <span style={{ fontSize: '12px', color: '#64748b' }}>0 jobs / Idle</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

