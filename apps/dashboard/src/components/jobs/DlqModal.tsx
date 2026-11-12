import { useState } from 'react';
import type { DlqMessage } from '../../types';

interface DlqModalProps {
  isOpen: boolean;
  onClose: () => void;
  messages: DlqMessage[];
  isLoading: boolean;
  onRefresh: () => void;
  onInspectJob?: (jobId: string, tenantId: string) => void | Promise<void>;
  onDiscardMessage?: (messageId: string, tenantId: string) => Promise<void>;
}

function truncate(text: string, max = 280): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

export function DlqModal({
  isOpen,
  onClose,
  messages,
  isLoading,
  onRefresh,
  onInspectJob,
  onDiscardMessage,
}: DlqModalProps) {
  const [copiedJobId, setCopiedJobId] = useState<string | null>(null);
  const [discardingId, setDiscardingId] = useState<string | null>(null);
  const [discardError, setDiscardError] = useState<string | null>(null);

  if (!isOpen) return null;

  const copyJobId = async (jobId: string) => {
    try {
      await navigator.clipboard.writeText(jobId);
      setCopiedJobId(jobId);
      window.setTimeout(() => setCopiedJobId((current) => (current === jobId ? null : current)), 1500);
    } catch {
      setCopiedJobId(null);
    }
  };

  const handleDiscard = async (msg: DlqMessage) => {
    if (!onDiscardMessage || discardingId) return;
    setDiscardError(null);
    setDiscardingId(msg.message_id);
    try {
      await onDiscardMessage(msg.message_id, msg.tenant_id);
    } catch (err) {
      setDiscardError(err instanceof Error ? err.message : 'Failed to discard DLQ message');
    } finally {
      setDiscardingId(null);
    }
  };

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
          maxWidth: '860px',
          maxHeight: '85vh',
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
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h2 style={{ fontSize: '16px', fontWeight: 700, color: '#f8fafc', margin: 0 }}>
              Dead-Letter Queue (DLQ) Inspector
            </h2>
            <span
              style={{
                backgroundColor: 'rgba(239, 68, 68, 0.2)',
                color: '#f87171',
                padding: '2px 8px',
                borderRadius: '6px',
                fontSize: '11px',
                fontWeight: 700,
              }}
            >
              {messages.length} Poisoned Messages
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              onClick={onRefresh}
              disabled={isLoading}
              style={{
                backgroundColor: '#1e293b',
                color: '#94a3b8',
                border: '1px solid #334155',
                padding: '4px 10px',
                borderRadius: '6px',
                fontSize: '12px',
                cursor: 'pointer',
              }}
            >
              {isLoading ? 'Loading...' : 'Refresh DLQ'}
            </button>
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
        </div>

        <div style={{ padding: '24px', overflowY: 'auto' }}>
          {discardError ? (
            <div
              style={{
                marginBottom: '12px',
                padding: '8px 12px',
                borderRadius: '8px',
                backgroundColor: 'rgba(239, 68, 68, 0.12)',
                border: '1px solid rgba(239, 68, 68, 0.35)',
                color: '#fca5a5',
                fontSize: '12px',
              }}
            >
              {discardError}
            </div>
          ) : null}

          {messages.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: '48px 0',
                color: '#64748b',
                fontSize: '14px',
              }}
            >
              <div style={{ fontSize: '32px', marginBottom: '8px' }}>✓</div>
              No poisoned messages in Dead-Letter Queue. All retried jobs recovered or were processed cleanly.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {messages.map((msg) => {
                const prompt =
                  msg.prompt ??
                  (typeof msg.input?.prompt === 'string' ? msg.input.prompt : null);
                const params =
                  msg.parameters ?? (msg.input?.parameters as Record<string, unknown> | undefined) ?? null;
                const isDiscarding = discardingId === msg.message_id;
                const justCopied = copiedJobId === msg.job_id;

                return (
                  <div
                    key={msg.message_id}
                    style={{
                      backgroundColor: '#1e293b',
                      border: '1px solid #334155',
                      borderRadius: '10px',
                      padding: '16px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '10px',
                      position: 'relative',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div
                          style={{
                            fontSize: '10px',
                            fontWeight: 700,
                            color: '#64748b',
                            textTransform: 'uppercase',
                            letterSpacing: '0.04em',
                            marginBottom: '4px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                          }}
                        >
                          Job ID
                          <span
                            aria-hidden="true"
                            title={justCopied ? 'Copied' : 'Click job id to copy'}
                            style={{ color: justCopied ? '#34d399' : '#64748b', fontSize: '11px' }}
                          >
                            {justCopied ? '✓' : '⧉'}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => void copyJobId(msg.job_id)}
                          title={justCopied ? 'Copied' : 'Copy job id'}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            padding: 0,
                            margin: 0,
                            fontSize: '13px',
                            fontWeight: 700,
                            fontFamily: 'monospace',
                            color: justCopied ? '#34d399' : '#818cf8',
                            cursor: 'pointer',
                            textAlign: 'left',
                            wordBreak: 'break-all',
                          }}
                        >
                          {msg.job_id}
                        </button>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                        <div style={{ fontSize: '11px', color: '#f87171', fontWeight: 600 }}>
                          Exhausted {msg.retry_count} retries
                        </div>
                        {onDiscardMessage ? (
                          <button
                            type="button"
                            onClick={() => void handleDiscard(msg)}
                            disabled={isDiscarding}
                            title="Discard from DLQ"
                            aria-label="Discard from DLQ"
                            style={{
                              width: '28px',
                              height: '28px',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              backgroundColor: 'rgba(239, 68, 68, 0.12)',
                              border: '1px solid rgba(239, 68, 68, 0.35)',
                              borderRadius: '6px',
                              color: '#f87171',
                              fontSize: '14px',
                              fontWeight: 700,
                              cursor: isDiscarding ? 'wait' : 'pointer',
                              opacity: isDiscarding ? 0.6 : 1,
                            }}
                          >
                            {isDiscarding ? '…' : '✕'}
                          </button>
                        ) : null}
                      </div>
                    </div>

                    <div style={{ fontSize: '12px', color: '#94a3b8' }}>
                      Model: <strong style={{ color: '#f8fafc' }}>{msg.model_id}</strong>
                      {msg.routing_preference ? (
                        <span>
                          {' '}
                          · Routing: <strong style={{ color: '#cbd5e1' }}>{msg.routing_preference}</strong>
                        </span>
                      ) : null}
                    </div>

                    <div>
                      <div
                        style={{
                          fontSize: '10px',
                          fontWeight: 700,
                          color: '#64748b',
                          textTransform: 'uppercase',
                          letterSpacing: '0.04em',
                          marginBottom: '4px',
                        }}
                      >
                        Prompt
                      </div>
                      <pre
                        style={{
                          margin: 0,
                          backgroundColor: '#0f172a',
                          border: '1px solid #334155',
                          borderRadius: '6px',
                          padding: '8px 10px',
                          fontSize: '12px',
                          color: '#e2e8f0',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                          maxHeight: '96px',
                          overflowY: 'auto',
                        }}
                      >
                        {prompt ? truncate(prompt) : '— (no prompt captured on DLQ message)'}
                      </pre>
                    </div>

                    <div>
                      <div
                        style={{
                          fontSize: '10px',
                          fontWeight: 700,
                          color: '#64748b',
                          textTransform: 'uppercase',
                          letterSpacing: '0.04em',
                          marginBottom: '4px',
                        }}
                      >
                        Parameters
                      </div>
                      <pre
                        style={{
                          margin: 0,
                          backgroundColor: '#0f172a',
                          border: '1px solid #334155',
                          borderRadius: '6px',
                          padding: '8px 10px',
                          fontSize: '11px',
                          color: '#cbd5e1',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                          maxHeight: '120px',
                          overflowY: 'auto',
                        }}
                      >
                        {params && Object.keys(params).length > 0
                          ? JSON.stringify(params, null, 2)
                          : '— (no parameters captured)'}
                      </pre>
                    </div>

                    <div
                      style={{
                        backgroundColor: 'rgba(239, 68, 68, 0.1)',
                        border: '1px solid rgba(239, 68, 68, 0.2)',
                        padding: '8px 12px',
                        borderRadius: '6px',
                        fontSize: '12px',
                        color: '#fca5a5',
                      }}
                    >
                      <div style={{ fontWeight: 700, marginBottom: '2px' }}>Error</div>
                      <strong>{msg.error_code}:</strong> {msg.failure_reason}
                    </div>

                    <div
                      style={{
                        fontSize: '11px',
                        color: '#64748b',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: '12px',
                        flexWrap: 'wrap',
                      }}
                    >
                      <span>Message ID: {msg.message_id}</span>
                      <span>Failed At: {new Date(msg.failed_at).toLocaleString()}</span>
                      {onInspectJob ? (
                        <button
                          type="button"
                          onClick={() => void onInspectJob(msg.job_id, msg.tenant_id)}
                          style={{
                            marginLeft: 'auto',
                            backgroundColor: '#0f172a',
                            border: '1px solid #475569',
                            color: '#e2e8f0',
                            borderRadius: '6px',
                            padding: '4px 10px',
                            fontSize: '11px',
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          Job Inspection
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
