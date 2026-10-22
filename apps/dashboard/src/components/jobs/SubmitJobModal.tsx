import { useState } from 'react';
import type { RoutingPreference } from '../../types';

interface SubmitJobModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (payload: {
    model_id: string;
    routing_preference: RoutingPreference;
    priority: number;
    max_retries: number;
    input: { prompt: string };
  }) => Promise<void>;
}

const POPULAR_MODELS = [
  { id: 'meta-llama/Llama-3-8B-Instruct', label: 'Llama 3 8B Instruct (Text / General)' },
  { id: 'TinyLlama/TinyLlama-1.1B-Chat-v1.0', label: 'TinyLlama 1.1B Chat (Low Latency)' },
  { id: 'anthropic/claude-3-haiku', label: 'Claude 3 Haiku (AWS Bedrock / Proprietary)' },
  { id: 'runwayml/stable-diffusion-v1-5', label: 'Stable Diffusion v1.5 (Image Gen)' },
  { id: 'stabilityai/stable-diffusion-xl-base-1.0', label: 'SDXL Base 1.0 (High-Res Image)' },
  { id: 'openai/whisper-large-v3', label: 'Whisper Large v3 (Audio Speech-to-Text)' },
  { id: 'mistralai/Mistral-7B-Instruct-v0.2', label: 'Mistral 7B Instruct v0.2 (Text)' },
];

export function SubmitJobModal({ isOpen, onClose, onSubmit }: SubmitJobModalProps) {
  const [modelId, setModelId] = useState(POPULAR_MODELS[0].id);
  const [customModel, setCustomModel] = useState('');
  const [prompt, setPrompt] = useState('Explain how multi-tenant AI inference routing protects gross margin.');
  const [routingPreference, setRoutingPreference] = useState<RoutingPreference>('auto');
  const [priority, setPriority] = useState(5);
  const [maxRetries, setMaxRetries] = useState(3);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    const finalModel = customModel.trim() || modelId;

    try {
      await onSubmit({
        model_id: finalModel,
        routing_preference: routingPreference,
        priority,
        max_retries: maxRetries,
        input: { prompt },
      });
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to submit inference job');
    } finally {
      setIsSubmitting(false);
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
          maxWidth: '560px',
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
          <h2 style={{ fontSize: '16px', fontWeight: 700, color: '#f8fafc', margin: 0 }}>
            Submit Inference Job
          </h2>
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

        <form onSubmit={handleSubmit} style={{ padding: '24px' }}>
          {error && (
            <div
              style={{
                backgroundColor: 'rgba(239, 68, 68, 0.15)',
                color: '#f87171',
                padding: '10px 14px',
                borderRadius: '8px',
                fontSize: '13px',
                marginBottom: '16px',
                border: '1px solid rgba(239, 68, 68, 0.3)',
              }}
            >
              {error}
            </div>
          )}

          {/* Model Selection */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '13px', color: '#94a3b8', marginBottom: '6px', fontWeight: 600 }}>
              Model Catalog:
            </label>
            <select
              value={modelId}
              onChange={(e) => {
                setModelId(e.target.value);
                setCustomModel('');
              }}
              style={{
                width: '100%',
                backgroundColor: '#1e293b',
                color: '#f8fafc',
                border: '1px solid #334155',
                padding: '8px 12px',
                borderRadius: '8px',
                fontSize: '13px',
                outline: 'none',
              }}
            >
              {POPULAR_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          {/* Custom Model ID */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '12px', color: '#64748b', marginBottom: '4px' }}>
              Or custom HuggingFace / Provider Model ID:
            </label>
            <input
              type="text"
              placeholder="e.g. meta-llama/Llama-2-7b-chat-hf"
              value={customModel}
              onChange={(e) => setCustomModel(e.target.value)}
              style={{
                width: '100%',
                backgroundColor: '#1e293b',
                color: '#f8fafc',
                border: '1px solid #334155',
                padding: '8px 12px',
                borderRadius: '8px',
                fontSize: '13px',
                outline: 'none',
              }}
            />
          </div>

          {/* Prompt */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '13px', color: '#94a3b8', marginBottom: '6px', fontWeight: 600 }}>
              Inference Prompt:
            </label>
            <textarea
              rows={3}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              required
              style={{
                width: '100%',
                backgroundColor: '#1e293b',
                color: '#f8fafc',
                border: '1px solid #334155',
                padding: '10px 12px',
                borderRadius: '8px',
                fontSize: '13px',
                outline: 'none',
                resize: 'vertical',
              }}
            />
          </div>

          {/* Routing Preference & Priority */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '16px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '13px', color: '#94a3b8', marginBottom: '6px', fontWeight: 600 }}>
                Routing Policy:
              </label>
              <select
                value={routingPreference}
                onChange={(e) => setRoutingPreference(e.target.value as RoutingPreference)}
                style={{
                  width: '100%',
                  backgroundColor: '#1e293b',
                  color: '#f8fafc',
                  border: '1px solid #334155',
                  padding: '8px 12px',
                  borderRadius: '8px',
                  fontSize: '13px',
                  outline: 'none',
                }}
              >
                <option value="auto">auto (Deterministic Engine)</option>
                <option value="local_first">local_first (Local RTX 5070 Ti)</option>
                <option value="cost_optimized">cost_optimized (Lowest Cost)</option>
                <option value="low_latency">low_latency (SLO Priority)</option>
                <option value="local/gpu">local/gpu (Force Local)</option>
                <option value="cloud/runpod">cloud/runpod (RunPod GPU)</option>
                <option value="cloud/bedrock">cloud/bedrock (AWS Bedrock)</option>
                <option value="cloud/sagemaker">cloud/sagemaker (Private VPC)</option>
                <option value="mock">mock (Instant Test)</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '13px', color: '#94a3b8', marginBottom: '6px', fontWeight: 600 }}>
                Priority &amp; Retries:
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <select
                  value={priority}
                  onChange={(e) => setPriority(Number(e.target.value))}
                  style={{
                    flex: 1,
                    backgroundColor: '#1e293b',
                    color: '#f8fafc',
                    border: '1px solid #334155',
                    padding: '8px 8px',
                    borderRadius: '8px',
                    fontSize: '13px',
                    outline: 'none',
                  }}
                  title="Queue priority (1-10)"
                >
                  <option value={1}>P1 (Lowest)</option>
                  <option value={5}>P5 (Standard)</option>
                  <option value={8}>P8 (High)</option>
                  <option value={10}>P10 (Urgent)</option>
                </select>
                <select
                  value={maxRetries}
                  onChange={(e) => setMaxRetries(Number(e.target.value))}
                  style={{
                    flex: 1,
                    backgroundColor: '#1e293b',
                    color: '#f8fafc',
                    border: '1px solid #334155',
                    padding: '8px 8px',
                    borderRadius: '8px',
                    fontSize: '13px',
                    outline: 'none',
                  }}
                  title="Max Retries before DLQ"
                >
                  <option value={0}>0 Retries</option>
                  <option value={1}>1 Retry</option>
                  <option value={3}>3 Retries</option>
                  <option value={5}>5 Retries</option>
                </select>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '24px' }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                backgroundColor: '#1e293b',
                color: '#94a3b8',
                border: '1px solid #334155',
                padding: '8px 16px',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              style={{
                backgroundColor: '#6366f1',
                color: '#ffffff',
                border: 'none',
                padding: '8px 20px',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: 600,
                cursor: isSubmitting ? 'wait' : 'pointer',
                opacity: isSubmitting ? 0.7 : 1,
              }}
            >
              {isSubmitting ? 'Enqueueing...' : 'Enqueue Job'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

