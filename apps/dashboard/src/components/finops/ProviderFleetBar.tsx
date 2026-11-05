import { useState } from 'react';
import type { ProviderFleetStatus, PricingSyncAudit } from '../../types';

interface ProviderFleetBarProps {
  syncAudits: PricingSyncAudit[];
  onRefreshSync?: () => void;
  isSyncing?: boolean;
}

export const DEFAULT_PROVIDER_FLEET: ProviderFleetStatus[] = [
  {
    provider: 'runpod',
    displayName: 'RunPod',
    isHealthy: true,
    syncStatus: 'live',
    lastSyncedAt: new Date(Date.now() - 90 * 1000).toISOString(),
    updateCadenceCategory: 'realtime_auction',
    updateFrequencyDescription: 'Live Spot Auction & Community Pods',
    estimatedUpdateIntervalSec: 120,
    allowedPricingModels: ['on_demand', 'spot', 'serverless'],
    availableCreditsUsd: 142.5,
    creditType: 'prepaid_credits',
    interruptionRiskTier: '<5% risk',
    interruptionNoticeWindow: '2-min grace notice',
  },
  {
    provider: 'vast_ai',
    displayName: 'Vast.ai',
    isHealthy: true,
    syncStatus: 'live',
    lastSyncedAt: new Date(Date.now() - 45 * 1000).toISOString(),
    updateCadenceCategory: 'realtime_auction',
    updateFrequencyDescription: 'Unregulated Spot Bid & Auction Market',
    estimatedUpdateIntervalSec: 60,
    allowedPricingModels: ['on_demand', 'spot'],
    availableCreditsUsd: 84.2,
    creditType: 'prepaid_credits',
    interruptionRiskTier: '5-10% risk',
    interruptionNoticeWindow: 'Instant on outbid threshold',
  },
  {
    provider: 'baseten',
    displayName: 'Baseten',
    isHealthy: true,
    syncStatus: 'live',
    lastSyncedAt: new Date(Date.now() - 300 * 1000).toISOString(),
    updateCadenceCategory: 'dynamic_shifts',
    updateFrequencyDescription: 'Scale-to-Zero Micro-Metered Serverless',
    estimatedUpdateIntervalSec: 600,
    allowedPricingModels: ['serverless', 'on_demand'],
    availableCreditsUsd: 250.0,
    creditType: 'prepaid_credits',
    interruptionRiskTier: 'Guaranteed (0%)',
    interruptionNoticeWindow: 'Zero interruption (Dedicated)',
  },
  {
    provider: 'nebius',
    displayName: 'Nebius AI Studio',
    isHealthy: true,
    syncStatus: 'live',
    lastSyncedAt: new Date(Date.now() - 210 * 1000).toISOString(),
    updateCadenceCategory: 'dynamic_shifts',
    updateFrequencyDescription: 'Tier 3+ Neocloud Capacity & Preemptible',
    estimatedUpdateIntervalSec: 300,
    allowedPricingModels: ['on_demand', 'spot'],
    availableCreditsUsd: 120.0,
    creditType: 'prepaid_credits',
    interruptionRiskTier: '<5% risk',
    interruptionNoticeWindow: '30-sec SIGTERM notice',
  },
  {
    provider: 'jarvislabs',
    displayName: 'JarvisLabs',
    isHealthy: true,
    syncStatus: 'live',
    lastSyncedAt: new Date(Date.now() - 150 * 1000).toISOString(),
    updateCadenceCategory: 'realtime_auction',
    updateFrequencyDescription: 'Token Factory MaaS & Instant Pods',
    estimatedUpdateIntervalSec: 180,
    allowedPricingModels: ['token_factory', 'on_demand', 'spot'],
    availableCreditsUsd: 50.0,
    creditType: 'prepaid_credits',
    interruptionRiskTier: '<5% risk',
    interruptionNoticeWindow: '2-min grace notice',
  },
  {
    provider: 'fal',
    displayName: 'fal.ai',
    isHealthy: true,
    syncStatus: 'live',
    lastSyncedAt: new Date(Date.now() - 180 * 1000).toISOString(),
    updateCadenceCategory: 'dynamic_shifts',
    updateFrequencyDescription: 'Real-Time Diffusion & Media Inference',
    estimatedUpdateIntervalSec: 300,
    allowedPricingModels: ['pay_per_call'],
    availableCreditsUsd: 45.0,
    creditType: 'prepaid_credits',
    interruptionRiskTier: 'Guaranteed (0%)',
    interruptionNoticeWindow: 'Zero interruption (API)',
  },
  {
    provider: 'runware',
    displayName: 'Runware',
    isHealthy: true,
    syncStatus: 'live',
    lastSyncedAt: new Date(Date.now() - 240 * 1000).toISOString(),
    updateCadenceCategory: 'dynamic_shifts',
    updateFrequencyDescription: 'Shared Serverless Engine per Megapixel',
    estimatedUpdateIntervalSec: 300,
    allowedPricingModels: ['pay_per_call', 'serverless'],
    availableCreditsUsd: 35.0,
    creditType: 'prepaid_credits',
    interruptionRiskTier: 'Guaranteed (0%)',
    interruptionNoticeWindow: 'Zero interruption (API)',
  },
  {
    provider: 'bedrock',
    displayName: 'AWS Bedrock',
    isHealthy: true,
    syncStatus: 'live',
    lastSyncedAt: new Date(Date.now() - 900 * 1000).toISOString(),
    updateCadenceCategory: 'scheduled',
    updateFrequencyDescription: 'AWS Foundation Model Enterprise API',
    estimatedUpdateIntervalSec: 3600,
    allowedPricingModels: ['token_factory', 'on_demand'],
    availableCreditsUsd: null,
    creditType: 'postpaid_invoice',
    interruptionRiskTier: 'Guaranteed (0%)',
    interruptionNoticeWindow: 'Zero interruption (Enterprise SLA)',
  },
  {
    provider: 'sagemaker',
    displayName: 'AWS SageMaker',
    isHealthy: true,
    syncStatus: 'live',
    lastSyncedAt: new Date(Date.now() - 900 * 1000).toISOString(),
    updateCadenceCategory: 'scheduled',
    updateFrequencyDescription: 'Managed EKS / SageMaker GPU Endpoints',
    estimatedUpdateIntervalSec: 3600,
    allowedPricingModels: ['on_demand', 'spot'],
    availableCreditsUsd: null,
    creditType: 'postpaid_invoice',
    interruptionRiskTier: '<5% risk',
    interruptionNoticeWindow: '2-min AWS Spot warning',
  },
  {
    provider: 'local_pytorch',
    displayName: 'Local PyTorch (RTX 5070 Ti)',
    isHealthy: true,
    syncStatus: 'live',
    lastSyncedAt: new Date().toISOString(),
    updateCadenceCategory: 'realtime_auction',
    updateFrequencyDescription: 'Dedicated Workstation GPU & Worker',
    estimatedUpdateIntervalSec: 1,
    allowedPricingModels: ['local'],
    availableCreditsUsd: 0,
    creditType: 'zero_commitment',
    interruptionRiskTier: 'Guaranteed (0%)',
    interruptionNoticeWindow: 'Dedicated local process',
  },
];

export function ProviderFleetBar({
  syncAudits,
  onRefreshSync,
  isSyncing = false,
}: ProviderFleetBarProps) {
  const [selectedProviderDetail, setSelectedProviderDetail] = useState<ProviderFleetStatus | null>(null);

  // Merge dynamic sync audits with baseline providers
  const providers = DEFAULT_PROVIDER_FLEET.map((p) => {
    const audit = syncAudits.find((a) => a.provider.toLowerCase() === p.provider.toLowerCase());
    if (audit) {
      return {
        ...p,
        lastSyncedAt: audit.syncedAt,
        updateFrequencyDescription: audit.updateFrequencyDescription || p.updateFrequencyDescription,
        estimatedUpdateIntervalSec: audit.estimatedUpdateIntervalSec || p.estimatedUpdateIntervalSec,
        updateCadenceCategory: audit.updateCadenceCategory || p.updateCadenceCategory,
      };
    }
    return p;
  });

  const totalPrepaidCredits = providers.reduce(
    (acc, p) => acc + (p.availableCreditsUsd !== null ? p.availableCreditsUsd : 0),
    0
  );

  return (
    <div
      style={{
        backgroundColor: '#0f172a',
        borderRadius: '12px',
        border: '1px solid #1e293b',
        padding: '18px 20px',
        marginBottom: '24px',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
      }}
    >
      {/* Top Banner Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
          marginBottom: '16px',
          paddingBottom: '12px',
          borderBottom: '1px solid #1e293b',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div
            style={{
              width: '10px',
              height: '10px',
              borderRadius: '50%',
              backgroundColor: '#10b981',
              boxShadow: '0 0 10px #10b981',
            }}
          />
          <div>
            <span style={{ fontSize: '15px', fontWeight: 700, color: '#f8fafc' }}>
              Multi-Cloud Provider Fleet &amp; Real-Time Sync Status
            </span>
            <span
              style={{
                marginLeft: '10px',
                fontSize: '12px',
                color: '#94a3b8',
              }}
            >
              10 Managed Inference Engines Active
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>
              Neocloud Prepaid Pool
            </div>
            <div style={{ fontSize: '14px', fontWeight: 700, color: '#34d399' }}>
              ${totalPrepaidCredits.toFixed(2)}{' '}
              <span style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 400 }}>+ AWS Postpaid</span>
            </div>
          </div>

          {onRefreshSync && (
            <button
              onClick={onRefreshSync}
              disabled={isSyncing}
              style={{
                backgroundColor: '#1e293b',
                color: '#38bdf8',
                border: '1px solid #0284c7',
                borderRadius: '8px',
                padding: '6px 12px',
                fontSize: '12px',
                fontWeight: 600,
                cursor: isSyncing ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                transition: 'all 0.15s ease',
              }}
            >
              <span style={{ display: 'inline-block', transform: isSyncing ? 'rotate(180deg)' : 'none', transition: 'transform 0.5s' }}>
                ↻
              </span>
              {isSyncing ? 'Syncing...' : 'Sync Fleet'}
            </button>
          )}
        </div>
      </div>

      {/* Provider Fleet Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: '12px',
        }}
      >
        {providers.map((p) => {
          const isSelected = selectedProviderDetail?.provider === p.provider;
          const cadenceColor =
            p.updateCadenceCategory === 'realtime_auction'
              ? '#10b981'
              : p.updateCadenceCategory === 'dynamic_shifts'
                ? '#38bdf8'
                : '#a78bfa';

          return (
            <div
              key={p.provider}
              onClick={() => setSelectedProviderDetail(isSelected ? null : p)}
              style={{
                backgroundColor: isSelected ? 'rgba(56, 189, 248, 0.08)' : '#1e293b40',
                border: `1px solid ${isSelected ? '#38bdf8' : '#334155'}`,
                borderRadius: '8px',
                padding: '12px',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                if (!isSelected) e.currentTarget.style.borderColor = '#475569';
              }}
              onMouseLeave={(e) => {
                if (!isSelected) e.currentTarget.style.borderColor = '#334155';
              }}
            >
              {/* Row 1: Name and Health */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span
                    style={{
                      width: '6px',
                      height: '6px',
                      borderRadius: '50%',
                      backgroundColor: p.isHealthy ? '#10b981' : '#f87171',
                    }}
                  />
                  <span style={{ fontWeight: 700, fontSize: '13px', color: '#f8fafc' }}>
                    {p.displayName}
                  </span>
                </div>

                <span
                  style={{
                    fontSize: '10px',
                    fontWeight: 700,
                    padding: '2px 6px',
                    borderRadius: '4px',
                    backgroundColor: `${cadenceColor}20`,
                    color: cadenceColor,
                    textTransform: 'uppercase',
                  }}
                >
                  {p.updateCadenceCategory.replace('_', ' ')}
                </span>
              </div>

              {/* Row 2: Allowed Pricing Modalities Badges */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '10px' }}>
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
                              : mode === 'pay_per_call'
                                ? 'rgba(245, 158, 11, 0.15)'
                                : 'rgba(148, 163, 184, 0.15)',
                      color:
                        mode === 'spot'
                          ? '#34d399'
                          : mode === 'serverless'
                            ? '#22d3ee'
                            : mode === 'token_factory'
                              ? '#c084fc'
                              : mode === 'pay_per_call'
                                ? '#fbbf24'
                                : '#cbd5e1',
                      fontWeight: 600,
                    }}
                  >
                    {mode.replace('_', ' ')}
                  </span>
                ))}
              </div>

              {/* Row 3: Credits and Sync info */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontSize: '11px',
                  color: '#94a3b8',
                }}
              >
                <div>
                  {p.availableCreditsUsd !== null ? (
                    <span style={{ color: '#34d399', fontWeight: 600 }}>
                      ${p.availableCreditsUsd.toFixed(2)} credits
                    </span>
                  ) : p.creditType === 'postpaid_invoice' ? (
                    <span style={{ color: '#60a5fa', fontWeight: 500 }}>Direct AWS Invoice</span>
                  ) : (
                    <span style={{ color: '#94a3b8' }}>$0 Local HW</span>
                  )}
                </div>

                <div style={{ color: '#64748b' }}>
                  ~{Math.round(p.estimatedUpdateIntervalSec / 60)}m polling
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Selected Provider Popover Details */}
      {selectedProviderDetail && (
        <div
          style={{
            marginTop: '16px',
            padding: '12px 16px',
            backgroundColor: '#1e293b',
            borderRadius: '8px',
            border: '1px solid #38bdf8',
            fontSize: '12px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '12px',
          }}
        >
          <div>
            <span style={{ color: '#38bdf8', fontWeight: 700 }}>
              {selectedProviderDetail.displayName} Telemetry:
            </span>{' '}
            <span style={{ color: '#e2e8f0' }}>{selectedProviderDetail.updateFrequencyDescription}</span>
            <span style={{ color: '#94a3b8', marginLeft: '8px' }}>
              (Last sync: {new Date(selectedProviderDetail.lastSyncedAt).toLocaleTimeString()})
            </span>
          </div>

          <div style={{ display: 'flex', gap: '16px', color: '#cbd5e1' }}>
            <span>
              Risk Profile: <strong style={{ color: '#f59e0b' }}>{selectedProviderDetail.interruptionRiskTier}</strong>
            </span>
            <span>
              Notice Window: <strong style={{ color: '#34d399' }}>{selectedProviderDetail.interruptionNoticeWindow}</strong>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

