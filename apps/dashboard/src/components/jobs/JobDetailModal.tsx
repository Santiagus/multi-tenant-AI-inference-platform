import { useState } from 'react';
import { StatusBadge } from '../common/Badge';
import { getJobHardware, getJobInferenceMode, getJobExecutionMode } from './JobsView';
import type { JobItem } from '../../types';

interface JobDetailModalProps {
  job: JobItem | null;
  isOpen: boolean;
  onClose: () => void;
  onCancelJob: (jobId: string) => Promise<void>;
  onRetryJob?: (jobId: string) => Promise<void>;
}

const PERMANENT_ERROR_CODES = new Set([
  'INVALID_MODEL_PARAMETERS',
  'MODEL_NOT_FOUND',
  'UNSUPPORTED_MODEL',
  'VALIDATION_ERROR',
]);

function resolveInspectedInput(job: JobItem): {
  prompt: string | null;
  parameters: Record<string, unknown> | null;
  inputUri: string | null;
} {
  const input = (job.input ?? {}) as Record<string, unknown>;
  const prompt =
    (typeof job.prompt === 'string' && job.prompt.length > 0 ? job.prompt : null) ??
    (typeof input.prompt === 'string' ? input.prompt : null);
  const nested =
    job.parameters ??
    (input.parameters && typeof input.parameters === 'object' && !Array.isArray(input.parameters)
      ? (input.parameters as Record<string, unknown>)
      : {});
  // Surface sibling request fields (engine, device, simulate flags, …) alongside nested parameters.
  const extras: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (key === 'prompt' || key === 'parameters' || key === '_retry_info') continue;
    extras[key] = value;
  }
  const parameters = { ...nested, ...extras };
  return {
    prompt,
    parameters: Object.keys(parameters).length > 0 ? parameters : null,
    inputUri: job.input_uri ?? null,
  };
}

export function JobDetailModal({ job, isOpen, onClose, onCancelJob, onRetryJob }: JobDetailModalProps) {
  const [isRetrying, setIsRetrying] = useState(false);
  const [copiedJobId, setCopiedJobId] = useState(false);
  if (!isOpen || !job) return null;

  const canCancel = job.status === 'QUEUED' || job.status === 'PROCESSING' || job.status === 'SUBMITTED' || job.status === 'RETRYING';
  const canRetry = job.status === 'FAILED' || job.status === 'CANCELLED' || job.status === 'RETRYING';

  const maxRetries = job.max_retries ?? 3;
  const retriesUsed = job.retry_count ?? 0;
  const retriesLeft = Math.max(0, maxRetries - retriesUsed);
  const { prompt, parameters, inputUri } = resolveInspectedInput(job);
  const failedWithoutRetries =
    job.status === 'FAILED' &&
    retriesUsed === 0 &&
    Boolean(job.error?.code) &&
    (PERMANENT_ERROR_CODES.has(String(job.error?.code)) || maxRetries === 0);

  const copyJobId = async () => {
    try {
      await navigator.clipboard.writeText(job.job_id);
      setCopiedJobId(true);
      window.setTimeout(() => setCopiedJobId(false), 1500);
    } catch {
      setCopiedJobId(false);
    }
  };

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
              <div
                style={{
                  fontSize: '11px',
                  color: '#64748b',
                  textTransform: 'uppercase',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                Job ID
                <span
                  aria-hidden="true"
                  title={copiedJobId ? 'Copied' : 'Click job id to copy'}
                  style={{ color: copiedJobId ? '#34d399' : '#64748b', fontSize: '11px' }}
                >
                  {copiedJobId ? '✓' : '⧉'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => void copyJobId()}
                title={copiedJobId ? 'Copied' : 'Copy job id'}
                style={{
                  background: 'transparent',
                  border: 'none',
                  padding: 0,
                  margin: 0,
                  fontSize: '12px',
                  color: copiedJobId ? '#34d399' : '#f8fafc',
                  fontFamily: 'monospace',
                  wordBreak: 'break-all',
                  textAlign: 'left',
                  cursor: 'pointer',
                }}
              >
                {job.job_id}
              </button>
            </div>
            <div>
              <div style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 600 }}>Model ID</div>
              <div style={{ fontSize: '12px', color: '#f8fafc', fontWeight: 600 }}>{job.model_id}</div>
            </div>
            <div>
              <div style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 600 }}>Provider Placement</div>
              <div style={{ fontSize: '12px', color: job.provider ? '#34d399' : '#94a3b8', fontWeight: 600 }}>
                {job.provider ? job.provider.toUpperCase() : 'Pending dispatch'}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 600 }}>Placement Mode</div>
              <div style={{ fontSize: '12px', color: '#38bdf8', fontWeight: 700 }}>
                {getJobExecutionMode(job).replace('_', ' ').toUpperCase()}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 600 }}>Inference Mode</div>
              <div
                style={{
                  fontSize: '12px',
                  fontWeight: 700,
                  color:
                    getJobInferenceMode(job) === 'mock'
                      ? '#fbbf24'
                      : getJobInferenceMode(job) === 'real'
                        ? '#34d399'
                        : '#94a3b8',
                }}
              >
                {getJobInferenceMode(job) === 'mock'
                  ? 'MOCK'
                  : getJobInferenceMode(job) === 'real'
                    ? 'REAL'
                    : '—'}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 600 }}>Hardware Infrastructure</div>
              <div style={{ fontSize: '12px', color: '#f8fafc', fontWeight: 600 }}>
                {getJobHardware(job)}
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

          {/* Submitted prompt + model parameters (critical for failed inspections) */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
              <h3 style={{ fontSize: '13px', fontWeight: 700, color: '#f8fafc', marginBottom: '8px' }}>
                Prompt
              </h3>
              <pre
                style={{
                  margin: 0,
                  backgroundColor: '#090d16',
                  padding: '14px',
                  borderRadius: '8px',
                  fontSize: '12px',
                  color: '#e2e8f0',
                  maxHeight: '140px',
                  overflowY: 'auto',
                  border: '1px solid #1e293b',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {prompt && prompt.trim().length > 0
                  ? prompt
                  : inputUri
                    ? `(prompt referenced via input_uri)\n${inputUri}`
                    : '— (no prompt captured on this job)'}
              </pre>
            </div>
            <div>
              <h3 style={{ fontSize: '13px', fontWeight: 700, color: '#f8fafc', marginBottom: '8px' }}>
                Model Parameters
              </h3>
              <pre
                style={{
                  margin: 0,
                  backgroundColor: '#090d16',
                  padding: '14px',
                  borderRadius: '8px',
                  fontSize: '12px',
                  color: '#cbd5e1',
                  maxHeight: '160px',
                  overflowY: 'auto',
                  border: '1px solid #1e293b',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {parameters && Object.keys(parameters).length > 0
                  ? JSON.stringify(parameters, null, 2)
                  : '— (no model parameters captured)'}
              </pre>
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
                      Download Signed Asset
                    </a>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Status Alert if Retrying */}
          {job.status === 'RETRYING' && (
            <div
              style={{
                backgroundColor: 'rgba(245, 158, 11, 0.1)',
                border: '1px solid rgba(245, 158, 11, 0.3)',
                padding: '14px',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
              }}
            >
              <span style={{ fontSize: '18px' }}>🔄</span>
              <div>
                <div style={{ fontSize: '12px', fontWeight: 700, color: '#fbbf24', marginBottom: '2px' }}>
                  Transient Failure — Retry In Progress
                </div>
                <div style={{ fontSize: '13px', color: '#fde68a' }}>
                  Attempt {retriesUsed} of {maxRetries} executed. <strong>{retriesLeft} {retriesLeft === 1 ? 'retry' : 'retries'} left</strong> before job is quarantined to the Dead-Letter Queue (DLQ).
                </div>
              </div>
            </div>
          )}

          {/* Error Message if Failed */}
          {job.error && (
            <div
              style={{
                backgroundColor: job.error.code === 'JOB_EXPIRED' ? 'rgba(245, 158, 11, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                border: job.error.code === 'JOB_EXPIRED' ? '1px solid rgba(245, 158, 11, 0.3)' : '1px solid rgba(239, 68, 68, 0.3)',
                padding: '14px',
                borderRadius: '8px',
              }}
            >
              <div
                style={{
                  fontSize: '12px',
                  fontWeight: 700,
                  color: job.error.code === 'JOB_EXPIRED' ? '#fbbf24' : '#f87171',
                  marginBottom: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <span>{job.error.code === 'JOB_EXPIRED' ? '⏳' : '⚠️'}</span>
                {job.error.code === 'JOB_EXPIRED'
                  ? 'Queue Expiration Timeout Exhausted'
                  : job.error.code === 'MAX_RETRIES_EXCEEDED'
                    ? 'Maximum Retry Attempts Exhausted'
                    : `Execution Failure [${job.error.code || 'UNKNOWN_ERROR'}]`}
              </div>
              <div style={{ fontSize: '13px', color: job.error.code === 'JOB_EXPIRED' ? '#fde68a' : '#fca5a5' }}>
                {job.error.message}
              </div>
              {failedWithoutRetries && (
                <div style={{ fontSize: '12px', color: '#fde68a', marginTop: '8px' }}>
                  Failed without retries — permanent error codes skip the retry loop (attempt 0 of {maxRetries}).
                  Inspect the prompt and model parameters above to diagnose the rejection.
                </div>
              )}
            </div>
          )}

          {/* Telemetry Trace Context */}
          <div style={{ fontSize: '11px', color: '#64748b', display: 'flex', flexDirection: 'column', gap: '3px' }}>
            <div><strong>Correlation ID:</strong> <span style={{ fontFamily: 'monospace' }}>{job.correlation_id || 'None'}</span></div>
            <div><strong>Trace ID:</strong> <span style={{ fontFamily: 'monospace' }}>{job.trace_id || 'None'}</span></div>
            <div>
              <strong>Created:</strong> {new Date(job.created_at).toLocaleString()} |{' '}
              <strong>Expires:</strong> {job.expires_at ? new Date(job.expires_at).toLocaleString() : 'No TTL'} |{' '}
              <strong>Completed:</strong> {job.completed_at ? new Date(job.completed_at).toLocaleString() : 'In-flight'}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span>
                <strong>Retries:</strong> {retriesUsed} / {maxRetries} used
              </span>
              <span
                style={{
                  fontSize: '11px',
                  padding: '2px 7px',
                  borderRadius: '4px',
                  fontWeight: 700,
                  backgroundColor: retriesLeft === 0 ? 'rgba(239, 68, 68, 0.2)' : 'rgba(245, 158, 11, 0.2)',
                  color: retriesLeft === 0 ? '#f87171' : '#fbbf24',
                  border: `1px solid ${retriesLeft === 0 ? 'rgba(239, 68, 68, 0.4)' : 'rgba(245, 158, 11, 0.4)'}`,
                }}
              >
                {retriesLeft} {retriesLeft === 1 ? 'retry' : 'retries'} left
                {retriesLeft === 0 && ' (Next failure moves to DLQ)'}
              </span>
            </div>
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
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            {canCancel && (
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
            )}

            {canRetry && onRetryJob && (
              <button
                onClick={async () => {
                  setIsRetrying(true);
                  try {
                    await onRetryJob(job.job_id);
                    onClose();
                  } finally {
                    setIsRetrying(false);
                  }
                }}
                disabled={isRetrying}
                style={{
                  backgroundColor: '#4f46e5',
                  color: '#ffffff',
                  border: '1px solid #6366f1',
                  padding: '8px 16px',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: isRetrying ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <span>⚡</span>
                {isRetrying ? 'Re-triggering...' : job.status === 'RETRYING' ? 'Retry Now (Skip Backoff)' : 'Trigger Manually / Retry'}
              </button>
            )}
          </div>

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

