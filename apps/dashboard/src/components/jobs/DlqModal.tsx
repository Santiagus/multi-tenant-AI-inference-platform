import type { DlqMessage } from '../../types';

interface DlqModalProps {
  isOpen: boolean;
  onClose: () => void;
  messages: DlqMessage[];
  isLoading: boolean;
  onRefresh: () => void;
}

export function DlqModal({ isOpen, onClose, messages, isLoading, onRefresh }: DlqModalProps) {
  if (!isOpen) return null;

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
          maxWidth: '780px',
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
              {messages.map((msg) => (
                <div
                  key={msg.message_id}
                  style={{
                    backgroundColor: '#1e293b',
                    border: '1px solid #334155',
                    borderRadius: '10px',
                    padding: '16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: '#f8fafc' }}>
                      Job: <span style={{ fontFamily: 'monospace', color: '#818cf8' }}>{msg.job_id}</span>
                    </div>
                    <div style={{ fontSize: '11px', color: '#f87171', fontWeight: 600 }}>
                      Exhausted {msg.retry_count} retries
                    </div>
                  </div>

                  <div style={{ fontSize: '12px', color: '#94a3b8' }}>
                    Model: <strong style={{ color: '#f8fafc' }}>{msg.model_id}</strong>
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
                    <strong>{msg.error_code}:</strong> {msg.failure_reason}
                  </div>

                  <div style={{ fontSize: '11px', color: '#64748b', display: 'flex', justifyContent: 'space-between' }}>
                    <span>Message ID: {msg.message_id}</span>
                    <span>Failed At: {new Date(msg.failed_at).toLocaleString()}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

