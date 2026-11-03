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

export function FinOpsPricingView() {
  const [activeSubTab, setActiveSubTab] = useState<'gpus' | 'models' | 'history'>('gpus');
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
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
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
          }}
        >
          GPU Availability & Pricing ({gpuPricing.length})
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
          }}
        >
          Open Models & Token Factory ({modelPricing.length})
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
          }}
        >
          Pricing History & Update Cadence ({historySummaries.length})
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
            <option value="nebius">Nebius</option>
            <option value="jarvislabs">JarvisLabs</option>
            <option value="fal">fal.ai</option>
            <option value="runware">Runware</option>
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
                  <th style={{ padding: '14px 16px', color: '#94a3b8', fontWeight: 600 }}>Provider</th>
                  <th style={{ padding: '14px 16px', color: '#94a3b8', fontWeight: 600 }}>Hardware Chip</th>
                  <th style={{ padding: '14px 16px', color: '#94a3b8', fontWeight: 600 }}>VRAM</th>
                  <th style={{ padding: '14px 16px', color: '#94a3b8', fontWeight: 600 }}>Zone</th>
                  <th style={{ padding: '14px 16px', color: '#94a3b8', fontWeight: 600 }}>Pricing Model</th>
                  <th style={{ padding: '14px 16px', color: '#94a3b8', fontWeight: 600 }}>Price ($/hr)</th>
                  <th style={{ padding: '14px 16px', color: '#94a3b8', fontWeight: 600 }}>Availability</th>
                  <th style={{ padding: '14px 16px', color: '#94a3b8', fontWeight: 600 }}>Risk Tier</th>
                  <th style={{ padding: '14px 16px', color: '#94a3b8', fontWeight: 600 }}>Commitment</th>
                </tr>
              </thead>
              <tbody>
                {filteredGpus.map((item, idx) => (
                  <tr
                    key={item.id}
                    style={{
                      borderBottom: '1px solid #1e293b',
                      backgroundColor: idx % 2 === 0 ? 'transparent' : '#1e293b20',
                    }}
                  >
                    <td style={{ padding: '14px 16px', fontWeight: 600, color: '#f8fafc' }}>
                      <span
                        style={{
                          backgroundColor: '#3b82f620',
                          color: '#60a5fa',
                          padding: '3px 8px',
                          borderRadius: '4px',
                          fontSize: '12px',
                        }}
                      >
                        {item.provider.toUpperCase()}
                      </span>
                    </td>
                    <td style={{ padding: '14px 16px', color: '#f1f5f9', fontWeight: 500 }}>
                      {item.hardwareDisplayName}
                    </td>
                    <td style={{ padding: '14px 16px', color: '#94a3b8' }}>{item.vramGb} GB</td>
                    <td style={{ padding: '14px 16px', color: '#94a3b8', fontSize: '12px' }}>{item.zone}</td>
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
                    <td style={{ padding: '14px 16px', color: '#10b981', fontWeight: 700, fontSize: '14px' }}>
                      ${item.normalizedHourlyUsd.toFixed(3)}
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      <span
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
                        }}
                      >
                        {item.obtainabilityLabel} ({(item.obtainabilityScore * 100).toFixed(0)}%)
                      </span>
                    </td>
                    <td style={{ padding: '14px 16px', color: '#94a3b8', fontSize: '12px' }}>
                      {item.interruptionRiskTier}
                    </td>
                    <td style={{ padding: '14px 16px', color: '#64748b', fontSize: '12px' }}>
                      {item.commitment}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB B: Open Models & Token Factory */}
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
                  <th style={{ padding: '14px 16px', color: '#94a3b8', fontWeight: 600 }}>Provider</th>
                  <th style={{ padding: '14px 16px', color: '#94a3b8', fontWeight: 600 }}>Model ID & Name</th>
                  <th style={{ padding: '14px 16px', color: '#94a3b8', fontWeight: 600 }}>Developer</th>
                  <th style={{ padding: '14px 16px', color: '#94a3b8', fontWeight: 600 }}>Execution Type</th>
                  <th style={{ padding: '14px 16px', color: '#94a3b8', fontWeight: 600 }}>Input Rate</th>
                  <th style={{ padding: '14px 16px', color: '#94a3b8', fontWeight: 600 }}>Output Rate</th>
                  <th style={{ padding: '14px 16px', color: '#94a3b8', fontWeight: 600 }}>Cached Input</th>
                  <th style={{ padding: '14px 16px', color: '#94a3b8', fontWeight: 600 }}>Context Window</th>
                  <th style={{ padding: '14px 16px', color: '#94a3b8', fontWeight: 600 }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredModels.map((item, idx) => (
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

      {/* TAB C: Pricing History & Update Cadence */}
      {activeSubTab === 'history' && (
        <div>
          {/* Provider Update Frequency Cards */}
          <div style={{ marginBottom: '24px' }}>
            <h3 style={{ color: '#f8fafc', fontSize: '16px', fontWeight: 600, marginBottom: '12px' }}>
              Provider Pricing Update Cadence & Telemetry
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

          {/* Historical Trend Series */}
          <div
            style={{
              backgroundColor: '#0f172a',
              borderRadius: '12px',
              border: '1px solid #1e293b',
              padding: '20px',
            }}
          >
            <h3 style={{ color: '#f8fafc', fontSize: '16px', fontWeight: 600, marginBottom: '16px' }}>
              Historical Price Fluctuations (7 Days Time-Series)
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {historySummaries.map((summary) => (
                <div
                  key={summary.itemId}
                  style={{
                    border: '1px solid #1e293b',
                    borderRadius: '8px',
                    padding: '16px',
                    backgroundColor: '#1e293b20',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: '12px',
                    }}
                  >
                    <div>
                      <div style={{ color: '#f8fafc', fontWeight: 600, fontSize: '14px' }}>
                        {summary.displayName}
                      </div>
                      <div style={{ color: '#94a3b8', fontSize: '12px' }}>
                        Cadence: {summary.updateCadence} (polling every ~{summary.estimatedUpdateFrequencyMinutes} mins)
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ color: '#10b981', fontWeight: 700, fontSize: '15px' }}>
                        ${summary.latestPriceUsd}
                      </div>
                      <div
                        style={{
                          color: summary.priceChange24hPct < 0 ? '#34d399' : '#f87171',
                          fontSize: '11px',
                          fontWeight: 600,
                        }}
                      >
                        {summary.priceChange24hPct >= 0 ? '+' : ''}
                        {summary.priceChange24hPct}% (24h)
                      </div>
                    </div>
                  </div>

                  {/* Sparkline-like data point preview */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
                      gap: '8px',
                    }}
                  >
                    {summary.history.slice(-6).map((pt, i) => (
                      <div
                        key={i}
                        style={{
                          backgroundColor: '#0f172a',
                          border: '1px solid #334155',
                          borderRadius: '6px',
                          padding: '6px 10px',
                          fontSize: '11px',
                        }}
                      >
                        <div style={{ color: '#64748b' }}>
                          {new Date(pt.recordedAt).toLocaleDateString([], {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                          })}
                        </div>
                        <div style={{ color: '#38bdf8', fontWeight: 600 }}>${pt.priceUsd}</div>
                        {pt.spotPriceUsd && (
                          <div style={{ color: '#34d399', fontSize: '10px' }}>Spot: ${pt.spotPriceUsd}</div>
                        )}
                      </div>
                    ))}
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
