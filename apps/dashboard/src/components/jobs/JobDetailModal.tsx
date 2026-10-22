import { StatusBadge } from '../common/Badge';
import type { JobItem } from '../../types';

interface JobDetailModalProps {
  job: JobItem | null;
  isOpen: boolean;
  onClose: () => void;
  onCancelJob: (jobId: string) => Promise<void>;
}

export function JobDetailModal({ job, isOpen, onClose, onCancelJob }: JobDetailModalProps) {
  if (!isOpen || !job) return null;

  const canCancel = job.status === 'QUEUED' || job.status === 'PROCESSING' || job.status === 'SUBMITTED';

  // Cost and economics calculation
  const inTokens = job.usage?.prompt_tokens ?? 0;
  const outTokens = job.usage?.completion_tokens ?? 0;
  const totalTokens = job.usage?.total_tokens ?? inTokens + outTokens;
  const costMicrocents = job.usage?.cost_microcents ?? 0;
  const costUsd = costMicrocents / 100_000_000;
  // standard billed rate 40 microcents / token
  const revenueMicrocents = totalTokens * 40;
  const revenueUsd = revenueMicrocents / 100_000_000;
  const profitMicrocents = revenueMicrocents - costMicrocents;
  const profitUsd = profitMicrocents / 100_000_000;
  const marginPct = revenueMicrocents > 0 ? (profitMicrocents / revenueMicrocents) * 100 : 0;

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
    >
      <div
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
        {/* Header */}
        <div
          style={{
            padding: '18px 24px',
            borderBottom: '1px solid #1e293b',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <h2 style={{ fontSize: '16px', fontWeight: 700, color: '#f8fafc', margin: 0 }}>
              Job Inspection
            </h2>
            <StatusBadge status={job.status} />
          </div>
          <button
            onClick={onClose}
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

        {/* Content Body */}
        <div style={{ padding: '24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Progress bar if in flight */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#94a3b8', marginBottom: '6px' }}>
              <span>Phase: <strong style={{ color: '#f8fafc' }}>{job.progress?.phase || job.status.toLowerCase()}</strong></span>
              <span>{job.progress_pct ?? (job.status === 'SUCCEEDED' ? 100 : 0)}%</span>
            </div>
            <div style={{ width: '100%', height: '8px', backgroundColor: '#1e293b', borderRadius: '4px', overflow: 'hidden' }}>
              <div
                style={{
                  width: `${job.progress_pct ?? (job.status === 'SUCCEEDED' ? 100 : 0)}%`,
                  height: '100%',
                  backgroundColor: job.status === 'FAILED' ? '#ef4444' : '#6366f1',
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
          </div>

          {/* Key Metadata Grid */}
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
              <div style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 600 }}>Job ID</div>
              <div style={{ fontSize: '12px', color: '#f8fafc', fontFamily: 'monospace', wordBreak: 'break-all' }}>{job.job_id}</div>
            </div>
            <div>
              <div style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 600 }}>Model ID</div>
              <div style={{ fontSize: '12px', color: '#f8fafc', fontWeight: 600 }}>{job.model_id}</div>
            </div>
            <div>
              <div style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 600 }}>Provider Placement</div>
              <div style={{ fontSize: '12px', color: job.provider ? '#34d399' : '#94a3b8', fontWeight: 600 }}>
                {job.provider || 'Pending dispatch'}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 600 }}>Execution Latency</div>
              <div style={{ fontSize: '12px', color: '#f8fafc', fontWeight: 600 }}>
                {job.duration_ms !== null ? `${job.duration_ms} ms` : 'In flight'}
              </div>
            </div>
          </div>

          {/* Economics & Usage Breakdown */}
          <div style={{ border: '1px solid #1e293b', borderRadius: '10px', padding: '16px', backgroundColor: '#090d16' }}>
            <h3 style={{ fontSize: '13px', fontWeight: 700, color: '#f8fafc', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Workload Economics &amp; Margin Ledger
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
              <div>
                <div style={{ fontSize: '11px', color: '#64748b' }}>Tokens (In / Out)</div>
                <div style={{ fontSize: '14px', fontWeight: 700, color: '#f8fafc' }}>
                  {totalTokens > 0 ? `${inTokens} / ${outTokens}` : '—'}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '11px', color: '#64748b' }}>Infra Cost</div>
                <div style={{ fontSize: '14px', fontWeight: 700, color: '#f87171' }}>
                  ${costUsd.toFixed(6)}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '11px', color: '#64748b' }}>Projected Revenue</div>
                <div style={{ fontSize: '14px', fontWeight: 700, color: '#34d399' }}>
                  ${revenueUsd.toFixed(6)}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '11px', color: '#64748b' }}>Gross Margin</div>
                <div
                  style={{
                    fontSize: '14px',
                    fontWeight: 700,
                    color: marginPct >= 40 ? '#34d399' : marginPct > 0 ? '#fbbf24' : '#f87171',
                  }}
                >
                  {revenueUsd > 0 ? `${marginPct.toFixed(1)}% ($${profitUsd.toFixed(6)})` : '—'}
                </div>
              </div>
            </div>
          </div>

          {/* Results & Artifacts */}
          {job.result && (
            <div>
              <h3 style={{ fontSize: '13px', fontWeight: 700, color: '#f8fafc', marginBottom: '8px' }}>
                Output Payload:
              </h3>
              <pre
                style={{
                  backgroundColor: '#090d16',
                  padding: '14px',
                  borderRadius: '8px',
                  fontSize: '12px',
                  color: '#e2e8f0',
                  maxHeight: '160px',
                  overflowY: 'auto',
                  border: '1px solid #1e293b',
                }}
              >
                {JSON.stringify(job.result, null, 2)}
              </pre>
            </div>
          )}

          {job.artifacts && job.artifacts.length > 0 && (
            <div>
              <h3 style={{ fontSize: '13px', fontWeight: 700, color: '#f8fafc', marginBottom: '8px' }}>
                Signed S3 Storage Artifacts:
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {job.artifacts.map((artifact) => (
                  <div
                    key={artifact.name}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 14px',
                      backgroundColor: '#1e293b',
                      borderRadius: '8px',
                      fontSize: '13px',
                    }}
                  >
                    <span style={{ fontWeight: 600, color: '#f8fafc' }}>{artifact.name}</span>
                    <a
                      href={artifact.download_url}
                      target="_blank"
                      rel="noreferrer"
                      download
                      style={{
                        color: '#6366f1',
                        textDecoration: 'none',
                        fontWeight: 600,
                        fontSize: '12px',
                      }}
                    >
                      Download Signed Asset ↗
                    </a>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Error Message if Failed */}
          {job.error && (
            <div
              style={{
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                padding: '14px',
                borderRadius: '8px',
              }}
            >
              <div style={{ fontSize: '12px', fontWeight: 700, color: '#f87171', marginBottom: '4px' }}>
                Execution Failure [{job.error.code || 'UNKNOWN_ERROR'}]
              </div>
              <div style={{ fontSize: '13px', color: '#fca5a5' }}>{job.error.message}</div>
            </div>
          )}

          {/* Telemetry Trace Context */}
          <div style={{ fontSize: '11px', color: '#64748b' }}>
            <div><strong>Correlation ID:</strong> <span style={{ fontFamily: 'monospace' }}>{job.correlation_id || 'None'}</span></div>
            <div><strong>Trace ID:</strong> <span style={{ fontFamily: 'monospace' }}>{job.trace_id || 'None'}</span></div>
            <div><strong>Created:</strong> {new Date(job.created_at).toLocaleString()} | <strong>Completed:</strong> {job.completed_at ? new Date(job.completed_at).toLocaleString() : 'In-flight'}</div>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '16px 24px',
            borderTop: '1px solid #1e293b',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          {canCancel ? (
            <button
              onClick={() => onCancelJob(job.job_id)}
              style={{
                backgroundColor: 'rgba(239, 68, 68, 0.2)',
                color: '#f87171',
                border: '1px solid rgba(239, 68, 68, 0.4)',
                padding: '8px 16px',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Cancel In-Flight Job
            </button>
          ) : (
            <div />
          )}

          <button
            onClick={onClose}
            style={{
              backgroundColor: '#334155',
              color: '#f8fafc',
              border: 'none',
              padding: '8px 20px',
              borderRadius: '8px',
              fontSize: '13px',
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

