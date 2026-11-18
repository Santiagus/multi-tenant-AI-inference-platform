import { useMemo, useState, type CSSProperties } from 'react';
import { DEFAULT_PROVIDER_FLEET, formatCadenceInterval } from '../finops/ProviderFleetBar';
import { SyncTracesModal } from '../finops/SyncTracesModal';
import { SortableHeader, genericSort, type SortDirection } from '../common/SortableHeader';
import {
  ProviderDetailModal,
  type ProviderDetailRecord,
} from './ProviderDetailModal';
import type {
  PricingModalityBadge,
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

type ProviderSortKey =
  | 'provider'
  | 'sync'
  | 'cadence'
  | 'modalities'
  | 'preemption'
  | 'balance';

const ALL_MODALITIES: PricingModalityBadge[] = [
  'spot',
  'on_demand',
  'serverless',
  'token_factory',
  'pay_per_call',
  'local',
];

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
  const [modalityFilter, setModalityFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [togglingProvider, setTogglingProvider] = useState<string | null>(null);
  const [showTracesModal, setShowTracesModal] = useState(false);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<ProviderSortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDirection>('asc');

  const fleetProviders = useMemo((): ProviderDetailRecord[] => {
    return DEFAULT_PROVIDER_FLEET.map((p) => {
      const audit = syncAudits.find((a) => a.provider.toLowerCase() === p.provider.toLowerCase());
      const balanceEntry = providerBalances ? providerBalances[p.provider.toLowerCase()] : undefined;
      const isHealthy =
        providers[p.provider] !== undefined ? providers[p.provider].healthy !== false : p.isHealthy;

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
          creditType = balanceEntry.creditType;
        }
      } else if (audit && (audit as { availableCreditsUsd?: number }).availableCreditsUsd !== undefined) {
        liveBalanceUsd = (audit as { availableCreditsUsd?: number }).availableCreditsUsd ?? null;
        balanceStatus =
          (audit as { balanceStatus?: string }).balanceStatus ||
          (liveBalanceUsd !== null ? 'LIVE_VERIFIED' : 'UNKNOWN');
      }

      const isFailedAudit = audit?.status === 'FAILED' || audit?.status === 'ERROR';
      const isStale = p.syncStatus === 'stale';
      const isSynced = isHealthy && !isFailedAudit && !isStale;
      const syncAuditStatus = audit?.status ?? null;
      const lastSyncedAt = audit?.syncedAt || p.lastSyncedAt;
      const syncedAtLabel = lastSyncedAt ? new Date(lastSyncedAt).toLocaleString() : 'never';

      // LIVE = operational health (routable). SUCCESS = sync-job audit result.
      // A successful audit confirms LIVE; it does not replace LIVE as a separate badge.
      let syncStateLabel = 'LIVE';
      let syncTooltip =
        'LIVE = provider is healthy and routable.\n' +
        'SUCCESS = last pricing/catalog sync job completed.\n' +
        'No sync audit yet — run Sync Fleet to record SUCCESS and confirm LIVE.';

      if (!isHealthy) {
        syncStateLabel = 'OFFLINE';
        syncTooltip =
          'OFFLINE = provider marked unhealthy for routing.\n' +
          (syncAuditStatus
            ? `Last sync audit: ${syncAuditStatus} at ${syncedAtLabel}.`
            : 'No sync audit recorded.');
      } else if (isFailedAudit) {
        syncStateLabel = 'SYNC_ERROR';
        syncTooltip =
          `SYNC_ERROR = last sync audit was ${syncAuditStatus}.\n` +
          'LIVE was not confirmed because catalog sync failed.\n' +
          `Audited at ${syncedAtLabel}.`;
      } else if (isStale) {
        syncStateLabel = 'STALE';
        syncTooltip =
          'STALE = catalog is older than the expected cadence window.\n' +
          (syncAuditStatus
            ? `Last sync audit: ${syncAuditStatus} at ${syncedAtLabel}.`
            : `Last known sync: ${syncedAtLabel}.`);
      } else if (syncAuditStatus === 'SUCCESS' || syncAuditStatus === 'SKIPPED') {
        syncStateLabel = 'LIVE';
        syncTooltip =
          'LIVE = provider is healthy and routable (updated after sync).\n' +
          `Last sync audit: ${syncAuditStatus} at ${syncedAtLabel}.\n` +
          'SUCCESS/SKIPPED is the sync-job result — it confirms LIVE; it is not a separate final badge.';
      } else if (syncAuditStatus) {
        syncStateLabel = syncAuditStatus;
        syncTooltip =
          `Sync audit status: ${syncAuditStatus} at ${syncedAtLabel}.\n` +
          'LIVE = routable health · SUCCESS = sync job completed.';
      }

      return {
        ...p,
        isHealthy,
        isSynced,
        syncStateLabel,
        syncTooltip,
        syncAuditStatus,
        liveBalanceUsd,
        balanceStatus,
        creditType,
        lastSyncedAt,
        updateFrequencyDescription: audit?.updateFrequencyDescription || p.updateFrequencyDescription,
        estimatedUpdateIntervalSec: audit?.estimatedUpdateIntervalSec || p.estimatedUpdateIntervalSec,
        updateCadenceCategory: audit?.updateCadenceCategory || p.updateCadenceCategory,
      };
    });
  }, [syncAudits, providerBalances, providers]);

  const displayedProviders = useMemo(() => {
    const filtered = fleetProviders.filter((p) => {
      if (selectedFilter === 'synced' && !p.isSynced) return false;
      if (selectedFilter === 'unsynced' && p.isSynced) return false;
      if (selectedCadence !== 'all' && p.updateCadenceCategory !== selectedCadence) return false;
      if (
        modalityFilter !== 'all' &&
        !p.allowedPricingModels.includes(modalityFilter as PricingModalityBadge)
      ) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName =
          p.displayName.toLowerCase().includes(q) || p.provider.toLowerCase().includes(q);
        if (!matchesName) return false;
      }
      return true;
    });

    return genericSort(filtered, sortKey, sortDir, (item, key) => {
      if (key === 'provider') return item.displayName;
      if (key === 'sync') return item.syncStateLabel || '';
      if (key === 'cadence') return item.updateCadenceCategory;
      if (key === 'modalities') return item.allowedPricingModels.join(',');
      if (key === 'preemption') {
        return item.spotPolicy?.noticeWindowLabel || item.interruptionNoticeWindow;
      }
      if (key === 'balance') {
        if (item.liveBalanceUsd !== null && item.liveBalanceUsd !== undefined) return item.liveBalanceUsd;
        if (item.creditType === 'postpaid_invoice' || item.balanceStatus === 'POSTPAID_INVOICE') return -1;
        return -2;
      }
      return (item as unknown as Record<string, unknown>)[key];
    });
  }, [
    fleetProviders,
    selectedFilter,
    selectedCadence,
    modalityFilter,
    searchQuery,
    sortKey,
    sortDir,
  ]);

  const selectedProvider = useMemo(
    () => fleetProviders.find((p) => p.provider === selectedProviderId) ?? null,
    [fleetProviders, selectedProviderId]
  );

  const handleSort = (column: ProviderSortKey) => {
    if (sortKey === column) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(column);
      setSortDir('asc');
    }
  };

  const handleToggle = async (name: string, healthy: boolean) => {
    if (!onToggleHealth) return;
    setTogglingProvider(name);
    try {
      await onToggleHealth(name, healthy);
    } finally {
      setTogglingProvider(null);
    }
  };

  const headerFilterStyle: CSSProperties = {
    width: '100%',
    maxWidth: '100%',
    boxSizing: 'border-box',
    backgroundColor: '#0f172a',
    color: '#e2e8f0',
    border: '1px solid #334155',
    padding: '3px 4px',
    borderRadius: '4px',
    fontSize: '10px',
    outline: 'none',
    cursor: 'pointer',
  };

  return (
    <div
      className="dashboard-container-1200"
      style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        <h2 style={{ fontSize: '20px', fontWeight: 700, color: '#f8fafc', margin: 0 }}>
          Multi-Cloud Provider Fleet &amp; Real-Time Sync Status
        </h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => setShowTracesModal(true)}
            style={{
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
            Sync Traces
          </button>
          {onRefreshSync && (
            <button
              type="button"
              onClick={() => void onRefreshSync()}
              disabled={isSyncing}
              style={{
                backgroundColor: '#3b82f6',
                color: '#ffffff',
                border: 'none',
                borderRadius: '6px',
                padding: '6px 12px',
                fontSize: '12px',
                fontWeight: 600,
                cursor: isSyncing ? 'not-allowed' : 'pointer',
              }}
            >
              {isSyncing ? 'Syncing...' : 'Sync Fleet'}
            </button>
          )}
        </div>
      </div>

      <div
        style={{
          backgroundColor: '#0f172a',
          borderRadius: '12px',
          border: '1px solid #1e293b',
          overflow: 'hidden',
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
        }}
      >
        <div style={{ overflowX: 'auto' }}>
          <table
            style={{
              width: '100%',
              tableLayout: 'fixed',
              borderCollapse: 'collapse',
              textAlign: 'left',
              fontSize: '12px',
            }}
          >
            <thead>
              <tr style={{ backgroundColor: '#1e293b', borderBottom: '1px solid #334155', color: '#94a3b8' }}>
                <SortableHeader
                  column="provider"
                  currentSortKey={sortKey}
                  currentSortDir={sortDir}
                  onSort={handleSort}
                  style={{ padding: '8px 6px', width: '16%' }}
                  filter={
                    <input
                      type="text"
                      placeholder="Search..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      style={{ ...headerFilterStyle, cursor: 'text' }}
                      aria-label="Filter by provider name"
                    />
                  }
                >
                  Provider
                </SortableHeader>
                <SortableHeader
                  column="sync"
                  currentSortKey={sortKey}
                  currentSortDir={sortDir}
                  onSort={handleSort}
                  style={{ padding: '8px 6px', width: '14%' }}
                  filter={
                    <select
                      value={selectedFilter}
                      onChange={(e) =>
                        setSelectedFilter(e.target.value as 'all' | 'synced' | 'unsynced')
                      }
                      style={headerFilterStyle}
                      aria-label="Filter by sync status"
                    >
                      <option value="all">All</option>
                      <option value="synced">Synced</option>
                      <option value="unsynced">Unsynced</option>
                    </select>
                  }
                >
                  Sync &amp; Health
                </SortableHeader>
                <SortableHeader
                  column="cadence"
                  currentSortKey={sortKey}
                  currentSortDir={sortDir}
                  onSort={handleSort}
                  style={{ padding: '8px 6px', width: '16%' }}
                  filter={
                    <select
                      value={selectedCadence}
                      onChange={(e) => setSelectedCadence(e.target.value)}
                      style={headerFilterStyle}
                      aria-label="Filter by cadence"
                    >
                      <option value="all">All</option>
                      <option value="realtime_auction">Real-Time Auction</option>
                      <option value="dynamic_shifts">Dynamic Shifts</option>
                      <option value="scheduled">Scheduled</option>
                    </select>
                  }
                >
                  Cadence
                </SortableHeader>
                <SortableHeader
                  column="modalities"
                  currentSortKey={sortKey}
                  currentSortDir={sortDir}
                  onSort={handleSort}
                  style={{ padding: '8px 6px', width: '22%' }}
                  filter={
                    <select
                      value={modalityFilter}
                      onChange={(e) => setModalityFilter(e.target.value)}
                      style={headerFilterStyle}
                      aria-label="Filter by modality"
                    >
                      <option value="all">All</option>
                      {ALL_MODALITIES.map((mode) => (
                        <option key={mode} value={mode}>
                          {mode.replace('_', ' ')}
                        </option>
                      ))}
                    </select>
                  }
                >
                  Modalities
                </SortableHeader>
                <SortableHeader
                  column="preemption"
                  currentSortKey={sortKey}
                  currentSortDir={sortDir}
                  onSort={handleSort}
                  style={{ padding: '8px 6px', width: '16%' }}
                >
                  Preemption Policy
                </SortableHeader>
                <SortableHeader
                  column="balance"
                  currentSortKey={sortKey}
                  currentSortDir={sortDir}
                  onSort={handleSort}
                  style={{ padding: '8px 6px', width: '16%' }}
                >
                  Balance / Credits
                </SortableHeader>
              </tr>
            </thead>
            <tbody>
              {displayedProviders.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: '24px', textAlign: 'center', color: '#94a3b8' }}>
                    No providers match the selected filters. Click a row for provider details.
                  </td>
                </tr>
              ) : (
                displayedProviders.map((p, idx) => {
                  const cadenceColor =
                    p.updateCadenceCategory === 'realtime_auction'
                      ? '#10b981'
                      : p.updateCadenceCategory === 'dynamic_shifts'
                        ? '#38bdf8'
                        : '#a78bfa';

                  return (
                    <tr
                      key={p.provider}
                      onClick={() => setSelectedProviderId(p.provider)}
                      style={{
                        borderBottom: '1px solid #1e293b',
                        backgroundColor: !p.isSynced
                          ? 'rgba(239, 68, 68, 0.05)'
                          : idx % 2 === 0
                            ? 'transparent'
                            : '#1e293b20',
                        cursor: 'pointer',
                        transition: 'background-color 0.15s ease',
                      }}
                    >
                      <td style={{ padding: '10px 8px', fontWeight: 700, color: '#f8fafc' }}>
                        {p.displayName}
                      </td>

                      <td style={{ padding: '10px 8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                          <span
                            title={p.syncTooltip}
                            style={{
                              backgroundColor: p.isSynced
                                ? 'rgba(16, 185, 129, 0.15)'
                                : 'rgba(239, 68, 68, 0.15)',
                              color: p.isSynced ? '#34d399' : '#f87171',
                              padding: '2px 7px',
                              borderRadius: '4px',
                              fontSize: '11px',
                              fontWeight: 700,
                              textTransform: 'uppercase',
                              border: `1px solid ${
                                p.isSynced ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'
                              }`,
                              cursor: 'help',
                            }}
                          >
                            {p.syncStateLabel}
                          </span>
                          <a
                            href={
                              p.syncDocUrl ||
                              p.cadenceDocUrl ||
                              p.spotPricingUrl ||
                              p.pricingUrl ||
                              p.websiteUrl
                            }
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            title={`Polling cadence ~${formatCadenceInterval(p.estimatedUpdateIntervalSec)}`}
                            style={{
                              color: '#38bdf8',
                              fontSize: '11px',
                              textDecoration: 'none',
                              fontWeight: 600,
                              borderBottom: '1px dotted rgba(56, 189, 248, 0.4)',
                            }}
                          >
                            ~{formatCadenceInterval(p.estimatedUpdateIntervalSec)}
                          </a>
                        </div>
                      </td>

                      <td style={{ padding: '10px 8px' }}>
                        <span
                          style={{
                            fontSize: '10px',
                            fontWeight: 700,
                            padding: '2px 6px',
                            borderRadius: '4px',
                            backgroundColor: `${cadenceColor}20`,
                            color: cadenceColor,
                            textTransform: 'uppercase',
                            border: `1px solid ${cadenceColor}40`,
                          }}
                        >
                          {p.updateCadenceCategory.replace('_', ' ')}
                        </span>
                      </td>

                      <td style={{ padding: '10px 8px' }}>
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

                      <td style={{ padding: '10px 8px' }}>
                        {p.spotPolicy ? (
                          <span style={{ fontSize: '11px', color: '#fbbf24' }}>
                            <strong>{p.spotPolicy.noticeWindowLabel}</strong>
                            <span style={{ color: '#94a3b8', fontSize: '10px', marginLeft: '4px' }}>
                              ({p.spotPolicy.pricingTypeLabel})
                            </span>
                          </span>
                        ) : (
                          <span style={{ color: '#94a3b8', fontSize: '11px' }}>
                            {p.interruptionNoticeWindow}
                          </span>
                        )}
                      </td>

                      <td style={{ padding: '10px 8px', fontSize: '11px' }}>
                        {p.liveBalanceUsd !== null && p.liveBalanceUsd !== undefined ? (
                          <span style={{ color: '#34d399', fontWeight: 700 }}>
                            ${p.liveBalanceUsd.toFixed(2)}
                          </span>
                        ) : p.provider === 'local_pytorch' ? (
                          <span style={{ color: '#94a3b8' }}>$0.00 (Local HW)</span>
                        ) : p.creditType === 'postpaid_invoice' ||
                          p.balanceStatus === 'POSTPAID_INVOICE' ? (
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
                          <span style={{ color: '#64748b', fontWeight: 600 }}>—</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ProviderDetailModal
        provider={selectedProvider}
        isOpen={selectedProviderId !== null}
        onClose={() => setSelectedProviderId(null)}
        syncAudits={syncAudits}
        onToggleHealth={onToggleHealth ? handleToggle : undefined}
        onRefreshSync={onRefreshSync}
        onOpenTraces={() => setShowTracesModal(true)}
        isSyncing={isSyncing}
        isToggling={togglingProvider === selectedProviderId}
      />

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
