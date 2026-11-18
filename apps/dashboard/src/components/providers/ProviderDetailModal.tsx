import type { CSSProperties } from 'react';
import { formatCadenceInterval } from '../finops/ProviderFleetBar';
import type { PricingSyncAudit, ProviderFleetStatus } from '../../types';

export type ProviderDetailRecord = ProviderFleetStatus & {
  liveBalanceUsd?: number | null;
  balanceStatus?: string;
  isSynced?: boolean;
  syncStateLabel?: string;
  syncTooltip?: string;
  syncAuditStatus?: string | null;
};

export interface ProviderInfraMeta {
  vramLabel: string;
  supportsVpc: boolean;
  marginalRateLabel: string;
}

export const PROVIDER_INFRA_METADATA: Record<string, ProviderInfraMeta> = {
  local_pytorch: { vramLabel: 'Local CUDA / CPU (detected at runtime)', supportsVpc: true, marginalRateLabel: '$0.00 / 1k tok' },
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

interface ProviderDetailModalProps {
  provider: ProviderDetailRecord | null;
  isOpen: boolean;
  onClose: () => void;
  syncAudits: PricingSyncAudit[];
  onToggleHealth?: (provider: string, healthy: boolean) => Promise<void>;
  onRefreshSync?: () => Promise<void> | void;
  onOpenTraces?: () => void;
  isSyncing?: boolean;
  isToggling?: boolean;
}

const linkBtnStyle: CSSProperties = {
  backgroundColor: '#0f172a',
  borderRadius: '6px',
  padding: '6px 10px',
  fontSize: '12px',
  fontWeight: 600,
  textDecoration: 'none',
  display: 'inline-flex',
  alignItems: 'center',
};

const metaLabelStyle: CSSProperties = {
  fontSize: '11px',
  color: '#64748b',
  textTransform: 'uppercase',
  fontWeight: 600,
  marginBottom: '4px',
};

const metaValueStyle: CSSProperties = {
  fontSize: '13px',
  color: '#f8fafc',
  fontWeight: 600,
};

export function ProviderDetailModal({
  provider,
  isOpen,
  onClose,
  syncAudits,
  onToggleHealth,
  onRefreshSync,
  onOpenTraces,
  isSyncing = false,
  isToggling = false,
}: ProviderDetailModalProps) {
  if (!isOpen || !provider) return null;

  const infra = PROVIDER_INFRA_METADATA[provider.provider];
  const audit = syncAudits.find(
    (a) => a.provider.toLowerCase() === provider.provider.toLowerCase()
  );
  const syncError = audit?.error || (audit?.details?.error as string | undefined);
  const showSyncError = Boolean(syncError) || provider.isSynced === false;

  const balanceLabel =
    provider.liveBalanceUsd !== null && provider.liveBalanceUsd !== undefined
      ? `$${provider.liveBalanceUsd.toFixed(2)} USD`
      : provider.provider === 'local_pytorch'
        ? '$0.00 (Local HW)'
        : provider.creditType === 'postpaid_invoice' || provider.balanceStatus === 'POSTPAID_INVOICE'
          ? 'Postpaid Invoice'
          : '—';

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
        padding: '16px',
      }}
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${provider.displayName} provider details`}
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: '#0f172a',
          borderRadius: '14px',
          border: '1px solid #334155',
          width: '100%',
          maxWidth: '720px',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '18px 24px',
            borderBottom: '1px solid #1e293b',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: '16px', fontWeight: 700, color: '#f8fafc', margin: 0 }}>
              {provider.displayName}
            </h2>
            <span
              title={
                provider.syncTooltip ||
                'LIVE = provider healthy and routable. SUCCESS = last pricing/catalog sync job completed.'
              }
              style={{
                backgroundColor: provider.isSynced ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                color: provider.isSynced ? '#34d399' : '#f87171',
                padding: '2px 8px',
                borderRadius: '4px',
                fontSize: '11px',
                fontWeight: 700,
                textTransform: 'uppercase',
                border: `1px solid ${provider.isSynced ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                cursor: 'help',
              }}
            >
              {provider.syncStateLabel || (provider.isSynced ? 'LIVE' : 'OFFLINE')}
            </span>
            {provider.syncAuditStatus && (
              <span
                title="Pricing/catalog sync job outcome from the latest audit record"
                style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  color: '#94a3b8',
                  cursor: 'help',
                }}
              >
                sync: {provider.syncAuditStatus}
              </span>
            )}
            <span
              style={{
                fontSize: '11px',
                fontWeight: 600,
                color: provider.isHealthy ? '#34d399' : '#f87171',
              }}
            >
              {provider.isHealthy ? 'Healthy' : 'Unhealthy'}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close provider details"
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94a3b8',
              fontSize: '18px',
              cursor: 'pointer',
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ padding: '24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: '12px',
              backgroundColor: '#1e293b',
              padding: '16px',
              borderRadius: '10px',
            }}
          >
            <div>
              <div style={metaLabelStyle}>Provider ID</div>
              <div style={{ ...metaValueStyle, fontFamily: 'monospace', fontSize: '12px' }}>{provider.provider}</div>
            </div>
            <div>
              <div style={metaLabelStyle}>Sync Cadence</div>
              <div style={metaValueStyle}>
                {provider.updateCadenceCategory.replace('_', ' ')} (~
                {formatCadenceInterval(provider.estimatedUpdateIntervalSec)})
              </div>
            </div>
            <div>
              <div style={metaLabelStyle}>Last Synced</div>
              <div style={metaValueStyle}>{new Date(provider.lastSyncedAt).toLocaleString()}</div>
            </div>
            <div>
              <div style={metaLabelStyle}>Balance / Credits</div>
              <div style={{ ...metaValueStyle, color: '#34d399' }}>{balanceLabel}</div>
            </div>
            <div>
              <div style={metaLabelStyle}>Hardware</div>
              <div style={metaValueStyle}>{infra?.vramLabel || 'Cloud Compute'}</div>
            </div>
            <div>
              <div style={metaLabelStyle}>Network</div>
              <div style={metaValueStyle}>{infra?.supportsVpc ? 'VPC / Isolated supported' : 'Public endpoint'}</div>
            </div>
            <div>
              <div style={metaLabelStyle}>Marginal Rate</div>
              <div style={metaValueStyle}>{infra?.marginalRateLabel || '—'}</div>
            </div>
            <div>
              <div style={metaLabelStyle}>Preemption</div>
              <div style={metaValueStyle}>
                {provider.spotPolicy?.noticeWindowLabel || provider.interruptionNoticeWindow}
              </div>
            </div>
          </div>

          <div>
            <div style={metaLabelStyle}>Modalities</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' }}>
              {provider.allowedPricingModels.map((mode) => (
                <span
                  key={mode}
                  style={{
                    fontSize: '11px',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    backgroundColor: 'rgba(148, 163, 184, 0.15)',
                    color: '#cbd5e1',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                  }}
                >
                  {mode.replace('_', ' ')}
                </span>
              ))}
            </div>
          </div>

          <div>
            <div style={metaLabelStyle}>Pricing Update Cadence</div>
            <div style={{ fontSize: '13px', color: '#e2e8f0', lineHeight: 1.5 }}>
              {provider.cadenceExplanation ||
                provider.updateFrequencyDescription ||
                `Polled dynamically every ~${formatCadenceInterval(provider.estimatedUpdateIntervalSec)}.`}
            </div>
          </div>

          <div>
            <div style={metaLabelStyle}>Preemption & Spot Notice</div>
            <div style={{ fontSize: '13px', color: '#e2e8f0', lineHeight: 1.5 }}>
              {provider.spotPolicy?.description || provider.interruptionNoticeWindow}
            </div>
          </div>

          <div>
            <div style={metaLabelStyle}>Verification</div>
            <code
              style={{
                display: 'block',
                backgroundColor: '#1e293b',
                padding: '10px 12px',
                borderRadius: '6px',
                color: '#38bdf8',
                fontSize: '11px',
                overflowX: 'auto',
                marginTop: '6px',
              }}
            >
              curl -H &quot;x-tenant-id: tenant-default&quot; /v1/finops/pricing-history?provider=
              {provider.provider}
            </code>
          </div>

          {showSyncError && (
            <div
              style={{
                backgroundColor: '#180a0a',
                border: '1px solid #7f1d1d',
                borderRadius: '8px',
                padding: '12px 14px',
              }}
            >
              <div style={{ fontSize: '12px', fontWeight: 700, color: '#f87171', marginBottom: '8px' }}>
                Synchronization Error
              </div>
              <div
                style={{
                  fontFamily: 'monospace',
                  fontSize: '11px',
                  color: '#fca5a5',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                  lineHeight: 1.4,
                }}
              >
                {syncError || 'Provider reported out of sync or failed live catalog verification.'}
              </div>
              {Boolean(audit?.details?.endpoint) && (
                <div style={{ marginTop: '6px', fontSize: '10px', color: '#94a3b8' }}>
                  Endpoint:{' '}
                  <code style={{ color: '#38bdf8' }}>{String(audit?.details?.endpoint)}</code>
                </div>
              )}
            </div>
          )}
        </div>

        <div
          style={{
            padding: '14px 24px',
            borderTop: '1px solid #1e293b',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '8px',
            alignItems: 'center',
          }}
        >
          {provider.websiteUrl && (
            <a
              href={provider.websiteUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ ...linkBtnStyle, color: '#38bdf8', border: '1px solid #0284c7' }}
            >
              Official Portal
            </a>
          )}
          {provider.pricingUrl && (
            <a
              href={provider.pricingUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ ...linkBtnStyle, color: '#34d399', border: '1px solid #059669' }}
            >
              Pricing Sheet
            </a>
          )}
          {provider.billingUrl && (
            <a
              href={provider.billingUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ ...linkBtnStyle, color: '#fbbf24', border: '1px solid #d97706' }}
            >
              Billing Console
            </a>
          )}

          <div style={{ flex: 1 }} />

          {onOpenTraces && (
            <button
              type="button"
              onClick={onOpenTraces}
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
          )}
          {onRefreshSync && (
            <button
              type="button"
              onClick={() => void onRefreshSync()}
              disabled={isSyncing}
              style={{
                backgroundColor: '#2563eb',
                color: '#ffffff',
                border: 'none',
                borderRadius: '6px',
                padding: '6px 12px',
                fontSize: '12px',
                fontWeight: 600,
                cursor: isSyncing ? 'not-allowed' : 'pointer',
              }}
            >
              {isSyncing ? 'Syncing...' : 'Retry Sync'}
            </button>
          )}
          {onToggleHealth && (
            <button
              type="button"
              onClick={() => void onToggleHealth(provider.provider, !provider.isHealthy)}
              disabled={isToggling}
              title={
                provider.isHealthy
                  ? 'Mark provider offline to test failover'
                  : 'Mark provider healthy'
              }
              style={{
                backgroundColor: provider.isHealthy ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.15)',
                color: provider.isHealthy ? '#f87171' : '#34d399',
                border: `1px solid ${provider.isHealthy ? '#ef444450' : '#10b98150'}`,
                borderRadius: '6px',
                padding: '6px 12px',
                fontSize: '12px',
                fontWeight: 600,
                cursor: isToggling ? 'not-allowed' : 'pointer',
              }}
            >
              {isToggling ? '...' : provider.isHealthy ? 'Disable (Failover)' : 'Enable'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
