import { useState, useMemo } from 'react';
import { DEFAULT_PROVIDER_FLEET, formatCadenceInterval } from '../finops/ProviderFleetBar';
import { SyncTracesModal } from '../finops/SyncTracesModal';
import { getProviderGrafanaUrl } from '../../config/observability';
import type {
  PricingSyncAudit,
  ProviderBalanceStatus,
  ProviderFleetStatus,
  ProviderProfile,
} from '../../types';

export interface ProviderSyncCounts {
  syncedCount: number;
  unsyncedCount: number;
  totalCount: number;
  unsyncedProviders: string[];
}

/**
 * Calculates real-time synced vs unsynced provider counts across
 * health state, API sync audit results, and cadence staleness.
 */
export function computeProviderSyncMetrics(
  fleet: ProviderFleetStatus[] = DEFAULT_PROVIDER_FLEET,
  syncAudits: PricingSyncAudit[] = [],
  providersMap?: Record<string, { healthy?: boolean }>
): ProviderSyncCounts {
  let synced = 0;
  let unsynced = 0;
  const unsyncedList: string[] = [];

  for (const p of fleet) {
    const audit = syncAudits.find(
      (a) => a.provider.toLowerCase() === p.provider.toLowerCase()
    );
    const isHealthy =
      providersMap && providersMap[p.provider] !== undefined
        ? providersMap[p.provider].healthy !== false
        : p.isHealthy !== false;
    const isFailedAudit = audit?.status === 'FAILED' || audit?.status === 'ERROR';
    const isStale = p.syncStatus === 'stale';

    if (!isHealthy || isFailedAudit || isStale) {
      unsynced++;
      unsyncedList.push(p.provider);
    } else {
      synced++;
    }
  }

  return {
    syncedCount: synced,
    unsyncedCount: unsynced,
    totalCount: fleet.length,
    unsyncedProviders: unsyncedList,
  };
}

export interface ProviderStatusViewProps {
  syncAudits: PricingSyncAudit[];
  providerBalances?: Record<string, ProviderBalanceStatus>;
  providers?: Record<string, ProviderProfile>;
  onRefreshSync?: () => Promise<void> | void;
  onToggleHealth?: (provider: string, healthy: boolean) => Promise<void>;
  isSyncing?: boolean;
}

const PROVIDER_INFRA_METADATA: Record<
  string,
  { vramLabel: string; supportsVpc: boolean; marginalRateLabel: string }
> = {
  local_pytorch: { vramLabel: '16 GB GDDR7 (RTX 5070 Ti)', supportsVpc: true, marginalRateLabel: '$0.00 / 1k tok' },
  runpod: { vramLabel: '24–80 GB (4090 / H100)', supportsVpc: false, marginalRateLabel: '$0.00015 / 1k tok' },
  vast_ai: { vramLabel: '24–32 GB (5090 / 4090)', supportsVpc: false, marginalRateLabel: '$0.00012 / 1k tok' },
  baseten: { vramLabel: '24–80 GB (L4 / H100 Truss)', supportsVpc: true, marginalRateLabel: '$0.00025 / 1k tok' },
  nebius: { vramLabel: '80–141 GB (H100 / H200)', supportsVpc: true, marginalRateLabel: '$0.00018 / 1k tok' },
  jarvislabs: { vramLabel: 'MaaS / 16–80 GB Pods', supportsVpc: false, marginalRateLabel: '$0.00007 / 1k tok' },
  coreweave: { vramLabel: '80–141 GB (H100 / H200 K8s)', supportsVpc: true, marginalRateLabel: '$0.00022 / 1k tok' },
  fal: { vramLabel: 'Serverless Media Cluster', supportsVpc: false, marginalRateLabel: '$0.003 / call' },
  runware: { vramLabel: 'Sonic Diffusion Engine', supportsVpc: false, marginalRateLabel: '$0.0018 / MP' },
  hivenet: { vramLabel: '16–24 GB Distributed RTX', supportsVpc: false, marginalRateLabel: '$0.29 / hr' },
  wavespeed: { vramLabel: 'Accelerated Media API', supportsVpc: false, marginalRateLabel: '$0.0025 / call' },
  neocloudz: { vramLabel: '24–80 GB Bare-Metal GPU', supportsVpc: false, marginalRateLabel: '$0.38 / hr' },
  bedrock: { vramLabel: 'Managed Serverless API', supportsVpc: true, marginalRateLabel: '$0.00025 / 1k tok' },
  sagemaker: { vramLabel: '32–192 GB (Inferentia2 / G5)', supportsVpc: true, marginalRateLabel: '$0.00020 / 1k tok' },
};

export function ProviderStatusView({
  syncAudits,
  providerBalances,
  providers = {},
  onRefreshSync,
  onToggleHealth,
  isSyncing = false,
}: ProviderStatusViewProps) {
  const [selectedFilter, setSelectedFilter] = useState<'all' | 'synced' | 'unsynced'>('all');
  const [selectedCadence, setSelectedCadence] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [togglingProvider, setTogglingProvider] = useState<string | null>(null);
  const [showTracesModal, setShowTracesModal] = useState(false);
  const [selectedProviderDetail, setSelectedProviderDetail] = useState<
    (ProviderFleetStatus & {
      liveBalanceUsd?: number | null;
      balanceStatus?: string;
      isSynced?: boolean;
      syncStateLabel?: string;
    }) | null
  >(null);

  // Merge dynamic sync audits, live balances, and live health into baseline providers
  const fleetProviders = useMemo(() => {
    return DEFAULT_PROVIDER_FLEET.map((p) => {
      const audit = syncAudits.find((a) => a.provider.toLowerCase() === p.provider.toLowerCase());
      const balanceEntry = providerBalances ? providerBalances[p.provider.toLowerCase()] : undefined;
      const isHealthy = providers[p.provider] !== undefined ? providers[p.provider].healthy !== false : p.isHealthy;

      let liveBalanceUsd: number | null = null;
      let balanceStatus = 'UNKNOWN';
      let creditType = p.creditType;

      if (balanceEntry) {
        if (balanceEntry.balanceUsd !== undefined && balanceEntry.balanceUsd !== null) {
          liveBalanceUsd = balanceEntry.balanceUsd;
        }
        if (balanceEntry.status) {
          balanceStatus = balanceEntry.status;
        }
        if (balanceEntry.creditType) {
          creditType = balanceEntry.creditType as any;
        }
      } else if (audit && (audit as any).availableCreditsUsd !== undefined) {
        liveBalanceUsd = (audit as any).availableCreditsUsd;
        balanceStatus = (audit as any).balanceStatus || (liveBalanceUsd !== null ? 'LIVE_VERIFIED' : 'UNKNOWN');
      }

      const isFailedAudit = audit?.status === 'FAILED' || audit?.status === 'ERROR';
      const isStale = p.syncStatus === 'stale';
      const isSynced = isHealthy && !isFailedAudit && !isStale;

      let syncStateLabel = 'LIVE';
      if (!isHealthy) syncStateLabel = 'OFFLINE';
      else if (isFailedAudit) syncStateLabel = 'SYNC_ERROR';
      else if (isStale) syncStateLabel = 'STALE';
      else if (audit?.status) syncStateLabel = audit.status;

      return {
        ...p,
        isHealthy,
        isSynced,
        syncStateLabel,
        liveBalanceUsd,
        balanceStatus,
        creditType,
        lastSyncedAt: audit?.syncedAt || p.lastSyncedAt,
        updateFrequencyDescription: audit?.updateFrequencyDescription || p.updateFrequencyDescription,
        estimatedUpdateIntervalSec: audit?.estimatedUpdateIntervalSec || p.estimatedUpdateIntervalSec,
        updateCadenceCategory: audit?.updateCadenceCategory || p.updateCadenceCategory,
      };
    });
  }, [syncAudits, providerBalances, providers]);

  // Compute live metrics
  const metrics = useMemo(() => {
    const synced = fleetProviders.filter((p) => p.isSynced).length;
    const unsynced = fleetProviders.filter((p) => !p.isSynced).length;
    const unsyncedProviders = fleetProviders.filter((p) => !p.isSynced).map((p) => p.displayName);
    return {
      syncedCount: synced,
      unsyncedCount: unsynced,
      totalCount: fleetProviders.length,
      unsyncedProviders,
    };
  }, [fleetProviders]);

  const livePrepaidProviders = fleetProviders.filter(
    (p) => p.liveBalanceUsd !== null && p.liveBalanceUsd !== undefined
  );
  const totalLiveCredits =
    livePrepaidProviders.length > 0
      ? livePrepaidProviders.reduce((acc, p) => acc + (p.liveBalanceUsd || 0), 0)
      : null;

  // Filtered providers
  const displayedProviders = useMemo(() => {
    return fleetProviders.filter((p) => {
      // 1. Sync filter
      if (selectedFilter === 'synced' && !p.isSynced) return false;
      if (selectedFilter === 'unsynced' && p.isSynced) return false;

      // 2. Cadence filter
      if (selectedCadence !== 'all' && p.updateCadenceCategory !== selectedCadence) return false;

      // 3. Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = p.displayName.toLowerCase().includes(q) || p.provider.toLowerCase().includes(q);
        const matchesCadence = p.updateFrequencyDescription.toLowerCase().includes(q);
        const matchesModel = p.allowedPricingModels.some((m) => m.toLowerCase().includes(q));
        if (!matchesName && !matchesCadence && !matchesModel) return false;
      }

      return true;
    });
  }, [fleetProviders, selectedFilter, selectedCadence, searchQuery]);

  const handleToggle = async (name: string, currentHealth: boolean) => {
    if (!onToggleHealth) return;
    setTogglingProvider(name);
    try {
      await onToggleHealth(name, !currentHealth);
    } finally {
      setTogglingProvider(null);
    }
  };

  return (
    <div
      className="dashboard-container-1200"
      style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}
    >
      {/* Overview Top Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          gap: '16px',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span
              style={{
                width: '12px',
                height: '12px',
                borderRadius: '50%',
                backgroundColor: metrics.unsyncedCount > 0 ? '#ef4444' : '#10b981',
                boxShadow: metrics.unsyncedCount > 0 ? '0 0 10px #ef4444' : '0 0 10px #10b981',
              }}
            />
            <h2 style={{ fontSize: '20px', fontWeight: 700, color: '#f8fafc', margin: 0 }}>
              Multi-Cloud Provider Fleet &amp; Real-Time Sync Status
            </h2>
          </div>
          <p style={{ fontSize: '13px', color: '#94a3b8', margin: '6px 0 0 0', maxWidth: '850px' }}>
            Live catalog synchronization engine across all 14 multi-cloud GPU and managed API providers.
            Monitors real-time pricing shifts, API authentication health, preemption windows, and prepaid billing pools.
          </p>
        </div>

        {/* Global Action Bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => setShowTracesModal(true)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              backgroundColor: '#1e293b',
              color: '#38bdf8',
              border: '1px solid #334155',
              borderRadius: '6px',
              padding: '6px 12px',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            📋 Sync Traces &amp; Logs
          </button>

          <a
            href={getProviderGrafanaUrl()}
            target="_blank"
            rel="noopener noreferrer"
            title="Open Grafana Pricing & Fleet Intelligence Dashboard"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              backgroundColor: 'rgba(249, 115, 22, 0.12)',
              color: '#fb923c',
              border: '1px solid rgba(249, 115, 22, 0.3)',
              borderRadius: '6px',
              padding: '6px 10px',
              fontSize: '12px',
              fontWeight: 600,
              textDecoration: 'none',
            }}
          >
            📈 Grafana Telemetry
          </a>

          <a
            href="https://wandb.ai/"
            target="_blank"
            rel="noopener noreferrer"
            title="Weights & Biases (Weave) is configured as the live OpenTelemetry trace and prompt evaluation sink."
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              backgroundColor: 'rgba(245, 158, 11, 0.12)',
              color: '#fbbf24',
              border: '1px solid rgba(245, 158, 11, 0.3)',
              borderRadius: '6px',
              padding: '6px 10px',
              fontSize: '12px',
              fontWeight: 600,
              textDecoration: 'none',
            }}
          >
            📊 W&amp;B Weave Tracing
          </a>

          {onRefreshSync && (
            <button
              onClick={() => onRefreshSync()}
              disabled={isSyncing}
              title="Trigger live catalog synchronization with all 14 provider APIs"
              style={{
                backgroundColor: '#3b82f6',
                color: '#ffffff',
                border: 'none',
                borderRadius: '6px',
                padding: '7px 14px',
                fontSize: '12px',
                fontWeight: 600,
                cursor: isSyncing ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                transition: 'background-color 0.15s ease',
              }}
            >
              <span
                style={{
                  display: 'inline-block',
                  transform: isSyncing ? 'rotate(180deg)' : 'none',
                  transition: 'transform 0.5s',
                }}
              >
                ↻
              </span>
              {isSyncing ? 'Synchronizing Fleet...' : '↻ Sync Fleet Now'}
            </button>
          )}
        </div>
      </div>

      {/* KPI Stat Cards (4 Cards across top - locked single row on 1200x1900) */}
      <div className="kpi-grid-4">
        {/* Card 1: Synced Providers */}
        <div
          style={{
            backgroundColor: '#0f172a',
            border: '1px solid #1e293b',
            borderLeft: '4px solid #10b981',
            borderRadius: '10px',
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase' }}>
            Synced Providers
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', margin: '8px 0 4px 0' }}>
            <span style={{ fontSize: '26px', fontWeight: 800, color: '#f8fafc' }}>
              {metrics.syncedCount}
            </span>
            <span style={{ fontSize: '13px', color: '#64748b' }}>/ {metrics.totalCount} providers</span>
          </div>
          <div style={{ fontSize: '12px', color: '#10b981', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span>●</span>
            {metrics.syncedCount === metrics.totalCount
              ? '100% Catalogs In Sync'
              : `${((metrics.syncedCount / metrics.totalCount) * 100).toFixed(0)}% Fleet Synchronized`}
          </div>
        </div>

        {/* Card 2: Unsynced Providers Alert */}
        <div
          style={{
            backgroundColor: '#0f172a',
            border: '1px solid #1e293b',
            borderLeft: `4px solid ${metrics.unsyncedCount > 0 ? '#ef4444' : '#10b981'}`,
            borderRadius: '10px',
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase' }}>
            Unsynced / Action Needed
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', margin: '8px 0 4px 0' }}>
            <span
              style={{
                fontSize: '26px',
                fontWeight: 800,
                color: metrics.unsyncedCount > 0 ? '#ef4444' : '#10b981',
              }}
            >
              {metrics.unsyncedCount}
            </span>
            <span style={{ fontSize: '13px', color: '#64748b' }}>out of sync</span>
          </div>
          <div
            style={{
              fontSize: '12px',
              fontWeight: 600,
              color: metrics.unsyncedCount > 0 ? '#ef4444' : '#10b981',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            {metrics.unsyncedCount > 0 ? (
              <>
                <span>▲</span> Warning: Operator Check Required
              </>
            ) : (
              <>
                <span>✓</span> Zero Sync Errors Detected
              </>
            )}
          </div>
        </div>

        {/* Card 3: Neocloud Prepaid Pool */}
        <div
          style={{
            backgroundColor: '#0f172a',
            border: '1px solid #1e293b',
            borderLeft: '4px solid #38bdf8',
            borderRadius: '10px',
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase' }}>
            Neocloud Prepaid Pool
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', margin: '8px 0 4px 0' }}>
            <span style={{ fontSize: '26px', fontWeight: 800, color: totalLiveCredits !== null ? '#34d399' : '#94a3b8' }}>
              {totalLiveCredits !== null ? `$${totalLiveCredits.toFixed(2)}` : '--'}
            </span>
            <span style={{ fontSize: '12px', color: '#64748b' }}>USD Balance</span>
          </div>
          <div style={{ fontSize: '12px', color: '#94a3b8' }}>
            + Nebius, Forge &amp; AWS Postpaid
          </div>
        </div>

        {/* Card 4: Real-Time Sync Cadence */}
        <div
          style={{
            backgroundColor: '#0f172a',
            border: '1px solid #1e293b',
            borderLeft: '4px solid #a855f7',
            borderRadius: '10px',
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase' }}>
            Sync Cadence Engine
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', margin: '8px 0 4px 0' }}>
            <span style={{ fontSize: '26px', fontWeight: 800, color: '#f8fafc' }}>
              14
            </span>
            <span style={{ fontSize: '13px', color: '#64748b' }}>Active Sync Paths</span>
          </div>
          <div style={{ fontSize: '11px', color: '#cbd5e1' }}>
            2 Spot Auction · 3 Dynamic · 9 Scheduled
          </div>
        </div>
      </div>

      {/* Prominent Warning Callout Banner (when unsynced providers exist) */}
      {metrics.unsyncedCount > 0 && (
        <div
          style={{
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid #ef4444',
            borderRadius: '10px',
            padding: '14px 18px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '18px' }}>⚠️</span>
            <div>
              <div style={{ fontSize: '14px', fontWeight: 700, color: '#fca5a5' }}>
                Attention: {metrics.unsyncedCount} Provider{metrics.unsyncedCount > 1 ? 's' : ''} Currently Out of Sync or Degraded
              </div>
              <div style={{ fontSize: '12px', color: '#fecaca', marginTop: '2px' }}>
                Affected: <strong>{metrics.unsyncedProviders.join(', ')}</strong>. Automated SLO routing will divert live traffic away from degraded engines.
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button
              onClick={() => setShowTracesModal(true)}
              style={{
                backgroundColor: 'rgba(239, 68, 68, 0.25)',
                color: '#fca5a5',
                border: '1px solid #ef4444',
                borderRadius: '6px',
                padding: '6px 12px',
                fontSize: '12px',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
              }}
            >
              📋 View Diagnostic Traces
            </button>
            <button
              onClick={() => setSelectedFilter('unsynced')}
              style={{
                backgroundColor: '#ef4444',
                color: '#ffffff',
                border: 'none',
                borderRadius: '6px',
                padding: '6px 12px',
                fontSize: '12px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Filter Unsynced
            </button>
            {onRefreshSync && (
              <button
                onClick={() => onRefreshSync()}
                disabled={isSyncing}
                style={{
                  backgroundColor: '#1e293b',
                  color: '#f8fafc',
                  border: '1px solid #ef4444',
                  borderRadius: '6px',
                  padding: '6px 12px',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: isSyncing ? 'not-allowed' : 'pointer',
                }}
              >
                Retry Sync
              </button>
            )}
          </div>
        </div>
      )}

      {/* Interactive Controls & Filters Bar */}
      <div
        style={{
          backgroundColor: '#0f172a',
          borderRadius: '10px',
          border: '1px solid #1e293b',
          padding: '14px 18px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        {/* Filter Pills: All / Synced / Unsynced */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '12px', color: '#94a3b8', fontWeight: 600, marginRight: '4px' }}>
            Status Filter:
          </span>
          <button
            onClick={() => setSelectedFilter('all')}
            style={{
              padding: '6px 12px',
              borderRadius: '6px',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              border: selectedFilter === 'all' ? '1px solid #3b82f6' : '1px solid #334155',
              backgroundColor: selectedFilter === 'all' ? '#3b82f6' : '#1e293b',
              color: selectedFilter === 'all' ? '#ffffff' : '#94a3b8',
              transition: 'all 0.15s ease',
            }}
          >
            All Providers ({metrics.totalCount})
          </button>
          <button
            onClick={() => setSelectedFilter('synced')}
            style={{
              padding: '6px 12px',
              borderRadius: '6px',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              border: selectedFilter === 'synced' ? '1px solid #10b981' : '1px solid #334155',
              backgroundColor: selectedFilter === 'synced' ? 'rgba(16, 185, 129, 0.2)' : '#1e293b',
              color: selectedFilter === 'synced' ? '#34d399' : '#94a3b8',
              transition: 'all 0.15s ease',
            }}
          >
            ✓ Synced ({metrics.syncedCount})
          </button>
          <button
            onClick={() => setSelectedFilter('unsynced')}
            style={{
              padding: '6px 12px',
              borderRadius: '6px',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              border: selectedFilter === 'unsynced' ? '1px solid #ef4444' : '1px solid #334155',
              backgroundColor: selectedFilter === 'unsynced' ? 'rgba(239, 68, 68, 0.2)' : '#1e293b',
              color: selectedFilter === 'unsynced' ? '#f87171' : '#94a3b8',
              transition: 'all 0.15s ease',
            }}
          >
            ⚠️ Unsynced ({metrics.unsyncedCount})
          </button>
        </div>

        {/* Search & Cadence Filter */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <select
            value={selectedCadence}
            onChange={(e) => setSelectedCadence(e.target.value)}
            style={{
              backgroundColor: '#1e293b',
              color: '#f8fafc',
              border: '1px solid #334155',
              borderRadius: '6px',
              padding: '6px 10px',
              fontSize: '12px',
              outline: 'none',
              cursor: 'pointer',
            }}
          >
            <option value="all">All Cadence Models</option>
            <option value="realtime_auction">Real-Time Auction (~1-2m)</option>
            <option value="dynamic_shifts">Dynamic Shifts (~10-60m)</option>
            <option value="scheduled">Scheduled (~12-24h)</option>
          </select>

          <input
            type="text"
            placeholder="Search provider, chip, modality..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              backgroundColor: '#1e293b',
              color: '#f8fafc',
              border: '1px solid #334155',
              borderRadius: '6px',
              padding: '6px 12px',
              fontSize: '12px',
              outline: 'none',
              minWidth: '220px',
            }}
          />
        </div>
      </div>

      {/* Main Multi-Cloud Provider Fleet Table */}
      <div style={{ overflowX: 'auto', borderRadius: '10px', border: '1px solid #1e293b', backgroundColor: '#0f172a' }}>
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
              <th style={{ padding: '10px 12px', color: '#94a3b8', fontWeight: 600 }}>Provider &amp; VPC</th>
              <th style={{ padding: '10px 12px', color: '#94a3b8', fontWeight: 600 }}>Sync &amp; Health</th>
              <th style={{ padding: '10px 12px', color: '#94a3b8', fontWeight: 600 }}>Cadence</th>
              <th style={{ padding: '10px 12px', color: '#94a3b8', fontWeight: 600 }}>Hardware / Modalities</th>
              <th style={{ padding: '10px 12px', color: '#94a3b8', fontWeight: 600 }}>Preemption Policy</th>
              <th style={{ padding: '10px 12px', color: '#94a3b8', fontWeight: 600 }}>Balance / Credits</th>
              <th style={{ padding: '10px 12px', color: '#94a3b8', fontWeight: 600, textAlign: 'right' }}>Failover &amp; Inspect</th>
            </tr>
          </thead>
          <tbody>
            {displayedProviders.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: '24px', textAlign: 'center', color: '#94a3b8' }}>
                  No providers match the selected filters.
                </td>
              </tr>
            ) : (
              displayedProviders.map((p, idx) => {
                const isSelected = selectedProviderDetail?.provider === p.provider;
                const cadenceColor =
                  p.updateCadenceCategory === 'realtime_auction'
                    ? '#10b981'
                    : p.updateCadenceCategory === 'dynamic_shifts'
                      ? '#38bdf8'
                      : '#a78bfa';

                return (
                  <tr
                    key={p.provider}
                    onClick={() => setSelectedProviderDetail(isSelected ? null : p)}
                    style={{
                      borderBottom: '1px solid #1e293b',
                      backgroundColor: isSelected
                        ? 'rgba(56, 189, 248, 0.08)'
                        : !p.isSynced
                          ? 'rgba(239, 68, 68, 0.05)'
                          : idx % 2 === 0
                            ? 'transparent'
                            : '#1e293b20',
                      cursor: 'pointer',
                      transition: 'background-color 0.15s ease',
                    }}
                  >
                    {/* Provider Name + Health Indicator + VPC Badge */}
                    <td style={{ padding: '10px 12px', fontWeight: 700, color: '#f8fafc' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <span
                          style={{
                            width: '8px',
                            height: '8px',
                            borderRadius: '50%',
                            backgroundColor: p.isHealthy ? '#10b981' : '#ef4444',
                            boxShadow: p.isHealthy ? '0 0 6px #10b981' : '0 0 6px #ef4444',
                            flexShrink: 0,
                          }}
                        />
                        <a
                          href={p.websiteUrl || '#'}
                          target={p.websiteUrl?.startsWith('http') ? '_blank' : '_self'}
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          title={`Visit ${p.displayName} official portal`}
                          style={{
                            color: '#38bdf8',
                            textDecoration: 'none',
                            fontWeight: 700,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                          }}
                        >
                          {p.displayName}
                        </a>
                        {PROVIDER_INFRA_METADATA[p.provider]?.supportsVpc && (
                          <span
                            title="Supports Private VPC / Isolated Network Execution"
                            style={{
                              fontSize: '9px',
                              padding: '1px 5px',
                              borderRadius: '4px',
                              backgroundColor: 'rgba(16, 185, 129, 0.15)',
                              color: '#34d399',
                              border: '1px solid rgba(16, 185, 129, 0.3)',
                              fontWeight: 700,
                            }}
                          >
                            🛡️ VPC
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '10px', color: '#64748b', marginTop: '2px', paddingLeft: '16px' }}>
                        {PROVIDER_INFRA_METADATA[p.provider]?.vramLabel || 'Cloud Compute'}
                      </div>
                    </td>

                    {/* Sync Status & Polling Frequency */}
                    <td style={{ padding: '12px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span
                          style={{
                            backgroundColor: p.isSynced ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                            color: p.isSynced ? '#34d399' : '#f87171',
                            padding: '2px 7px',
                            borderRadius: '4px',
                            fontSize: '11px',
                            fontWeight: 700,
                            textTransform: 'uppercase',
                            border: `1px solid ${p.isSynced ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                          }}
                        >
                          {p.syncStateLabel}
                        </span>
                        <a
                          href={p.syncDocUrl || p.cadenceDocUrl || p.spotPricingUrl || p.pricingUrl || p.websiteUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          title={`Official documentation & quota source for ${p.displayName} (~${formatCadenceInterval(p.estimatedUpdateIntervalSec)} polling cadence). Click to view documentation.`}
                          style={{
                            color: '#38bdf8',
                            fontSize: '11px',
                            textDecoration: 'none',
                            fontWeight: 600,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '2px',
                            borderBottom: '1px dotted rgba(56, 189, 248, 0.4)',
                            cursor: 'pointer',
                          }}
                        >
                          ~{formatCadenceInterval(p.estimatedUpdateIntervalSec)}
                        </a>
                      </div>
                    </td>

                    {/* Update Cadence Badge */}
                    <td style={{ padding: '12px 14px' }}>
                      <a
                        href={p.cadenceDocUrl || p.websiteUrl || '#'}
                        target={p.cadenceDocUrl?.startsWith('http') ? '_blank' : '_self'}
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        title={p.cadenceExplanation || `${p.updateCadenceCategory} update cadence model`}
                        style={{
                          fontSize: '10px',
                          fontWeight: 700,
                          padding: '2px 6px',
                          borderRadius: '4px',
                          backgroundColor: `${cadenceColor}20`,
                          color: cadenceColor,
                          textTransform: 'uppercase',
                          textDecoration: 'none',
                          border: `1px solid ${cadenceColor}40`,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '3px',
                        }}
                      >
                        {p.updateCadenceCategory.replace('_', ' ')}
                        <span style={{ fontSize: '8px', opacity: 0.8 }}>ℹ</span>
                      </a>
                    </td>

                    {/* Supported Modalities */}
                    <td style={{ padding: '12px 14px' }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                        {p.allowedPricingModels.map((mode) => (
                          <span
                            key={mode}
                            style={{
                              fontSize: '10px',
                              padding: '1px 5px',
                              borderRadius: '3px',
                              backgroundColor:
                                mode === 'spot'
                                  ? 'rgba(16, 185, 129, 0.15)'
                                  : mode === 'serverless'
                                    ? 'rgba(6, 182, 212, 0.15)'
                                    : mode === 'token_factory'
                                      ? 'rgba(139, 92, 246, 0.15)'
                                      : 'rgba(148, 163, 184, 0.15)',
                              color:
                                mode === 'spot'
                                  ? '#34d399'
                                  : mode === 'serverless'
                                    ? '#22d3ee'
                                    : mode === 'token_factory'
                                      ? '#c084fc'
                                      : '#cbd5e1',
                              fontWeight: 600,
                              textTransform: 'uppercase',
                            }}
                          >
                            {mode.replace('_', ' ')}
                          </span>
                        ))}
                      </div>
                    </td>

                    {/* Preemption Policy */}
                    <td style={{ padding: '12px 14px' }}>
                      {p.spotPolicy ? (
                        <a
                          href={p.spotPricingUrl || p.pricingUrl || '#'}
                          target={p.spotPricingUrl?.startsWith('http') ? '_blank' : '_self'}
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          title={p.spotPolicy.description}
                          style={{
                            fontSize: '11px',
                            color: '#fbbf24',
                            textDecoration: 'none',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                          }}
                        >
                          <strong>{p.spotPolicy.noticeWindowLabel}</strong>
                          <span style={{ color: '#94a3b8', fontSize: '10px' }}>
                            ({p.spotPolicy.pricingTypeLabel})
                          </span>
                        </a>
                      ) : (
                        <span style={{ color: '#94a3b8', fontSize: '11px' }}>
                          {p.interruptionNoticeWindow}
                        </span>
                      )}
                    </td>

                    {/* Balance / Credits */}
                    <td style={{ padding: '12px 14px', fontSize: '11px' }}>
                      {p.liveBalanceUsd !== null && p.liveBalanceUsd !== undefined ? (
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ color: '#34d399', fontWeight: 700 }}>
                            ${p.liveBalanceUsd.toFixed(2)}
                          </span>
                          <span
                            style={{
                              fontSize: '9px',
                              backgroundColor: 'rgba(16, 185, 129, 0.18)',
                              color: '#34d399',
                              border: '1px solid rgba(16, 185, 129, 0.35)',
                              borderRadius: '3px',
                              padding: '1px 4px',
                              fontWeight: 700,
                            }}
                          >
                            Verified
                          </span>
                        </div>
                      ) : p.provider === 'local_pytorch' ? (
                        <span style={{ color: '#94a3b8' }}>$0.00 (Local HW)</span>
                      ) : p.creditType === 'postpaid_invoice' || p.balanceStatus === 'POSTPAID_INVOICE' ? (
                        <span
                          style={{
                            color: '#60a5fa',
                            fontWeight: 600,
                            backgroundColor: 'rgba(96, 165, 250, 0.12)',
                            border: '1px solid rgba(96, 165, 250, 0.3)',
                            borderRadius: '3px',
                            padding: '2px 6px',
                            fontSize: '10px',
                          }}
                        >
                          Postpaid Invoice
                        </span>
                      ) : (
                        <span style={{ color: '#64748b', fontWeight: 600 }}>--</span>
                      )}
                    </td>

                    {/* Actions: Toggle Health & Inspect */}
                    <td style={{ padding: '12px 14px', textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                        {onToggleHealth && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggle(p.provider, p.isHealthy);
                            }}
                            disabled={togglingProvider === p.provider}
                            title={p.isHealthy ? 'Mark provider offline to test failover' : 'Mark provider healthy'}
                            style={{
                              backgroundColor: p.isHealthy ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.15)',
                              color: p.isHealthy ? '#f87171' : '#34d399',
                              border: `1px solid ${p.isHealthy ? '#ef444450' : '#10b98150'}`,
                              borderRadius: '4px',
                              padding: '3px 8px',
                              fontSize: '11px',
                              fontWeight: 600,
                              cursor: togglingProvider === p.provider ? 'not-allowed' : 'pointer',
                            }}
                          >
                            {togglingProvider === p.provider ? '...' : p.isHealthy ? 'Disable' : 'Enable'}
                          </button>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedProviderDetail(isSelected ? null : p);
                          }}
                          style={{
                            backgroundColor: isSelected ? '#38bdf8' : '#1e293b',
                            color: isSelected ? '#0f172a' : '#f8fafc',
                            border: '1px solid #334155',
                            borderRadius: '4px',
                            padding: '3px 8px',
                            fontSize: '11px',
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          {isSelected ? 'Close' : 'Inspect'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Selected Provider Popover / Inspection Drawer */}
      {selectedProviderDetail && (
        <div
          style={{
            padding: '18px 20px',
            backgroundColor: '#1e293b',
            borderRadius: '10px',
            border: '1px solid #38bdf8',
            fontSize: '12px',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '12px',
              marginBottom: '14px',
              paddingBottom: '10px',
              borderBottom: '1px solid #334155',
            }}
          >
            <div>
              <span style={{ color: '#38bdf8', fontWeight: 700, fontSize: '15px' }}>
                {selectedProviderDetail.displayName} Telemetry &amp; Verification Sources:
              </span>{' '}
              <span style={{ color: '#e2e8f0' }}>{selectedProviderDetail.updateFrequencyDescription}</span>
              <span style={{ color: '#94a3b8', marginLeft: '8px' }}>
                (Last sync: {new Date(selectedProviderDetail.lastSyncedAt).toLocaleTimeString()})
              </span>
            </div>

            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {selectedProviderDetail.websiteUrl && (
                <a
                  href={selectedProviderDetail.websiteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    backgroundColor: '#0f172a',
                    color: '#38bdf8',
                    border: '1px solid #0284c7',
                    borderRadius: '4px',
                    padding: '4px 9px',
                    fontSize: '11px',
                    fontWeight: 600,
                    textDecoration: 'none',
                  }}
                >
                  🌐 Official Portal
                </a>
              )}
              {selectedProviderDetail.pricingUrl && (
                <a
                  href={selectedProviderDetail.pricingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    backgroundColor: '#0f172a',
                    color: '#34d399',
                    border: '1px solid #059669',
                    borderRadius: '4px',
                    padding: '4px 9px',
                    fontSize: '11px',
                    fontWeight: 600,
                    textDecoration: 'none',
                  }}
                >
                  💵 Pricing Sheet
                </a>
              )}
              {selectedProviderDetail.billingUrl && (
                <a
                  href={selectedProviderDetail.billingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    backgroundColor: '#0f172a',
                    color: '#fbbf24',
                    border: '1px solid #d97706',
                    borderRadius: '4px',
                    padding: '4px 9px',
                    fontSize: '11px',
                    fontWeight: 600,
                    textDecoration: 'none',
                  }}
                >
                  💳 Billing Console
                </a>
              )}
              <button
                onClick={() => setSelectedProviderDetail(null)}
                style={{
                  backgroundColor: '#334155',
                  color: '#f8fafc',
                  border: 'none',
                  borderRadius: '4px',
                  padding: '4px 9px',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                ✕ Close
              </button>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '14px' }}>
            <div>
              <div style={{ color: '#94a3b8', fontWeight: 600, marginBottom: '4px' }}>
                Preemption &amp; Spot Notice Window:
              </div>
              <div style={{ color: '#f8fafc' }}>
                {selectedProviderDetail.spotPolicy?.description || selectedProviderDetail.interruptionNoticeWindow}
              </div>
            </div>

            <div>
              <div style={{ color: '#94a3b8', fontWeight: 600, marginBottom: '4px' }}>
                Pricing Update Cadence:
              </div>
              <div style={{ color: '#f8fafc' }}>
                {selectedProviderDetail.cadenceExplanation ||
                  `Polled dynamically every ~${formatCadenceInterval(selectedProviderDetail.estimatedUpdateIntervalSec)}.`}
              </div>
            </div>

            <div>
              <div style={{ color: '#94a3b8', fontWeight: 600, marginBottom: '4px' }}>
                Direct Verification Terminal Command:
              </div>
              <code
                style={{
                  display: 'block',
                  backgroundColor: '#0f172a',
                  padding: '6px 8px',
                  borderRadius: '4px',
                  color: '#38bdf8',
                  fontSize: '11px',
                  overflowX: 'auto',
                }}
              >
                curl -H &quot;x-tenant-id: tenant-default&quot; http://localhost:3000/v1/finops/pricing-history?provider={selectedProviderDetail.provider}
              </code>
            </div>
          </div>

          {/* If Provider has an error or failure trace, render it prominently in the drawer */}
          {(() => {
            const audit = syncAudits.find(
              (a) => a.provider.toLowerCase() === selectedProviderDetail.provider.toLowerCase()
            );
            const err = audit?.error || (audit?.details?.error as string);
            if (!err && selectedProviderDetail.isSynced) return null;
            return (
              <div
                style={{
                  backgroundColor: '#180a0a',
                  border: '1px solid #7f1d1d',
                  borderRadius: '8px',
                  padding: '12px 14px',
                  marginTop: '12px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', flexWrap: 'wrap', gap: '8px' }}>
                  <span style={{ fontSize: '11px', fontWeight: 700, color: '#f87171', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>⚠️</span>
                    <span>Latest Synchronization Error Trace:</span>
                  </span>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    {onRefreshSync && (
                      <button
                        onClick={() => onRefreshSync()}
                        disabled={isSyncing}
                        style={{
                          backgroundColor: '#2563eb',
                          color: '#ffffff',
                          border: 'none',
                          borderRadius: '4px',
                          padding: '3px 8px',
                          fontSize: '10.5px',
                          fontWeight: 600,
                          cursor: isSyncing ? 'not-allowed' : 'pointer',
                        }}
                      >
                        {isSyncing ? 'Syncing...' : '↻ Retry Sync'}
                      </button>
                    )}
                    <button
                      onClick={() => setShowTracesModal(true)}
                      style={{
                        backgroundColor: '#7f1d1d',
                        color: '#fca5a5',
                        border: '1px solid #ef4444',
                        borderRadius: '4px',
                        padding: '3px 8px',
                        fontSize: '10.5px',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      Open Full Trace Popup
                    </button>
                  </div>
                </div>
                <div
                  style={{
                    fontFamily: 'monospace',
                    fontSize: '11px',
                    color: '#fca5a5',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                    lineHeight: '1.4',
                  }}
                >
                  {err || 'Provider reported out of sync or failed live catalog verification.'}
                </div>
                {Boolean(audit?.details?.endpoint) && (
                  <div style={{ marginTop: '6px', fontSize: '10px', color: '#94a3b8' }}>
                    Endpoint: <code style={{ color: '#38bdf8' }}>{String(audit?.details?.endpoint)}</code>
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {/* Modal Popup for Full Multi-Cloud Sync Traces & Logs */}
      <SyncTracesModal
        isOpen={showTracesModal}
        onClose={() => setShowTracesModal(false)}
        syncAudits={syncAudits}
        onRetrySync={onRefreshSync}
        isSyncing={isSyncing}
      />
    </div>
  );
}
