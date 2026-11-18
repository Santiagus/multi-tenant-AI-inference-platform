import { useState, useMemo } from 'react';
import type { PricingSyncAudit } from '../../types';
import {
  getProviderGrafanaUrl,
  getProviderLogCommand,
  isLocalEnvironment,
} from '../../config/observability';

interface SyncTracesModalProps {
  isOpen: boolean;
  onClose: () => void;
  syncAudits: PricingSyncAudit[];
  onRetrySync?: () => Promise<void> | void;
  isSyncing?: boolean;
}

const PROVIDER_METRICS_INFO: Record<
  string,
  {
    displayName: string;
    websiteUrl: string;
    docsUrl: string;
    testCommand: string;
  }
> = {
  vast_ai: {
    displayName: 'Vast.ai',
    websiteUrl: 'https://vast.ai/',
    docsUrl: 'https://vast.ai/docs/api/pricing',
    testCommand: 'curl -s https://console.vast.ai/api/v0/bundles/ | jq .offers[0]',
  },
  runpod: {
    displayName: 'RunPod',
    websiteUrl: 'https://www.runpod.io/',
    docsUrl: 'https://docs.runpod.io/pods/pricing',
    testCommand: 'curl -s https://api.runpod.io/graphql -H "Content-Type: application/json" -d \'{"query":"{ gpuTypes { id displayName } }"}\'',
  },
  nebius: {
    displayName: 'Nebius Studio',
    websiteUrl: 'https://console.nebius.com/',
    docsUrl: 'https://docs.nebius.com/compute/pricing',
    testCommand: 'curl -s https://api.studio.nebius.ai/v1/models -H "Authorization: Bearer $NEBIUS_API_KEY"',
  },
  baseten: {
    displayName: 'Baseten',
    websiteUrl: 'https://app.baseten.co/',
    docsUrl: 'https://docs.baseten.co/deploying-models/autoscaling',
    testCommand: 'curl -s https://api.baseten.co/v1/models -H "Authorization: Api-Key $BASETEN_API_KEY"',
  },
  jarvislabs: {
    displayName: 'JarvisLabs',
    websiteUrl: 'https://jarvislabs.ai/',
    docsUrl: 'https://jarvislabs.ai/docs/faq/',
    testCommand: 'curl -s https://backend.jarvislabs.ai/templates',
  },
  fal: {
    displayName: 'fal.ai',
    websiteUrl: 'https://fal.ai/',
    docsUrl: 'https://fal.ai/pricing',
    testCommand: 'curl -s https://rest.alpha.fal.ai/models -H "Authorization: Key $FAL_KEY"',
  },
  runware: {
    displayName: 'Runware',
    websiteUrl: 'https://runware.ai/',
    docsUrl: 'https://runware.ai/pricing',
    testCommand: 'curl -s https://api.runware.ai/v1/models',
  },
  local_pytorch: {
    displayName: 'Local PyTorch',
    websiteUrl: '#local-hardware',
    docsUrl: '#local-hardware',
    testCommand: 'python3 -c "import torch; print(torch.cuda.get_device_name(0))"',
  },
};

export function SyncTracesModal({
  isOpen,
  onClose,
  syncAudits,
  onRetrySync,
  isSyncing = false,
}: SyncTracesModalProps) {
  const [filter, setFilter] = useState<'all' | 'failed' | 'success'>('all');

  const auditsWithErrors = useMemo(() => {
    return syncAudits.map((a) => {
      const err = a.error || (a.details?.error as string) || (a.status === 'FAILED' ? 'Catalog synchronization failed' : null);
      return { ...a, computedError: err };
    });
  }, [syncAudits]);

  const failedCount = auditsWithErrors.filter((a) => a.status === 'FAILED' || !!a.computedError).length;
  const successCount = auditsWithErrors.filter((a) => a.status === 'SUCCESS' && !a.computedError).length;

  const displayedAudits = useMemo(() => {
    return auditsWithErrors.filter((a) => {
      const isFailed = a.status === 'FAILED' || !!a.computedError;
      if (filter === 'failed' && !isFailed) return false;
      if (filter === 'success' && isFailed) return false;
      return true;
    });
  }, [auditsWithErrors, filter]);

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: '20px',
        backdropFilter: 'blur(4px)',
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: '#090d16',
          border: '1px solid #1e293b',
          borderRadius: '12px',
          width: '100%',
          maxWidth: '860px',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 20px 40px rgba(0, 0, 0, 0.8)',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid #1e293b',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            backgroundColor: '#0f172a',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '18px' }}>📋</span>
              <h2 style={{ fontSize: '16px', fontWeight: 700, color: '#f8fafc', margin: 0 }}>
                Provider Catalog Synchronization Audits &amp; Distributed Traces
              </h2>
            </div>
            <p style={{ margin: '4px 0 0 26px', fontSize: '11.5px', color: '#94a3b8' }}>
              Inspect live provider sync audit records, HTTP status traces, and OpenTelemetry spans across neocloud offerings.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {onRetrySync && (
              <button
                type="button"
                onClick={onRetrySync}
                disabled={isSyncing}
                style={{
                  backgroundColor: '#2563eb',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '6px 12px',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: isSyncing ? 'not-allowed' : 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                }}
              >
                <span>{isSyncing ? '🔄' : '↻'}</span>
                <span>{isSyncing ? 'Synchronizing...' : 'Retry Sync Now'}</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              style={{
                backgroundColor: '#1e293b',
                color: '#94a3b8',
                border: '1px solid #334155',
                borderRadius: '6px',
                width: '28px',
                height: '28px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                fontSize: '14px',
              }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* Enterprise REST & Observability Standards Bar */}
        <div
          style={{
            padding: '8px 20px',
            backgroundColor: '#0a0f1d',
            borderBottom: '1px solid #1e293b',
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            fontSize: '11px',
            color: '#94a3b8',
            flexWrap: 'wrap',
          }}
        >
          <span style={{ fontWeight: 600, color: '#e2e8f0' }}>Enterprise API Endpoints:</span>
          <span>
            Audits:{' '}
            <code style={{ color: '#38bdf8', backgroundColor: '#1e293b', padding: '1px 5px', borderRadius: '3px' }}>
              GET /v1/finops/sync-audits
            </code>
          </span>
          <span>
            Sync Execution:{' '}
            <code style={{ color: '#38bdf8', backgroundColor: '#1e293b', padding: '1px 5px', borderRadius: '3px' }}>
              POST /v1/finops/sync
            </code>
          </span>
          <span>
            Distributed Tracing:{' '}
            <code style={{ color: '#a78bfa', backgroundColor: '#1e293b', padding: '1px 5px', borderRadius: '3px' }}>
              GET /v1/traces/:traceId
            </code>
          </span>
        </div>

        {/* Status Breakdown & Filter Pills */}
        <div
          style={{
            padding: '12px 20px',
            backgroundColor: '#0b1120',
            borderBottom: '1px solid #1e293b',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '10px',
          }}
        >
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', color: '#94a3b8' }}>Filter:</span>
            <button
              type="button"
              onClick={() => setFilter('all')}
              style={{
                backgroundColor: filter === 'all' ? '#334155' : 'transparent',
                color: filter === 'all' ? '#f8fafc' : '#94a3b8',
                border: '1px solid #334155',
                borderRadius: '4px',
                padding: '2px 8px',
                fontSize: '10.5px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              All ({syncAudits.length})
            </button>
            <button
              type="button"
              onClick={() => setFilter('failed')}
              style={{
                backgroundColor: filter === 'failed' ? 'rgba(239, 68, 68, 0.2)' : 'transparent',
                color: filter === 'failed' ? '#f87171' : '#94a3b8',
                border: `1px solid ${filter === 'failed' ? '#ef4444' : '#334155'}`,
                borderRadius: '4px',
                padding: '2px 8px',
                fontSize: '10.5px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              ⚠️ Failed ({failedCount})
            </button>
            <button
              type="button"
              onClick={() => setFilter('success')}
              style={{
                backgroundColor: filter === 'success' ? 'rgba(16, 185, 129, 0.2)' : 'transparent',
                color: filter === 'success' ? '#34d399' : '#94a3b8',
                border: `1px solid ${filter === 'success' ? '#10b981' : '#334155'}`,
                borderRadius: '4px',
                padding: '2px 8px',
                fontSize: '10.5px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              ✓ Succeeded ({successCount})
            </button>
          </div>

          <div style={{ fontSize: '11px', color: '#64748b' }}>
            Live sync polling cadence: <strong>~60s auction</strong> / <strong>5m neocloud</strong>
          </div>
        </div>

        {/* Traces Content Area */}
        <div style={{ padding: '16px 20px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {displayedAudits.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>
              No synchronization traces match the selected filter.
            </div>
          ) : (
            displayedAudits.map((a, idx) => {
              const isFailed = a.status === 'FAILED' || !!a.computedError;
              const meta = PROVIDER_METRICS_INFO[a.provider] || {
                displayName: a.provider,
                websiteUrl: '#',
                docsUrl: '#',
                testCommand: `curl http://localhost:3000/v1/finops/pricing-history?provider=${a.provider}`,
              };

              return (
                <div
                  key={a.id || `audit-${idx}-${a.provider}`}
                  style={{
                    backgroundColor: '#0f172a',
                    border: `1px solid ${isFailed ? '#ef444440' : '#1e293b'}`,
                    borderRadius: '8px',
                    padding: '14px 16px',
                    transition: 'border-color 0.2s',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginBottom: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span
                        style={{
                          width: '8px',
                          height: '8px',
                          borderRadius: '50%',
                          backgroundColor: isFailed ? '#ef4444' : '#10b981',
                          boxShadow: isFailed ? '0 0 6px #ef4444' : '0 0 6px #10b981',
                        }}
                      />
                      <span style={{ fontSize: '13px', fontWeight: 700, color: '#f8fafc' }}>
                        {meta.displayName}
                      </span>
                      <span
                        style={{
                          fontSize: '10px',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          fontWeight: 700,
                          backgroundColor: isFailed ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.15)',
                          color: isFailed ? '#f87171' : '#34d399',
                          border: `1px solid ${isFailed ? '#ef444450' : '#10b98150'}`,
                        }}
                      >
                        {isFailed ? 'FAILED' : 'SYNCED'}
                      </span>
                      <span style={{ fontSize: '10.5px', color: '#64748b' }}>
                        ({a.syncType})
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                        {a.recordsCount} records ingested
                      </span>
                      <span style={{ fontSize: '10.5px', color: '#64748b' }}>
                        {new Date(a.syncedAt).toLocaleTimeString()}
                      </span>
                    </div>
                  </div>

                  {/* If Failed: Error Trace Box */}
                  {isFailed && (
                    <div
                      style={{
                        backgroundColor: '#180a0a',
                        border: '1px solid #7f1d1d',
                        borderRadius: '6px',
                        padding: '10px 12px',
                        marginTop: '8px',
                        marginBottom: '8px',
                      }}
                    >
                      <div style={{ fontSize: '11px', fontWeight: 700, color: '#f87171', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span>⚠️ Sync Failure Trace:</span>
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
                        {a.computedError}
                      </div>

                      {Boolean(a.details?.endpoint) && (
                        <div style={{ marginTop: '6px', fontSize: '10.5px', color: '#94a3b8' }}>
                          Target URL: <code style={{ color: '#38bdf8' }}>{String(a.details?.endpoint)}</code>
                        </div>
                      )}

                      {/* Vast.ai remediation note */}
                      {a.provider.toLowerCase() === 'vast_ai' && (
                        <div style={{ marginTop: '8px', fontSize: '10.5px', color: '#cbd5e1', borderTop: '1px dashed #7f1d1d', paddingTop: '6px' }}>
                          💡 <strong>Vast.ai Diagnostic Tip:</strong> Vast.ai provides open live auction bundles without an API key. If your deployment passes <code style={{ color: '#fbbf24' }}>VAST_API_KEY</code>, verify it is a valid 64-character hexadecimal hash from your Vast.ai console account settings.
                        </div>
                      )}
                    </div>
                  )}

                  {/* Verification Links & Services */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginTop: '8px', paddingTop: '6px', borderTop: '1px solid #1e293b' }}>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                      <a
                        href={meta.websiteUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ fontSize: '10.5px', color: '#38bdf8', textDecoration: 'none' }}
                      >
                        🌐 Provider Console
                      </a>
                      <span style={{ color: '#334155' }}>•</span>
                      <a
                        href={getProviderGrafanaUrl(a.provider)}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ fontSize: '10.5px', color: '#fb923c', textDecoration: 'none' }}
                        title="Open Grafana Pricing & Sync Telemetry Dashboard pre-filtered to this provider"
                      >
                        📈 Grafana Telemetry
                      </a>
                      <span style={{ color: '#334155' }}>•</span>
                      <a
                        href={meta.docsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ fontSize: '10.5px', color: '#34d399', textDecoration: 'none' }}
                      >
                        📖 API Docs
                      </a>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <button
                        type="button"
                        onClick={() => {
                          const cmd = getProviderLogCommand(a.provider);
                          if (typeof navigator !== 'undefined' && navigator.clipboard) {
                            navigator.clipboard.writeText(cmd);
                          }
                        }}
                        style={{
                          backgroundColor: '#1e293b',
                          color: '#94a3b8',
                          border: '1px solid #334155',
                          borderRadius: '4px',
                          padding: '2px 8px',
                          fontSize: '10px',
                          cursor: 'pointer',
                        }}
                        title={`Copy ${isLocalEnvironment() ? 'Docker' : 'AWS CloudWatch'} command: ${getProviderLogCommand(a.provider)}`}
                      >
                        📋 Copy {isLocalEnvironment() ? 'Docker' : 'AWS CloudWatch'} Logs Cmd
                      </button>
                      <code
                        style={{
                          backgroundColor: '#090d16',
                          color: '#e2e8f0',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          fontSize: '10px',
                          maxWidth: '260px',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          border: '1px solid #1e293b',
                        }}
                        title={meta.testCommand}
                      >
                        {meta.testCommand}
                      </code>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '12px 20px',
            borderTop: '1px solid #1e293b',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            backgroundColor: '#0f172a',
          }}
        >
          <span style={{ fontSize: '11px', color: '#64748b' }}>
            Multi-Tenant Platform FinOps Sync Engine · Automated telemetry recovery &amp; SLO rerouting
          </span>
          <button
            type="button"
            onClick={onClose}
            style={{
              backgroundColor: '#1e293b',
              color: '#f8fafc',
              border: '1px solid #334155',
              borderRadius: '6px',
              padding: '6px 14px',
              fontSize: '11px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
